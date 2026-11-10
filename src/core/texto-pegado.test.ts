import { describe, expect, it } from "vitest";
import * as nucleo from "./index";
import { isLongPaste, MESSAGE_MAX_LENGTH, PASTE_LIMITS, pasteSize } from "./texto-pegado";

// Pedido del dueño (2026-10-30): el texto copiado y pegado que supera un límite se muestra COLAPSADO («[pasted text]», que se puede expandir) y se envía COMPLETO.
// El núcleo no dibuja nada: da el criterio de qué es «largo» para que toda interfaz colapse lo mismo (contrato de presentación, P15).
describe("PASTE_LIMITS", () => {
  it("el límite propuesto: más de 1.000 caracteres o más de 10 líneas", () => {
    expect(PASTE_LIMITS).toEqual({ characters: 1000, lines: 10 });
  });
  it("es de sólo lectura", () => {
    expect(Object.isFrozen(PASTE_LIMITS)).toBe(true);
  });
  it("cabe en un mensaje (4.000 caracteres): lo colapsado nunca es lo que el servidor rechaza", () => {
    expect(PASTE_LIMITS.characters).toBeLessThan(4000);
  });
});

describe("isLongPaste", () => {
  it("1.000 caracteres es el borde de lo corto; 1.001, largo", () => {
    expect(isLongPaste("x".repeat(1000))).toBe(false);
    expect(isLongPaste("x".repeat(1001))).toBe(true);
  });
  it("10 líneas es lo corto; 11, largo", () => {
    expect(isLongPaste(Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n"))).toBe(false);
    expect(isLongPaste(Array.from({ length: 11 }, (_, i) => `l${i}`).join("\n"))).toBe(true);
  });
  it("cuenta igual \\n, \\r\\n y \\r", () => {
    for (const salto of ["\n", "\r\n", "\r"]) {
      expect(isLongPaste(Array.from({ length: 11 }, () => "a").join(salto)), JSON.stringify(salto)).toBe(true);
      expect(isLongPaste(Array.from({ length: 10 }, () => "a").join(salto)), JSON.stringify(salto)).toBe(false);
    }
  });
  it("un texto vacío, o que no es un texto, no es un pegado largo", () => {
    expect(isLongPaste("")).toBe(false);
    for (const x of [null, undefined, 5, {}]) expect(isLongPaste(x as unknown as string)).toBe(false);
  });
  it("los límites se pueden pasar (una interfaz con otro criterio) y valen para las dos medidas", () => {
    expect(isLongPaste("x".repeat(51), { characters: 50, lines: 10 })).toBe(true);
    expect(isLongPaste("a\nb\nc", { characters: 1000, lines: 2 })).toBe(true);
    expect(isLongPaste("a\nb", { characters: 1000, lines: 2 })).toBe(false);
  });
  it("un texto corto de pocas líneas, o una frase normal, pasa sin colapsar", () => {
    expect(isLongPaste("The save button does nothing")).toBe(false);
    expect(isLongPaste("Error:\n  at foo (bar.js:1)\n  at baz (qux.js:2)")).toBe(false);
  });
});

describe("MESSAGE_MAX_LENGTH (revisión 2, N1)", () => {
  it("el tope de un mensaje lo exporta el núcleo: 4.000 caracteres, el del backend", () => {
    expect(MESSAGE_MAX_LENGTH).toBe(4000);
    expect(nucleo.MESSAGE_MAX_LENGTH).toBe(MESSAGE_MAX_LENGTH);
  });
});

describe("un salto de línea final no es una línea más (revisión 2, N7)", () => {
  it("lo que se copia de una consola termina en \n: diez líneas con su salto final son diez", () => {
    expect(pasteSize("a\n".repeat(10)).lines).toBe(10);
    expect(isLongPaste("a\n".repeat(10))).toBe(false);
    expect(isLongPaste("a\n".repeat(11))).toBe(true);
    expect(pasteSize("a\r\n".repeat(10)).lines).toBe(10);
  });
  it("una línea vacía en el medio sí cuenta, y un texto de un salto solo es una línea", () => {
    expect(pasteSize("a\n\nb").lines).toBe(3);
    expect(pasteSize("\n").lines).toBe(1);
  });
});

describe("pasteSize", () => {
  it("caracteres y líneas, con el mismo criterio de saltos", () => {
    expect(pasteSize("")).toEqual({ characters: 0, lines: 0 });
    expect(pasteSize("a")).toEqual({ characters: 1, lines: 1 });
    expect(pasteSize("a\nb\r\nc\rd")).toEqual({ characters: 8, lines: 4 });
  });
});

describe("el núcleo lo exporta", () => {
  it("`isLongPaste`, `pasteSize` y `PASTE_LIMITS` salen de `@supcoflow/chat/core`", () => {
    expect(nucleo.isLongPaste).toBe(isLongPaste);
    expect(nucleo.pasteSize).toBe(pasteSize);
    expect(nucleo.PASTE_LIMITS).toBe(PASTE_LIMITS);
  });
});
