import { TEXTOS } from "../textos";
import type { Adjunto } from "./adjuntos";

// Lo que acompaña al reporte, dicho junto a la pregunta de confirmación (revisión de las herramientas del chat, 2026-10-30, §4.2): el título y el cuerpo que
// se confirman son exactos, pero la evidencia ya subida se enlaza al reporte aunque se haya quitado de la lista —el motor no tiene una operación para
// retirarla—, así que lo que se muestra acá es lo que de verdad viaja: los adjuntos `listo`. Los que todavía no subieron (o fallaron) se dicen aparte,
// porque no van. Sin adjuntos de ninguna clase no hay línea: no se agrega ruido a quien no adjuntó nada.

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

export function lineaDeLoQueAcompana(adjuntos: readonly Adjunto[]): string | null {
  if (adjuntos.length === 0) return null;
  const listos = adjuntos.filter((a) => a.estado === "listo");
  const sin = adjuntos.length - listos.length;
  const imagenes = listos.filter((a) => a.tipo === "captura").length;
  const elementos = listos.filter((a) => a.tipo === "elemento").length;
  const partes: string[] = [];
  if (imagenes > 0) partes.push(plural(imagenes, "image", "images"));
  if (elementos > 0) partes.push(plural(elementos, "pointed element", "pointed elements"));
  // Sólo se habla de lo que la PERSONA adjuntó (la URL y el navegador del primer turno también se enlazan, pero no son suyos): sin nada listo, sólo lo que falta.
  const que = partes.length > 0 ? `${TEXTOS.acompanaAlReporte} ${partes.join(", ")}.` : null;
  const falta = sin > 0 ? `${TEXTOS.aunNoAdjunto} ${sin}.` : null;
  return [que, falta].filter((x) => x !== null).join(" ") || null;
}
