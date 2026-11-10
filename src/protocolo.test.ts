import { describe, expect, it } from "vitest";
import { esBorde } from "./protocolo";

describe("esBorde", () => {
  it("espera y fin cierran un stream", () => {
    expect(esBorde({ v: 1, t: "espera", indice: 4 })).toBe(true);
    expect(esBorde({ v: 1, t: "fin" })).toBe(true);
  });
  it("un error cierra sólo si es terminal: un step.failed a mitad de turno sigue con espera", () => {
    expect(esBorde({ v: 1, t: "error", codigo: "x", mensaje: "", terminal: true })).toBe(true);
    expect(esBorde({ v: 1, t: "error", codigo: "x", mensaje: "", terminal: false })).toBe(false);
  });
  it("lo demás no", () => {
    expect(esBorde({ v: 1, t: "texto", delta: "a" })).toBe(false);
    expect(esBorde({ v: 1, t: "sesion", id: "s", indice: 0 })).toBe(false);
  });
  it("2.2.0: herramienta no es borde (es información del preview)", () => {
    expect(esBorde({ v: 1, t: "herramienta", nombre: "orientar", resumen: "Turnos" })).toBe(false);
  });
});

describe("2.3.0: actividad y desenlace (spec §6 de la etapa 1)", () => {
  it("no son bordes: llegan a mitad de turno", () => {
    expect(esBorde({ v: 1, t: "actividad", que: "leyendo_la_guia" })).toBe(false);
    expect(esBorde({ v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" })).toBe(false);
    expect(esBorde({ v: 1, t: "desenlace", que: "reportado", reporte: null })).toBe(false);
    expect(esBorde({ v: 1, t: "desenlace", que: "respondida" })).toBe(false);
  });
});

describe("pasos reales", () => {
  it("un paso no es borde: llega a mitad de turno", () => {
    expect(esBorde({ v: 1, t: "paso", que: "guia_leida", seccion: "Billing" })).toBe(false);
    expect(esBorde({ v: 1, t: "paso", que: "resumen_preparado" })).toBe(false);
    expect(esBorde({ v: 1, t: "paso", que: "pregunta_anotada" })).toBe(false);
  });
});
