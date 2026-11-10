import type { OpcionesResueltas } from "../opciones";
import { ENCABEZADOS_DEL_CHAT } from "../contrato-del-chat";

// `GET /api/chat/estado`: ¿el chat de este proyecto está activo para este origen? Lo sondea el widget al montar (si no, se oculta) y lo
// puede sondear una interfaz propia antes de mostrar su botón. No consume tope. Devuelve el cuerpo tal cual: quien lo mira decide qué hacer.

export type CuerpoDeEstado = { ok?: boolean; motivo?: string | null; marca?: unknown; permite?: unknown } | null;

export interface RespuestaDeEstado {
  /** 0 si el pedido ni llegó. */
  status: number;
  cuerpo: CuerpoDeEstado;
  huboError: boolean;
}

export async function consultarDisponibilidad(
  o: Pick<OpcionesResueltas, "backendUrl" | "tenantId" | "projectId" | "previewToken">,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<RespuestaDeEstado> {
  const url = `${o.backendUrl}/api/chat/estado?tenant_id=${encodeURIComponent(o.tenantId)}&project_id=${encodeURIComponent(o.projectId)}`;
  try {
    // El token de preview también acá (§1 de la marca). Sin él, sin headers: el pedido tiene que seguir siendo simple (sin preflight).
    const r = await fetchFn(url, o.previewToken === null ? undefined : { headers: { [ENCABEZADOS_DEL_CHAT.preview]: o.previewToken } });
    const cuerpo = (await r.json().catch(() => null)) as CuerpoDeEstado;
    return { status: r.status, cuerpo, huboError: false };
  } catch {
    return { status: 0, cuerpo: null, huboError: true };
  }
}
