import { ENCABEZADO_SDK } from "../core/version";
import type { OpcionesResueltas } from "../opciones";
import type { Adjunto } from "./adjuntos";
import { ENCABEZADOS_DEL_CHAT } from "../contrato-del-chat";

// La subida de un adjunto (§3.3, canal 2): `POST {backendUrl}/api/evidencias`, en el momento de
// adjuntar y no al enviar el mensaje. El backend cuenta cada subida contra el tope y reenvía al
// motor; acá sólo se arma el cuerpo y se decide qué reintentar.
//
// El reintento existe por una carrera concreta (Revisión 2 punto 3): el motor contesta 404
// `sesion_desconocida` hasta que el hook de Eve escribe `chat_conversaciones`, y el widget recibe
// `sesion` en la primera línea del stream, antes de que ese POST haya llegado. Tres esperas cortas
// alcanzan de sobra. Un 429 (tope), un 4xx de validación o un 403 no se reintentan: el motor ya
// dijo que no. Un 2xx sin id tampoco: la fila probablemente existe y reintentar la duplicaría.

export type ResultadoDeSubida = { ok: true; evidenciaId: string } | { ok: false; motivo: string; reintentable: boolean };

export const ESPERAS_MS = [500, 1500, 4000];

export function cuerpoDeSubida(sessionId: string, a: Adjunto): string {
  const evidencia =
    a.tipo === "elemento"
      ? { tipo: "elemento", contenido: a.elemento }
      : { tipo: "captura", imagen: a.imagen.base64, mime: a.imagen.mime, ancho: a.imagen.ancho, alto: a.imagen.alto };
  return JSON.stringify({ session_id: sessionId, evidencia });
}

/** Una espera que la cancelación corta: si la señal se aborta, termina de inmediato (quien llamó vuelve a mirar la señal). */
const dormir = (ms: number, senal?: AbortSignal): Promise<void> =>
  new Promise((resolver) => {
    const reloj = setTimeout(resolver, ms);
    senal?.addEventListener("abort", () => { clearTimeout(reloj); resolver(); }, { once: true });
  });
const CANCELADO: ResultadoDeSubida = { ok: false, motivo: "cancelado", reintentable: false };

function esReintentable(status: number, motivo: string): boolean {
  return motivo === "sesion_desconocida" || status >= 500 || status === 0;
}

export async function subirAdjunto(
  o: OpcionesResueltas,
  sessionId: string,
  a: Adjunto,
  deps: { fetchFn?: typeof fetch; esperar?: (ms: number, senal?: AbortSignal) => Promise<void>; /** El valor del encabezado de la versión del cliente (`ENCABEZADOS_DEL_CHAT.sdk`); sin él el header no existe. */ sdk?: string; /** Corta el pedido en vuelo y las esperas entre reintentos. Lo que el servidor ya aceptó no se deshace. */ senal?: AbortSignal } = {},
): Promise<ResultadoDeSubida> {
  const fetchFn = deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const esperar = deps.esperar ?? dormir;
  const cuerpo = cuerpoDeSubida(sessionId, a);
  let ultimo: ResultadoDeSubida = { ok: false, motivo: "red", reintentable: true };

  for (let intento = 0; intento <= ESPERAS_MS.length; intento++) {
    if (deps.senal?.aborted) return CANCELADO;
    if (intento > 0) {
      await esperar(ESPERAS_MS[intento - 1]!, deps.senal);
      if (deps.senal?.aborted) return CANCELADO;
    }
    let status = 0;
    let motivo = "red";
    try {
      const r = await fetchFn(`${o.backendUrl}/api/evidencias`, {
        method: "POST",
        headers: { "content-type": "application/json", [ENCABEZADOS_DEL_CHAT.tenant]: o.tenantId, [ENCABEZADOS_DEL_CHAT.project]: o.projectId, ...(deps.sdk === undefined ? {} : { [ENCABEZADO_SDK]: deps.sdk }) },
        body: cuerpo,
        ...(deps.senal === undefined ? {} : { signal: deps.senal }),
      });
      status = r.status;
      const datos = (await r.json().catch(() => null)) as { ok?: boolean; evidencia_id?: unknown; motivo?: unknown } | null;
      if (r.ok) {
        if (datos !== null && typeof datos.evidencia_id === "string") return { ok: true, evidenciaId: datos.evidencia_id };
        return { ok: false, motivo: "respuesta_ilegible", reintentable: false };
      }
      motivo = datos !== null && typeof datos.motivo === "string" ? datos.motivo : `http_${r.status}`;
    } catch (e) {
      if (deps.senal?.aborted) return CANCELADO;
      motivo = e instanceof Error && e.name !== "TypeError" ? e.message : "red";
    }
    ultimo = { ok: false, motivo, reintentable: esReintentable(status, motivo) };
    if (!ultimo.reintentable) return ultimo;
  }
  return ultimo;
}
