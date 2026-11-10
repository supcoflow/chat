import { describe, expect, it } from "vitest";
import { TEMA_POR_DEFECTO } from "./opciones";
import { sobreAcento, variablesDelTema } from "./tema";

describe("variablesDelTema", () => {
  it("una variable --scf-* por campo, en kebab-case, más la calculada sobre-acento al final", () => {
    expect(variablesDelTema({ ...TEMA_POR_DEFECTO, acento: "#f00", textoSuave: "#999" })).toBe(
      "--scf-acento:#f00;--scf-fondo:#ffffff;--scf-texto:#111827;--scf-texto-suave:#999;--scf-radio:20px;--scf-fuente:inherit;--scf-sobre-acento:#ffffff",
    );
  });
  it("un valor con `;` o `}` se descarta: el tema lo escribe el cliente, pero no puede cerrar el bloque", () => {
    expect(variablesDelTema({ ...TEMA_POR_DEFECTO, acento: "red;} body{display:none" })).toContain(`--scf-acento:${TEMA_POR_DEFECTO.acento}`);
  });
  it("sobre-acento se calcula sobre el acento SANEADO, no sobre el crudo", () => {
    // El crudo es inadmisible y cae al default oscuro → texto blanco.
    expect(variablesDelTema({ ...TEMA_POR_DEFECTO, acento: "#fcba03;}" })).toContain("--scf-sobre-acento:#ffffff");
  });
});

describe("sobreAcento (hallazgo 2 del spec: el acento guardado en producción es #fcba03 y hoy el texto es blanco fijo)", () => {
  it("un acento oscuro lleva texto blanco", () => {
    expect(sobreAcento("#1f2937")).toBe("#ffffff");
    expect(sobreAcento("#000")).toBe("#ffffff");
    expect(sobreAcento("rgb(30, 41, 59)")).toBe("#ffffff");
  });
  it("un acento claro lleva texto oscuro: amarillo, blanco, celeste pastel", () => {
    expect(sobreAcento("#fcba03")).toBe("#111111");
    expect(sobreAcento("#ffffff")).toBe("#111111");
    expect(sobreAcento("#9ad")).toBe("#111111");
    expect(sobreAcento("rgba(252, 186, 3, 1)")).toBe("#111111");
  });
  it("lo que no se puede parsear cae a blanco, que es lo de hoy", () => {
    expect(sobreAcento("tomato")).toBe("#ffffff");
    expect(sobreAcento("var(--x)")).toBe("#ffffff");
    expect(sobreAcento("")).toBe("#ffffff");
  });
});
