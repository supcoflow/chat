import { describe, expect, it, vi } from "vitest";
import { normalizarOpciones } from "../opciones";
import { agregarCaptura, agregarElemento, sinAdjuntos } from "./adjuntos";
import { ELEMENTO, IMAGEN } from "./adjuntos.test";
import { cuerpoDeSubida, ESPERAS_MS, subirAdjunto } from "./subida";

const opciones = normalizarOpciones({ tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test" });
const elemento = agregarElemento(sinAdjuntos(), ELEMENTO).adjuntos[0];
const captura = agregarCaptura(sinAdjuntos(), IMAGEN).adjuntos[0];

function fetchEnSecuencia(respuestas: ({ status: number; cuerpo: unknown } | Error)[]) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init! });
    const r = respuestas.shift();
    if (r === undefined) throw new Error("fetch de más");
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.cuerpo), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, llamadas };
}
const sinEsperar = vi.fn(async () => {});

describe("cuerpoDeSubida", () => {
  it("elemento: session_id y la evidencia anidada con el contenido tal cual", () => {
    expect(JSON.parse(cuerpoDeSubida("01JS", elemento))).toEqual({ session_id: "01JS", evidencia: { tipo: "elemento", contenido: ELEMENTO } });
  });
  it("captura: base64 sin prefijo, mime, ancho y alto — nunca la miniatura", () => {
    expect(JSON.parse(cuerpoDeSubida("01JS", captura))).toEqual({ session_id: "01JS", evidencia: { tipo: "captura", imagen: "AAAA", mime: "image/webp", ancho: 800, alto: 600 } });
  });
});

describe("subirAdjunto", () => {
  it("POST a /api/evidencias con los headers de proyecto; un 201 devuelve el id", async () => {
    const { fn, llamadas } = fetchEnSecuencia([{ status: 201, cuerpo: { ok: true, evidencia_id: "evd_1" } }]);
    expect(await subirAdjunto(opciones, "01JS", elemento, { fetchFn: fn, esperar: sinEsperar })).toEqual({ ok: true, evidenciaId: "evd_1" });
    expect(llamadas[0].url).toBe("https://chat.test/api/evidencias");
    expect(llamadas[0].init.method).toBe("POST");
    expect(new Headers(llamadas[0].init.headers).get("x-supcoflow-tenant")).toBe("tnt_a");
    expect(new Headers(llamadas[0].init.headers).get("x-supcoflow-project")).toBe("proj_b");
  });
  it("con `sdk` manda x-supcoflow-sdk; sin él el header no existe", async () => {
    const a = fetchEnSecuencia([{ status: 201, cuerpo: { ok: true, evidencia_id: "evd_1" } }]);
    await subirAdjunto(opciones, "01JS", elemento, { fetchFn: a.fn, esperar: sinEsperar, sdk: "widget/9.9.9" });
    expect(new Headers(a.llamadas[0].init.headers).get("x-supcoflow-sdk")).toBe("widget/9.9.9");
    const b = fetchEnSecuencia([{ status: 201, cuerpo: { ok: true, evidencia_id: "evd_1" } }]);
    await subirAdjunto(opciones, "01JS", elemento, { fetchFn: b.fn, esperar: sinEsperar });
    expect(new Headers(b.llamadas[0].init.headers).has("x-supcoflow-sdk")).toBe(false);
  });
  it("sesion_desconocida es la carrera con el hook (Revisión 2 punto 3): reintenta con las tres esperas y después se rinde", async () => {
    const esperar = vi.fn(async (_ms: number) => {});
    const { fn } = fetchEnSecuencia([
      { status: 404, cuerpo: { ok: false, motivo: "sesion_desconocida" } },
      { status: 404, cuerpo: { ok: false, motivo: "sesion_desconocida" } },
      { status: 201, cuerpo: { ok: true, evidencia_id: "evd_2" } },
    ]);
    expect(await subirAdjunto(opciones, "01JS", elemento, { fetchFn: fn, esperar })).toEqual({ ok: true, evidenciaId: "evd_2" });
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([ESPERAS_MS[0], ESPERAS_MS[1]]);

    const { fn: siempre } = fetchEnSecuencia(Array.from({ length: 4 }, () => ({ status: 404, cuerpo: { ok: false, motivo: "sesion_desconocida" } })));
    expect(await subirAdjunto(opciones, "01JS", elemento, { fetchFn: siempre, esperar: sinEsperar })).toEqual({ ok: false, motivo: "sesion_desconocida", reintentable: true });
  });
  it("un fallo de red o un 5xx también se reintentan; un 400, 403 o 429 no", async () => {
    const { fn: red } = fetchEnSecuencia([new TypeError("Failed to fetch"), { status: 502, cuerpo: { ok: false, motivo: "motor_inalcanzable" } }, { status: 201, cuerpo: { ok: true, evidencia_id: "evd_3" } }]);
    expect(await subirAdjunto(opciones, "01JS", captura, { fetchFn: red, esperar: sinEsperar })).toEqual({ ok: true, evidenciaId: "evd_3" });
    const { fn: tope, llamadas } = fetchEnSecuencia([{ status: 429, cuerpo: { ok: false, motivo: "tope_de_evidencias" } }]);
    expect(await subirAdjunto(opciones, "01JS", captura, { fetchFn: tope, esperar: sinEsperar })).toEqual({ ok: false, motivo: "tope_de_evidencias", reintentable: false });
    expect(llamadas).toHaveLength(1);
    const { fn: apagado } = fetchEnSecuencia([{ status: 403, cuerpo: { ok: false, motivo: "chat_deshabilitado" } }]);
    expect(await subirAdjunto(opciones, "01JS", captura, { fetchFn: apagado, esperar: sinEsperar })).toEqual({ ok: false, motivo: "chat_deshabilitado", reintentable: false });
  });
  it("un 2xx sin id legible es un fallo no reintentable: reintentar duplicaría la fila", async () => {
    const { fn } = fetchEnSecuencia([{ status: 201, cuerpo: { ok: true } }]);
    expect(await subirAdjunto(opciones, "01JS", captura, { fetchFn: fn, esperar: sinEsperar })).toEqual({ ok: false, motivo: "respuesta_ilegible", reintentable: false });
  });
});

