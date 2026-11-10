import { getScenario } from "./catalogo";
import type { Scenario, ScriptedResponse } from "./escenario";

// EL BACKEND FALSO (T4 del plan «ui-agnóstico»): contesta como `chat.supcoflow.dev` con una charla guionada (un `Scenario`) y ANOTA qué le pidió la interfaz y en qué
// orden. Con eso se prueba una interfaz sin gastar plata ni pegarle a producción, mirando sólo tres cosas que no dependen del diseño: qué pidió y cuándo, qué texto
// mostró y qué controles ofreció. Dos formas de usarlo, la misma lógica: el `fetch` que se le da a `createSupportChat({ fetch })` y, detrás de HTTP real, el
// servidor local (`servidor-local.ts`). No importa preact, react ni CSS, ni toca `node:*` (el servidor local lo trae con `import()` recién cuando se usa).

export type RequestKind = "availability" | "open" | "follow" | "recover" | "evidence" | "unknown";

export interface RecordedRequest {
  /** El orden de llegada, desde 1. */
  seq: number;
  kind: RequestKind;
  method: string;
  /** Ruta y query, como la ve el servidor (`/api/chat/sesion/ses_A`, `/api/chat/sesion/ses_A/eventos?desde=0`). */
  path: string;
  /** En minúsculas. */
  headers: Record<string, string>;
  /** `true` si la señal del pedido (`AbortSignal`) se disparó, cuando sea: el núcleo la dispara al destruirse, con el turno todavía en vuelo o ya terminado. Sólo existe cuando pasó. */
  aborted?: true;
  /** El cuerpo ya leído como JSON; si no era JSON, el texto; sin cuerpo, `undefined`. */
  body?: unknown;
}

/** Una respuesta de la persona a una pregunta del asistente, tal como llegó al servidor. */
export interface SentAnswer {
  seq: number;
  requestId: string;
  optionId?: string;
  text?: string;
}

export interface FakeBackendOptions {
  /** El `backendUrl` que se le da al núcleo. Default: `https://chat.fake.test`. */
  backendUrl?: string;
  /** El origen de la página, para el `{{origin}}` del texto guionado (el enlace al propio sitio). Default: el de `location`, o `https://app.example.test`. */
  origin?: string;
  /** Milisegundos entre una línea del stream y la siguiente, para VER el streaming. Default 0: todo de una vez. */
  lineDelayMs?: number;
}

/** Un pedido ya leído; lo arma `fetch` y lo arma el servidor local. */
export interface FakeRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal | null;
  /** El origen de quien pregunta, si no es el de las opciones. */
  origin?: string;
}

export interface FakeBackend {
  readonly scenario: Scenario;
  /** El `backendUrl` del núcleo, sin barra final. */
  readonly url: string;
  /** Para `createSupportChat({ fetch })`. */
  readonly fetch: typeof fetch;
  /** Todo lo que la interfaz pidió, en orden. Una copia: no cambia después. */
  readonly requests: readonly RecordedRequest[];
  /** Respuestas guionadas de la sesión que nadie pidió todavía. En 0 al final de un escenario recorrido entero. */
  readonly remaining: number;
  requestsOfKind(kind: RequestKind): RecordedRequest[];
  /** Lo que la interfaz CONTESTÓ a una pregunta (la confirmación del reporte incluida): con el id de la pregunta y la opción o el texto. */
  answers(): SentAnswer[];
  /** Retiene el PRÓXIMO pedido a la sesión: llega, queda anotado y no se contesta hasta soltarlo (la interfaz está «trabajando»). Con `afterLines` entrega esas líneas y retiene el resto. Devuelve la función que suelta. */
  hold(options?: { afterLines?: number }): () => void;
  /** Cambia de escenario (por nombre o por objeto) y arranca de cero. */
  use(scenario: Scenario | string): void;
  /** Vuelve al principio del escenario: respuestas sin consumir, pedidos en cero. */
  reset(): void;
  /** El manejador de un pedido ya leído. Es lo que usa el servidor local; `fetch` lo usa por debajo. */
  handle(request: FakeRequest): Promise<Response>;
}

const URL_POR_DEFECTO = "https://chat.fake.test";
const ORIGEN_POR_DEFECTO = "https://app.example.test";

