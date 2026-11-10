import { ENCABEZADO_DE_CAPACIDADES, valorDelEncabezadoDeCapacidades, type CapacidadesDeclaradas } from "./capacidades";
import { ENCABEZADO_SDK } from "./core/version";
import type { OpcionesResueltas } from "./opciones";
import type { EventoDelWidget } from "./protocolo";
import { normalizarEvento } from "./validar-evento";
import { ENCABEZADOS_DEL_CHAT } from "./contrato-del-chat";

// El cliente del formato v1 (§1.5 del diseño): un POST, leer NDJSON línea a línea, nada más. Es
// lo que reemplaza a `eve/client` en el navegador — esbuild lo mide en unas decenas de líneas
// en vez de 139 KB gzip. Un fallo HTTP o de red se vuelve UN evento `error` y el stream termina,
// así el reducer tiene un solo camino.

export type Respuesta = { requestId: string; optionId?: string; text?: string };

/** `senal` (opcional) corta el pedido en vuelo: lo usa el núcleo al destruirse para no dejar un stream abierto. */
export interface ClienteDelChat {
  abrir(mensaje: string, contexto: Record<string, string> | undefined, senal?: AbortSignal): AsyncIterable<EventoDelWidget>;
  /** `contexto` en un mensaje de seguimiento (Revisión 2 punto 5): el resumen acumulado de la
   * evidencia va en CADA turno, porque clientContext de Eve es por turno. */
  seguir(id: string, indice: number, cuerpo: { mensaje: string; contexto?: Record<string, string> } | { respuesta: Respuesta }, senal?: AbortSignal): AsyncIterable<EventoDelWidget>;
  recuperar(id: string, desde: number, senal?: AbortSignal): AsyncIterable<EventoDelWidget>;
}

/** El `error` que el cliente inventa cuando el servidor contestó con un HTTP de rechazo con su `motivo` (`{ ok: false, motivo }`, sin stream). Esas respuestas las
 * escribe el backend ANTES de tocar al agente (admisión, sello, validación del cuerpo; después de eve el pedido siempre contesta 200 con un stream), así que el turno
 * NO corrió y mandar el mismo pedido otra vez no lo duplica. Un corte de red o un 5xx sin motivo (una pasarela) no llevan la marca: ahí el pedido pudo llegar.
 * Reenviar vuelve a pasar por la admisión del motor: puede contar otra fila del tope de mensajes, nunca otro turno. El preview ve cada intento (`enviado`/`respondido`).
 * El servidor nunca la manda; es del cliente y se queda en el navegador. */
export type ErrorDeRechazo = Extract<EventoDelWidget, { t: "error" }> & { rechazado: true };

/** Una línea que no es un evento v1 —o es uno conocido mal formado— es `null`: el lector la salta y sigue. Un `t` desconocido
 * SÍ pasa — es la regla de compatibilidad: el reducer lo ignora. */
export function parsearLinea(linea: string): EventoDelWidget | null {
  if (linea.trim() === "") return null;
  try {
    const v = JSON.parse(linea) as { v?: unknown; t?: unknown };
    if (v === null || typeof v !== "object" || v.v !== 1 || typeof v.t !== "string") return null;
    // Un evento conocido mal formado se salta como una línea que no es v1 (revisión 1, P2-3); uno desconocido pasa.
    return normalizarEvento(v);
  } catch {
    return null;
  }
}

export async function* leerNdjson(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<EventoDelWidget> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  let terminoElCuerpo = false;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) {
        terminoElCuerpo = true;
        break;
      }
      resto += decodificador.decode(value, { stream: true });
      const lineas = resto.split("\n");
      resto = lineas.pop() ?? "";
      for (const l of lineas) {
        const e = parsearLinea(l);
        if (e !== null) yield e;
      }
    }
    const ultima = parsearLinea(resto + decodificador.decode());
    if (ultima !== null) yield ultima;
  } finally {
    // Quien consume puede abandonar la lectura antes del final (el borde de un turno): soltar el lock NO cierra el pedido, hay que cancelar el cuerpo.
    // Es el cuerpo de ESTE pedido; no toca la señal global del chat (un oyente pudo haber arrancado el turno siguiente).
    if (!terminoElCuerpo) await lector.cancel().catch(() => {});
    lector.releaseLock();
  }
}

