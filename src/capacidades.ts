// Las CAPACIDADES que una interfaz declara (plan «ui-agnóstico», T7). El servidor se las cuenta al modelo EN PALABRAS para que ofrezca sólo lo que esa interfaz tiene de verdad, y las recorta por lo que el
// acuerdo de datos del proyecto permite (el traductor del backend del chat). Es una GUÍA para el modelo, no un permiso: la evidencia sigue pasando por su ruta, con su tope.
//
// Viaja en el encabezado `x-supcoflow-capabilities` (aditivo en el protocolo v1) en los tres pedidos de sesión, como `x-supcoflow-locale`. El valor es la lista de nombres ofrecidos separados por coma, o `none`.

import { CAPACIDADES_DEL_CHAT, ENCABEZADOS_DEL_CHAT } from "./contrato-del-chat";

export const ENCABEZADO_DE_CAPACIDADES = ENCABEZADOS_DEL_CHAT.capacidades;

/** Los nombres cerrados, en el orden en que viajan. */
export const NOMBRES_DE_CAPACIDADES = CAPACIDADES_DEL_CHAT;
export type NombreDeCapacidad = (typeof NOMBRES_DE_CAPACIDADES)[number];
export type CapacidadesDeclaradas = Partial<Record<NombreDeCapacidad, boolean>>;

/** Lo ofrecido → el valor del encabezado. Sólo cuenta lo que es EXACTAMENTE `true`; sin nada ofrecido, `none` (declarar poco es seguro; no declarar, no). */
export function valorDelEncabezadoDeCapacidades(c: CapacidadesDeclaradas): string {
  const hay = NOMBRES_DE_CAPACIDADES.filter((k) => c[k] === true);
  return hay.length === 0 ? "none" : hay.join(",");
}