function clasificar(metodo: string, ruta: string): RequestKind {
  if (metodo === "GET" && ruta === "/api/chat/estado") return "availability";
  if (metodo === "POST" && ruta === "/api/chat/sesion") return "open";
  if (metodo === "POST" && /^\/api\/chat\/sesion\/[^/]+$/.test(ruta)) return "follow";
  if (metodo === "GET" && /^\/api\/chat\/sesion\/[^/]+\/eventos$/.test(ruta)) return "recover";
  if (metodo === "POST" && ruta === "/api/evidencias") return "evidence";
  return "unknown";
}

const abortado = () => new DOMException("The operation was aborted.", "AbortError");
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const json = (status: number, cuerpo: object) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

/** Espera `promesa`, pero si `senal` se aborta antes rechaza con AbortError: el núcleo cancela así un pedido en vuelo al destruirse. */
function conSenal<T>(promesa: Promise<T>, senal?: AbortSignal | null): Promise<T> {
  if (senal == null) return promesa;
  if (senal.aborted) return Promise.reject(abortado());
  return new Promise<T>((resolver, rechazar) => {
    const alAbortar = () => rechazar(abortado());
    senal.addEventListener("abort", alAbortar, { once: true });
    promesa.then(
      (v) => { senal.removeEventListener("abort", alAbortar); resolver(v); },
      (e) => { senal.removeEventListener("abort", alAbortar); rechazar(e); },
    );
  });
}

interface Retencion {
  afterLines: number;
  puerta: Promise<void>;
  soltar: () => void;
}