// Revisión 1 del núcleo, P2-2: `destroy()` promete cortar lo que está en vuelo; la subida de evidencia también (antes seguía y hasta reintentaba un POST nuevo).
describe("subirAdjunto con señal de cancelación", () => {
  it("la señal llega al fetch", async () => {
    const { fn, llamadas } = fetchEnSecuencia([{ status: 201, cuerpo: { ok: true, evidencia_id: "evd_1" } }]);
    const control = new AbortController();
    await subirAdjunto(opciones, "01JS", elemento, { fetchFn: fn, esperar: sinEsperar, senal: control.signal });
    expect(llamadas[0].init.signal).toBe(control.signal);
  });
  it("ya cancelada antes de empezar: no hace ningún pedido", async () => {
    const { fn, llamadas } = fetchEnSecuencia([]);
    const control = new AbortController();
    control.abort();
    expect(await subirAdjunto(opciones, "01JS", elemento, { fetchFn: fn, esperar: sinEsperar, senal: control.signal })).toEqual({ ok: false, motivo: "cancelado", reintentable: false });
    expect(llamadas).toEqual([]);
  });
  it("cancelada con el pedido en vuelo: termina `cancelado` y NO reintenta", async () => {
    const control = new AbortController();
    const llamadas: RequestInit[] = [];
    const fn = vi.fn((_u: string | URL | Request, init?: RequestInit) => {
      llamadas.push(init!);
      return new Promise<Response>((_ok, rechazar) => init!.signal!.addEventListener("abort", () => rechazar(new DOMException("aborted", "AbortError"))));
    }) as unknown as typeof fetch;
    const subida = subirAdjunto(opciones, "01JS", elemento, { fetchFn: fn, esperar: sinEsperar, senal: control.signal });
    control.abort();
    expect(await subida).toEqual({ ok: false, motivo: "cancelado", reintentable: false });
    expect(llamadas).toHaveLength(1);
  });
  it("cancelada durante la espera entre reintentos: no hace el pedido siguiente", async () => {
    const control = new AbortController();
    const { fn, llamadas } = fetchEnSecuencia([{ status: 404, cuerpo: { ok: false, motivo: "sesion_desconocida" } }, { status: 201, cuerpo: { ok: true, evidencia_id: "evd_9" } }]);
    // la espera real, abortable: si no respetara la señal tardaría 500 ms y haría el segundo pedido
    const subida = subirAdjunto(opciones, "01JS", elemento, { fetchFn: fn, senal: control.signal });
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    control.abort();
    expect(await subida).toEqual({ ok: false, motivo: "cancelado", reintentable: false });
    expect(llamadas).toHaveLength(1);
  });
});
