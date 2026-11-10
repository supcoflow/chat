import { MESSAGE_MAX_LENGTH, pasteSize } from "./core/texto-pegado";
import { TEXTOS } from "./textos";

// El pegado largo en el compositor del widget (pedido del dueño, 2026-10-30): lo pegado no entra al textarea; en su lugar queda una marca («[pasted text]») y el
// texto completo se guarda aparte. Al enviar, la marca se reemplaza por el texto: se manda COMPLETO. Puro, para probarlo sin DOM. Qué es «largo» lo decide el núcleo (`isLongPaste`).

/** El tope de un mensaje: el del núcleo (`MESSAGE_MAX_LENGTH`), que es el del backend (`TAMANO_MAXIMO_MENSAJE` en la ruta de sesión del backend del chat; literal a propósito, paquetes separados). */
export const MAX_MENSAJE = MESSAGE_MAX_LENGTH;

export interface Pegado {
  /** Lo que se ve en el textarea en lugar del texto. Única entre los pegados vigentes. */
  marca: string;
  texto: string;
}

const base = (): string => TEXTOS.textoPegado;
const marcaNumero = (n: number): string => (n === 1 ? base() : `${base().slice(0, -1)} #${n}]`);

/** Los pegados cuya marca sigue en el texto (la persona pudo borrarla). */
const vigentes = (valor: string, pegados: readonly Pegado[]): Pegado[] => pegados.filter((p) => valor.includes(p.marca));
export const vigentesDe = vigentes;

const MAX_PRIMERA_LINEA = 60;
/** Lo que se muestra de un pegado antes de mandarlo: cuánto es y su primera línea no vacía (acotada), para notar un portapapeles equivocado. */
export function resumenDelPegado(texto: string): { characters: number; lines: number; primeraLinea: string } {
  const primera = (texto.split(/\r\n|\r|\n/).find((l) => l.trim() !== "") ?? "").trim();
  const letras = Array.from(primera);
  return { ...pasteSize(texto), primeraLinea: letras.length <= MAX_PRIMERA_LINEA ? primera : `${letras.slice(0, MAX_PRIMERA_LINEA - 1).join("")}…` };
}

/** Lo que de verdad se manda: el largo del texto con cada marca (la primera vez que aparece) reemplazada por su texto. */
export function largoExpandido(valor: string, pegados: readonly Pegado[]): number {
  return valor.length + vigentes(valor, pegados).reduce((suma, p) => suma + p.texto.length - p.marca.length, 0);
}

/** Reemplaza cada marca (la primera vez que aparece) por su texto completo, en su lugar. Una sola pasada: lo pegado se manda tal cual, aunque contenga otra marca o `$&`. */
export function expandirPegados(valor: string, pegados: readonly Pegado[]): string {
  const apariciones = vigentes(valor, pegados)
    .map((p) => ({ pos: valor.indexOf(p.marca), p }))
    .sort((a, b) => a.pos - b.pos);
  let salida = "";
  let cursor = 0;
  for (const { pos, p } of apariciones) {
    if (pos < cursor) continue; // marcas encimadas: no pasa con las que fabrica este módulo
    salida += valor.slice(cursor, pos) + p.texto;
    cursor = pos + p.marca.length;
  }
  return salida + valor.slice(cursor);
}

/** Pega `texto` en el lugar de la selección: pone una marca y guarda el texto (con los saltos como `\n`, como el textarea con lo tipeado). Si no entra completo en el mensaje se corta donde éste termina y
 * `recortado` dice cuántos caracteres quedaron afuera (quien llama TIENE que avisarle a la persona); si no entra nada, no cambia nada y `cursor` es `null`. */
export function insertarPegado(
  valor: string,
  pegados: readonly Pegado[],
  pegado: { texto: string; inicio: number; fin: number },
  max: number = MAX_MENSAJE,
): { valor: string; pegados: Pegado[]; cursor: number | null; entraron: number; recortado: number } {
  const texto = pegado.texto.replace(/\r\n?/g, "\n");
  const inicio = Math.max(0, Math.min(pegado.inicio, valor.length));
  const fin = Math.max(inicio, Math.min(pegado.fin, valor.length));
  const antes = valor.slice(0, inicio);
  const despues = valor.slice(fin);
  const resto = antes + despues;
  const quedan = vigentes(resto, pegados);
  const lugar = max - largoExpandido(resto, quedan);
  if (lugar <= 0) return { valor, pegados: [...pegados], cursor: null, entraron: 0, recortado: texto.length };
  let n = 1;
  while (resto.includes(marcaNumero(n))) n++;
  const marca = marcaNumero(n);
  const guardado = texto.slice(0, lugar);
  return {
    valor: antes + marca + despues,
    pegados: [...quedan, { marca, texto: guardado }],
    cursor: antes.length + marca.length,
    entraron: guardado.length,
    recortado: texto.length - guardado.length,
  };
}
