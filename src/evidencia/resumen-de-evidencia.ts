import type { Adjunto } from "./adjuntos";
import type { ElementoSeleccionado } from "./elemento";
import type { PermisosDelWidget } from "../estado-del-widget";

// Lo ÚNICO que el modelo del chat ve de la evidencia (§3.3, canal 1): qué elemento señaló el usuario,
// en qué página, y cuántas capturas hay. Nunca ids (el modelo no toca la evidencia, así no puede
// inventar ni confundir adjuntos), nunca HTML (entra al prompt como texto de un desconocido y 4 KB
// de markup no le sirven para repreguntar), nunca bytes. Viaja en el `contexto` de cada turno,
// ACUMULADO: `clientContext` de Eve no persiste en la historia, y así el modelo siempre sabe qué hay
// aunque el turno en que se adjuntó ya pasó.
//
// 2.3.0 (T0.6, spec §12.3 de la etapa 1, R1): hasta la 2.2.1 esto era UN string, `evidencia`, que
// mezclaba el elemento, la URL de la página y la cuenta de capturas. El acuerdo de datos tiene un
// permiso para cada una y un filtro por clave no puede separar tres permisos dentro de un valor:
// ahora son tres claves planas, `evidencia_elemento` (sin URL), `evidencia_elemento_pagina` y
// `evidencia_capturas`, con DATOS y no frases — la frase para el modelo la arma el backend DESPUÉS
// de filtrar. `evidencia` ya no se manda.

/** Por debajo de `MAX_LARGO_DE_VALOR` (1.500) del backend. */
export const MAX_RESUMEN_CHARS = 1_400;

/** MAX_LARGO_DE_VALOR del traductor del backend del chat, espejado a mano:
 * ningún valor de las tres claves lo pasa. */
export const MAX_VALOR_DE_CONTEXTO = 1_500;

/** La página del elemento: el mismo recorte que la `url` del contexto automático (`contexto.ts`). */
const MAX_PAGINA = 500;

function corto(s: string, max: number): string {
  const limpio = s.replace(/ \(truncated\)$/, "");
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1)}…`;
}

/** Tag, texto, selector, ruta en el DOM y dos líneas de estilo. SIN la URL de la página: esa pide
 * otro permiso (`pagina_y_navegador`) y viaja en `evidencia_elemento_pagina`. */
export function resumenDelElemento(el: ElementoSeleccionado): string {
  const t = el.target;
  const texto = (t.accessibility.accessibleName ?? t.textSnippet).replace(/ \(truncated\)$/, "").trim();
  const e = t.computedStyles;
  const lineas = [
    `<${t.tagName}>${texto ? ` "${corto(texto, 120)}"` : ""}`,
    `selector: ${corto(t.selector, 400)}`,
    `path: ${corto(t.elementPath, 300)}`,
    `style: display ${e.display}, position ${e.position}, ${e.width}×${e.height}`,
    `color ${e.color}, background ${e.backgroundColor}, font ${corto(e.fontFamily ?? "", 60)} ${e.fontSize}`,
  ];
  return corto(lineas.join("; "), MAX_RESUMEN_CHARS);
}

/** Las claves de evidencia del turno, o `undefined` si no hay nada que contar. Sin el permiso
 * `pagina_y_navegador` (T0.5) la página del elemento no se manda: es comodidad, el backend la
 * filtraría igual. Un adjunto en `fallo` no cuenta (no va a llegar al reporte). */
export function contextoDeEvidencia(
  adjuntos: readonly Adjunto[],
  permite: Partial<Pick<PermisosDelWidget, "paginaYNavegador" | "elementos" | "capturas">> = {},
): Record<string, string> | undefined {
  const vivos = adjuntos.filter((a) => a.estado !== "fallo");
  const elementos = vivos.filter((a): a is Extract<Adjunto, { tipo: "elemento" }> => a.tipo === "elemento");
  const capturas = vivos.filter((a) => a.tipo === "captura").length;
  const r: Record<string, string> = {};
  const ultimo = elementos[elementos.length - 1];
  // Un permiso ausente es «sí» (como hoy); sólo un `false` explícito quita la clave. Es comodidad: el backend lo filtra igual.
  if (ultimo !== undefined && permite.elementos !== false) {
    r.evidencia_elemento = resumenDelElemento(ultimo.elemento);
    if (permite.paginaYNavegador !== false) r.evidencia_elemento_pagina = corto(ultimo.elemento.page.sanitizedUrl, MAX_PAGINA);
  }
  if (capturas > 0 && permite.capturas !== false) r.evidencia_capturas = String(capturas);
  return Object.keys(r).length === 0 ? undefined : r;
}
