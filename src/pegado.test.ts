import { describe, expect, it } from "vitest";
import { MESSAGE_MAX_LENGTH } from "./core/texto-pegado";
import { expandirPegados, insertarPegado, largoExpandido, MAX_MENSAJE, type Pegado } from "./pegado";

// El widget colapsa lo pegado en el compositor con una marca («[pasted text]») que ocupa el lugar del texto y se reemplaza por el texto COMPLETO al enviar.
const LARGO = "línea de log\n".repeat(30); // 390 caracteres, 30 líneas: largo por líneas

describe("insertarPegado", () => {
  it("pone la marca donde estaba el cursor y guarda el texto completo", () => {
    const r = insertarPegado("mirá esto: ", [], { texto: LARGO, inicio: 11, fin: 11 }, 4000);
    expect(r.valor).toBe("mirá esto: [pasted text]");
    expect(r.pegados).toEqual([{ marca: "[pasted text]", texto: LARGO }]);
    expect(r.cursor).toBe("mirá esto: [pasted text]".length);
  });
  it("reemplaza la selección, y conserva lo que había antes y después", () => {
    const r = insertarPegado("antes XXX después", [], { texto: LARGO, inicio: 6, fin: 9 }, 4000);
    expect(r.valor).toBe("antes [pasted text] después");
    expect(r.cursor).toBe("antes [pasted text]".length);
  });
  it("el segundo pegado lleva otra marca (#2), para saber cuál es cuál; el tercero, #3", () => {
    let r = insertarPegado("", [], { texto: "a".repeat(1200), inicio: 0, fin: 0 }, 4000);
    r = insertarPegado(`${r.valor} y `, r.pegados, { texto: "b".repeat(1200), inicio: r.valor.length + 3, fin: r.valor.length + 3 }, 4000);
    expect(r.valor).toBe("[pasted text] y [pasted text #2]");
    r = insertarPegado(`${r.valor}.`, r.pegados, { texto: "c".repeat(1200), inicio: r.valor.length + 1, fin: r.valor.length + 1 }, 4000);
    expect(r.pegados.map((p) => p.marca)).toEqual(["[pasted text]", "[pasted text #2]", "[pasted text #3]"]);
  });
  it("si la primera marca ya no está en el texto (la borraron), se reutiliza", () => {
    const viejos: Pegado[] = [{ marca: "[pasted text]", texto: "viejo" }];
    const r = insertarPegado("sin marca", viejos, { texto: LARGO, inicio: 9, fin: 9 }, 4000);
    expect(r.valor).toBe("sin marca[pasted text]");
    expect(r.pegados).toEqual([{ marca: "[pasted text]", texto: LARGO }]);
  });
  it("el tope es el del núcleo (una sola fuente)", () => {
    expect(MAX_MENSAJE).toBe(MESSAGE_MAX_LENGTH);
  });
  it("revisión 2, N1: lo que no entra se corta y SE DICE cuántos caracteres quedaron afuera; si entra entero, no se dice nada", () => {
    const corto = insertarPegado("hola ", [], { texto: "x".repeat(1200), inicio: 5, fin: 5 }, 4000);
    expect(corto.recortado).toBe(0);
    const largo = insertarPegado("hola ", [], { texto: "x".repeat(6000), inicio: 5, fin: 5 }, 4000);
    expect(largo.recortado).toBe(6000 - 3995);
    expect(largo.entraron).toBe(3995);
  });
  it("revisión 2, N1: con el mensaje casi lleno un log de 30 líneas deja pasar un solo carácter, y eso también se dice", () => {
    const r = insertarPegado("y".repeat(3999), [], { texto: LARGO, inicio: 3999, fin: 3999 }, 4000);
    expect(r.entraron).toBe(1);
    expect(r.recortado).toBe(LARGO.length - 1);
  });
  it("revisión 2, N4: si no entra nada, no hay cursor que mover y el valor no cambia", () => {
    const lleno = "y".repeat(4000);
    const r = insertarPegado(lleno, [], { texto: LARGO, inicio: 5, fin: 5 }, 4000);
    expect(r.valor).toBe(lleno);
    expect(r.cursor).toBeNull();
    expect(r.entraron).toBe(0);
    expect(r.recortado).toBe(LARGO.length);
  });
  it("revisión 2, N6: los saltos \r\n y \r del portapapeles se guardan como \n (el textarea hace lo mismo con lo tipeado)", () => {
    const crlf = Array.from({ length: 30 }, (_, i) => `línea ${i}`).join("\r\n");
    const r = insertarPegado("", [], { texto: crlf, inicio: 0, fin: 0 }, 4000);
    expect(r.pegados[0]!.texto).toBe(crlf.replace(/\r\n/g, "\n"));
    expect(expandirPegados(r.valor, r.pegados)).not.toContain("\r");
  });
  it("lo que no cabe en el mensaje (4.000) se corta donde termina, como el texto tipeado", () => {
    const enorme = "x".repeat(6000);
    const r = insertarPegado("hola ", [], { texto: enorme, inicio: 5, fin: 5 }, 4000);
    expect(expandirPegados(r.valor, r.pegados)).toBe(`hola ${"x".repeat(3995)}`);
    expect(expandirPegados(r.valor, r.pegados)).toHaveLength(4000);
  });
  it("sin lugar, no inserta nada", () => {
    const lleno = "y".repeat(4000);
    const r = insertarPegado(lleno, [], { texto: LARGO, inicio: 4000, fin: 4000 }, 4000);
    expect(r.valor).toBe(lleno);
    expect(r.pegados).toEqual([]);
  });
});

