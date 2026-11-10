import type { Diagnostico } from "./opciones";

export type Visibilidad = "visible" | "oculto";

/** Una barra final en `backendUrl` ("https://x.com/", la forma más natural de escribirlo) deja
 * `//` duplicado en las URLs armadas: el motor responde con un 308 sin headers de CORS y el
 * navegador lo bloquea sin explicar que el problema es la barra. */
export function normalizarBackendUrl(backendUrl: string): string {
  return backendUrl.replace(/\/$/, "");
}

/** §2.4 del diseño: sin backend, sin tope, o ante cualquier duda, el widget NO se dibuja al
 * montar. Ocultarse es lo honesto: no hay nada que decirle al usuario final sobre el estado
 * interno del proyecto de otra empresa. */
export function decidirVisibilidad(h: { respuesta: { ok: boolean } | null; huboError: boolean }): Visibilidad {
  if (h.huboError || h.respuesta === null || !h.respuesta.ok) return "oculto";
  return "visible";
}

/** §2.5 del diseño: lo que el widget le cuenta al desarrollador. `decidirVisibilidad` sigue
 * decidiendo si se dibuja; esto sólo agrega el porqué. `motivo` viene del motor vía
 * `/api/chat/estado`; un backend viejo no lo manda y acá queda `null` — nunca se adivina. */
export function diagnosticoDesdeRespuesta(h: {
  status: number;
  cuerpo: { ok?: boolean; motivo?: string | null } | null;
  huboError: boolean;
}): Diagnostico {
  if (h.huboError || h.cuerpo === null) return { visible: false, status: h.status, motivo: "sin_respuesta" };
  const visible = decidirVisibilidad({ respuesta: { ok: h.cuerpo.ok === true }, huboError: false }) === "visible";
  return { visible, status: h.status, motivo: visible ? null : (h.cuerpo.motivo ?? null) };
}

/** 2.3.0 (T0.5, spec §12.3 punto 4): lo que el acuerdo de datos del proyecto deja ofrecer. Es
 * COMODIDAD, no el control: el control es el filtro del backend antes de eve y el del motor al
 * guardar, que siguen ahí para un widget viejo o modificado. Por eso falla ABIERTO —al revés que el
 * backend—: sólo un `false` explícito esconde algo, y sin `permite` (backend viejo, o proyecto sin
 * acuerdo fijado) todo queda como en la 2.2.1. Lo peor que pasa es ofrecer algo que se va a tirar. */
export interface PermisosDelWidget {
  /** «Take a screenshot», «Attach an image» y «Capture this element». */
  capturas: boolean;
  /** «Pick an element». */
  elementos: boolean;
  /** La URL y el navegador del contexto automático, y la página del elemento señalado. */
  paginaYNavegador: boolean;
}

export const PERMISOS_COMO_HOY: PermisosDelWidget = Object.freeze({ capturas: true, elementos: true, paginaYNavegador: true });

export function permisosDesdeRespuesta(cuerpo: { ok?: boolean; permite?: unknown } | null): PermisosDelWidget {
  const p = cuerpo?.permite;
  if (typeof p !== "object" || p === null) return PERMISOS_COMO_HOY;
  const crudo = p as Record<string, unknown>;
  return { capturas: crudo.capturas !== false, elementos: crudo.elementos !== false, paginaYNavegador: crudo.pagina_y_navegador !== false };
}
