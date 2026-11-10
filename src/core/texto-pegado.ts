// Qué es un pegado LARGO (pedido del dueño, 2026-10-30): el texto copiado y pegado que supera un límite se dibuja COLAPSADO (una marca corta, «[pasted text]» en el
// widget, que se puede expandir) en vez del texto entero, y se manda COMPLETO. El núcleo no dibuja: da el criterio, para que toda interfaz colapse lo mismo
// (contrato de presentación, P15). Los textos de la marca son de cada interfaz.

/** Más de 1.000 caracteres O más de 10 líneas. Propuesta: 1.000 son un párrafo largo o una captura de consola; 10 líneas, un log o un código. Los dos quedan lejos del tope del
 * mensaje (4.000 caracteres), así que lo colapsado cabe siempre. */
export const PASTE_LIMITS: Readonly<{ characters: number; lines: number }> = Object.freeze({ characters: 1000, lines: 10 });

/** El tope de un mensaje: 4.000 caracteres (el del servidor, que contesta 400 a uno más largo). Un pegado que no entra entero se corta ahí: la interfaz tiene que decírselo a la persona. */
export const MESSAGE_MAX_LENGTH = 4000;

/** Cuántos caracteres y cuántas líneas tiene un texto. Los saltos `\n`, `\r\n` y `\r` cuentan igual; el vacío tiene cero líneas y un salto final no es una línea más
 * (lo que se copia de una consola termina en `\n`). */
export function pasteSize(text: string): { characters: number; lines: number } {
  if (text === "") return { characters: 0, lines: 0 };
  const lineas = text.split(/\r\n|\r|\n/);
  if (lineas.length > 1 && lineas[lineas.length - 1] === "") lineas.pop();
  return { characters: text.length, lines: lineas.length };
}

/** ¿Hay que mostrar este texto colapsado? Sirve para lo que la persona acaba de pegar y para un mensaje suyo ya enviado (tras recargar, lo pegado no se distingue de lo tipeado). */
export function isLongPaste(text: string, limits: { characters: number; lines: number } = PASTE_LIMITS): boolean {
  if (typeof text !== "string" || text === "") return false;
  const { characters, lines } = pasteSize(text);
  return characters > limits.characters || lines > limits.lines;
}