describe("vigentesDe (revisión 2, N2)", () => {
  it("lo que el compositor muestra como tira: los pegados cuya marca sigue en el texto, con su tamaño y su primera línea", async () => {
    const { vigentesDe, resumenDelPegado } = await import("./pegado");
    const r = insertarPegado("a ", [], { texto: `primera línea\n${LARGO}`, inicio: 2, fin: 2 }, 4000);
    expect(vigentesDe(r.valor, r.pegados)).toHaveLength(1);
    expect(vigentesDe("sin marca", r.pegados)).toEqual([]);
    expect(resumenDelPegado(r.pegados[0]!.texto)).toMatchObject({ lines: 31, primeraLinea: "primera línea" });
  });
  it("la primera línea se acota (60) y se salta las vacías del principio", async () => {
    const { resumenDelPegado } = await import("./pegado");
    expect(resumenDelPegado(`\n\n   ${"x".repeat(100)}\nresto`).primeraLinea).toBe(`${"x".repeat(59)}…`);
  });
});

describe("expandirPegados", () => {
  it("reemplaza cada marca presente por su texto completo, en su lugar", () => {
    const r = insertarPegado("mirá: ", [], { texto: LARGO, inicio: 6, fin: 6 }, 4000);
    expect(expandirPegados(`${r.valor} ¿qué pasó?`, r.pegados)).toBe(`mirá: ${LARGO} ¿qué pasó?`);
  });
  it("una marca que la persona borró no manda nada", () => {
    const r = insertarPegado("", [], { texto: LARGO, inicio: 0, fin: 0 }, 4000);
    expect(expandirPegados("solo esto", r.pegados)).toBe("solo esto");
  });
  it("lo pegado se manda tal cual: `$&`, `$1` y demás no se interpretan", () => {
    const texto = "a$&b$1c$$d".repeat(200);
    const r = insertarPegado("", [], { texto, inicio: 0, fin: 0 }, 4000);
    expect(expandirPegados(r.valor, r.pegados)).toBe(texto);
  });
  it("sin pegados, el texto es el mismo", () => {
    expect(expandirPegados("hola", [])).toBe("hola");
  });
  it("una marca escrita a mano por la persona, sin un pegado detrás, queda como texto", () => {
    expect(expandirPegados("[pasted text]", [])).toBe("[pasted text]");
  });
});

describe("largoExpandido", () => {
  it("es lo que de verdad se manda: sirve para acotar lo que se puede seguir escribiendo", () => {
    const r = insertarPegado("ab ", [], { texto: "z".repeat(1500), inicio: 3, fin: 3 }, 4000);
    expect(largoExpandido(r.valor, r.pegados)).toBe(1503);
    expect(largoExpandido("hola", [])).toBe(4);
  });
});