/** `sdk` es el valor de `x-supcoflow-sdk` (`core/2.3.1`, `widget/2.3.1`): la versión del cliente, para que Supcoflow sepa qué copias andan por ahí. Sin él el header no existe. */
export function crearCliente(
  o: OpcionesResueltas,
  fetchFn: typeof fetch = (...a) => fetch(...a),
  extra: {
    sdk?: string;
    /** El idioma de la app (`x-supcoflow-locale`): las palabras fijas de la confirmación. Sin él el header no existe. */
    locale?: string;
    /** Lo que la interfaz ofrece de verdad (`x-supcoflow-capabilities`, T7). Se LEE en cada pedido (lo que se puede ofrecer cambia: el navegador puede o no capturar la pantalla). Sin él el header no existe. */
    capacidades?: () => CapacidadesDeclaradas;
  } = {},
): ClienteDelChat {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [ENCABEZADOS_DEL_CHAT.tenant]: o.tenantId,
    [ENCABEZADOS_DEL_CHAT.project]: o.projectId,
    ...(extra.sdk === undefined ? {} : { [ENCABEZADO_SDK]: extra.sdk }),
    ...(extra.locale === undefined ? {} : { [ENCABEZADOS_DEL_CHAT.locale]: extra.locale }),
    // §1 del diseño de la marca: el token de preview va en CADA pedido; el backend lo reenvía al motor
    // sin mirarlo. Sólo si existe: el tráfico normal es byte por byte el de la 2.0.0.
    ...(o.previewToken === null ? {} : { [ENCABEZADOS_DEL_CHAT.preview]: o.previewToken }),
  };

  /** Los encabezados de ESTE pedido: los fijos y, si la interfaz declara capacidades, lo que ofrece en este momento. */
  const encabezados = (): Record<string, string> =>
    extra.capacidades === undefined ? headers : { ...headers, [ENCABEZADO_DE_CAPACIDADES]: valorDelEncabezadoDeCapacidades(extra.capacidades()) };

  async function* pedir(url: string, init: RequestInit, senal?: AbortSignal): AsyncGenerator<EventoDelWidget> {
    let r: Response;
    try {
      r = await fetchFn(url, { ...init, headers: encabezados(), ...(senal === undefined ? {} : { signal: senal }) });
    } catch (e) {
      yield { v: 1, t: "error", codigo: "red", mensaje: e instanceof Error ? e.message : String(e), terminal: false };
      return;
    }
    if (!r.ok || r.body === null) {
      // La admisión contesta con status y `{ ok:false, motivo }`; se reenvía el motivo tal cual.
      let motivo = `http_${r.status}`;
      let conMotivo = false;
      try {
        const c = (await r.json()) as { motivo?: unknown };
        if (typeof c.motivo === "string") {
          motivo = c.motivo;
          conMotivo = true;
        }
      } catch {
        // sin cuerpo legible, queda el status
      }
      const error: EventoDelWidget = { v: 1, t: "error", codigo: motivo, mensaje: `HTTP ${r.status}`, terminal: false };
      yield conMotivo ? ({ ...error, rechazado: true } as ErrorDeRechazo) : error;
      return;
    }
    yield* leerNdjson(r.body);
  }

  return {
    abrir: (mensaje, contexto, senal) =>
      pedir(`${o.backendUrl}/api/chat/sesion`, { method: "POST", body: JSON.stringify(contexto === undefined ? { mensaje } : { mensaje, contexto }) }, senal),
    seguir: (id, indice, cuerpo, senal) =>
      pedir(`${o.backendUrl}/api/chat/sesion/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ indice, ...cuerpo }) }, senal),
    recuperar: (id, desde, senal) =>
      pedir(`${o.backendUrl}/api/chat/sesion/${encodeURIComponent(id)}/eventos?desde=${desde}`, { method: "GET" }, senal),
  };
}
