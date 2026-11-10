import { TEMA_POR_DEFECTO, type TemaDelChat } from "./opciones";

const ORDEN: (keyof TemaDelChat)[] = ["acento", "fondo", "texto", "textoSuave", "radio", "fuente"];

// Un valor de tema es una cadena que el CLIENTE escribe en su HTML/JS: se admite cualquier color
// o fuente, pero no puede cerrar la declaración ni el bloque (`;`, `{`, `}` → cae el default).
// No es una defensa contra el cliente (es su sitio), es contra un tema que llegue por `data-*`
// de una plantilla mal escapada.
const INADMISIBLE = /[;{}]/;

/**
 * El color del texto que va ENCIMA del acento (2.2.0, hallazgo 2 del spec del 2026-09-11).
 *
 * Hasta la 2.1.0 el CSS tenía `color: #fff` fijo sobre el acento en cinco lugares, y el acento
 * guardado en producción para el proyecto de prueba era `#fcba03`: blanco sobre amarillo. Acá se
 * calcula la luminancia relativa (WCAG 2.x) y se elige oscuro si el acento es claro. Se parsean
 * `#rgb`, `#rrggbb`, `rgb()` y `rgba()`, que es lo que un cliente escribe; un nombre de color o
 * un `var()` no se parsea y cae a blanco, que es exactamente lo de antes — nunca peor.
 */
export function sobreAcento(acento: string): "#ffffff" | "#111111" {
  const rgb = parsearColor(acento.trim());
  if (rgb === null) return "#ffffff";
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminancia > 0.4 ? "#111111" : "#ffffff";
}

function parsearColor(v: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex !== null) {
    const h = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(v);
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

export function variablesDelTema(tema: TemaDelChat): string {
  const saneado = {} as TemaDelChat;
  for (const k of ORDEN) saneado[k] = INADMISIBLE.test(tema[k]) ? TEMA_POR_DEFECTO[k] : tema[k];
  const variables = ORDEN.map((k) => {
    const nombre = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    return `--scf-${nombre}:${saneado[k]}`;
  });
  // Derivada, no configurable: se calcula sobre el acento YA saneado para que un acento
  // inadmisible no deje un texto ilegible sobre el default.
  variables.push(`--scf-sobre-acento:${sobreAcento(saneado.acento)}`);
  return variables.join(";");
}