export function createFakeBackend(scenario: Scenario | string, options: FakeBackendOptions = {}): FakeBackend {
  const url = (options.backendUrl ?? URL_POR_DEFECTO).replace(/\/$/, "");
  const retardo = options.lineDelayMs ?? 0;
  const origenDeLaPagina = (): string => {
    if (options.origin !== undefined) return options.origin;
    const l = (globalThis as { location?: { origin?: string } }).location?.origin;
    return typeof l === "string" && l !== "" && l !== "null" ? l : ORIGEN_POR_DEFECTO;
  };

  let vigente: Scenario = typeof scenario === "string" ? getScenario(scenario) : scenario;
  let pedidos: RecordedRequest[] = [];
  let consumidas = 0;
  let evidenciasGuionadas = 0;
  let evidenciasPorDefecto = 0;
  let retenciones: Retencion[] = [];

  const reset = (): void => {
    for (const r of retenciones) r.soltar();
    retenciones = [];
    pedidos = [];
    consumidas = 0;
    evidenciasGuionadas = 0;
    evidenciasPorDefecto = 0;
  };

  /** Una línea ya lista para el cable: el `{{origin}}` es el de quien pregunta. */
  const linea = (l: object | string, origen: string): string => (typeof l === "string" ? l : JSON.stringify(l)).replaceAll("{{origin}}", origen);

  async function stream(respuesta: { stream: (object | string)[] }, origen: string, retencion: Retencion | undefined, senal?: AbortSignal | null): Promise<Response> {
    const lineas = respuesta.stream.map((l) => linea(l, origen));
    const cabeceras = { "content-type": "application/x-ndjson" };
    if (retencion !== undefined && retencion.afterLines <= 0) await conSenal(retencion.puerta, senal);
    // Sin retención ni demora: el cuerpo entero de una vez, como un servidor que contesta rápido.
    if (retardo === 0 && (retencion === undefined || retencion.afterLines <= 0)) return new Response(lineas.map((l) => `${l}\n`).join(""), { status: 200, headers: cabeceras });
    const codificador = new TextEncoder();
    let i = 0;
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      async pull(controlador) {
        if (i >= lineas.length) return controlador.close();
        if (i > 0 && retardo > 0) await esperar(retardo);
        if (retencion !== undefined && retencion.afterLines > 0 && i === retencion.afterLines) await retencion.puerta;
        if (cancelado) return;
        controlador.enqueue(codificador.encode(`${lineas[i++]}\n`));
      },
      cancel() { cancelado = true; },
    });
    return new Response(cuerpo, { status: 200, headers: cabeceras });
  }

  async function contestarLaSesion(origen: string, senal?: AbortSignal | null): Promise<Response> {
    const retencion = retenciones.shift();
    const r: ScriptedResponse | undefined = vigente.responses[consumidas];
    if (r === undefined) {
      if (retencion !== undefined) await conSenal(retencion.puerta, senal);
      return json(409, { ok: false, motivo: "escenario_agotado" });
    }
    consumidas++;
    if ("http" in r) {
      if (retencion !== undefined) await conSenal(retencion.puerta, senal);
      return json(r.http, r.body);
    }
    return stream(r, origen, retencion, senal);
  }

  async function handle(p: FakeRequest): Promise<Response> {
    if (p.signal?.aborted) throw abortado();
    const u = new URL(p.url, `${url}/`);
    const metodo = p.method.toUpperCase();
    const kind = clasificar(metodo, u.pathname);
    let cuerpo: unknown;
    if (p.body !== undefined && p.body !== "") {
      try { cuerpo = JSON.parse(p.body); } catch { cuerpo = p.body; }
    }
    const anotado: RecordedRequest = { seq: pedidos.length + 1, kind, method: metodo, path: u.pathname + u.search, headers: p.headers ?? {}, ...(cuerpo === undefined ? {} : { body: cuerpo }) };
    pedidos.push(anotado);
    p.signal?.addEventListener("abort", () => { anotado.aborted = true; }, { once: true });
    const origen = p.origin ?? origenDeLaPagina();

    switch (kind) {
      case "availability": {
        const a = vigente.availability;
        // Como el backend de hoy, que siempre dice qué deja tomar el acuerdo de datos (`permite`); el de antes de la privacidad 1B se ve en `confirmation-from-older-backend`.
        return json(a?.status ?? 200, a?.body ?? { ok: true, motivo: null, marca: null, permite: { capturas: true, elementos: true, pagina_y_navegador: true } });
      }
      case "open":
      case "follow":
      case "recover":
        return contestarLaSesion(origen, p.signal);
      case "evidence": {
        const e = vigente.evidence?.[evidenciasGuionadas];
        if (e !== undefined) {
          evidenciasGuionadas++;
          return json(e.http, e.body);
        }
        return json(201, { ok: true, evidencia_id: `evd_${++evidenciasPorDefecto}` });
      }
      default:
        return json(404, { ok: false, motivo: "ruta_desconocida" });
    }
  }

  const fakeFetch = (async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const esRequest = typeof Request !== "undefined" && entrada instanceof Request;
    const metodo = init?.method ?? (esRequest ? entrada.method : "GET");
    const cabeceras = new Headers(esRequest ? entrada.headers : undefined);
    if (init?.headers !== undefined) new Headers(init.headers).forEach((v, k) => cabeceras.set(k, v));
    const enMinusculas: Record<string, string> = {};
    cabeceras.forEach((v, k) => { enMinusculas[k.toLowerCase()] = v; });
    const cuerpo = typeof init?.body === "string" ? init.body : init?.body === undefined && esRequest && metodo !== "GET" ? await entrada.clone().text() : undefined;
    return handle({
      method: metodo,
      url: typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      headers: enMinusculas,
      ...(cuerpo === undefined ? {} : { body: cuerpo }),
      signal: init?.signal ?? (esRequest ? entrada.signal : null),
    });
  }) as typeof fetch;

  return {
    get scenario() { return vigente; },
    url,
    fetch: fakeFetch,
    get requests() { return [...pedidos]; },
    get remaining() { return Math.max(0, vigente.responses.length - consumidas); },
    requestsOfKind: (kind) => pedidos.filter((p) => p.kind === kind),
    answers() {
      const salida: SentAnswer[] = [];
      for (const p of pedidos) {
        const r = p.kind === "follow" && typeof p.body === "object" && p.body !== null ? (p.body as { respuesta?: { requestId?: unknown; optionId?: unknown; text?: unknown } }).respuesta : undefined;
        if (r === undefined || r === null || typeof r.requestId !== "string") continue;
        salida.push({ seq: p.seq, requestId: r.requestId, ...(typeof r.optionId === "string" ? { optionId: r.optionId } : {}), ...(typeof r.text === "string" ? { text: r.text } : {}) });
      }
      return salida;
    },
    hold(opciones = {}) {
      let soltar!: () => void;
      const puerta = new Promise<void>((r) => { soltar = r; });
      retenciones.push({ afterLines: opciones.afterLines ?? 0, puerta, soltar });
      return soltar;
    },
    use(s) {
      vigente = typeof s === "string" ? getScenario(s) : s;
      reset();
    },
    reset,
    handle,
  };
}
