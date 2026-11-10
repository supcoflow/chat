import { describe, expect, it } from "vitest";
import { parsearLinea } from "./cliente";
import { FORMA_V1, normalizarEvento } from "./validar-evento";

// Lo que llega del cable es entrada no confiable: un evento CONOCIDO con un campo de menos o de otro tipo no puede llegar al reducer ni al traductor
// público (revisión 1, P2-3: `opciones: null` rompía `getState()`). Un evento DESCONOCIDO pasa tal cual: es la regla de compatibilidad del protocolo.
const OPC = [{ id: "approve", label: "Yes", style: "primary" }];
const PREGUNTA = { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "¿Lo mando?", opciones: OPC, libre: false };

describe("normalizarEvento", () => {
  it("un evento bien formado pasa entero, con sus campos de más", () => {
    const e = { ...PREGUNTA, campo_de_mas: 1 };
    expect(normalizarEvento(e)).toBe(e);
    expect(normalizarEvento({ v: 1, t: "fin" })).toEqual({ v: 1, t: "fin" });
    expect(normalizarEvento({ v: 1, t: "desenlace", que: "reportado", reporte: null })).not.toBeNull();
    expect(normalizarEvento({ v: 1, t: "desenlace", que: "respondida" })).not.toBeNull();
    expect(normalizarEvento({ v: 1, t: "pregunta_resuelta", requestId: "r", outcome: "approved", optionId: "approve" })).not.toBeNull();
  });
  it("un `t` desconocido pasa sin mirarlo (un v1 futuro no tumba a un cliente viejo)", () => {
    const e = { v: 1, t: "evento_futuro", x: { y: null } };
    expect(normalizarEvento(e)).toBe(e);
  });
  it.each<[string, object]>([
    ["opciones null", { ...PREGUNTA, opciones: null }],
    ["opciones no es lista", { ...PREGUNTA, opciones: "approve" }],
    ["una opción null", { ...PREGUNTA, opciones: [null] }],
    ["una opción sin label", { ...PREGUNTA, opciones: [{ id: "a", style: "default" }] }],
    ["una opción con id numérico", { ...PREGUNTA, opciones: [{ id: 1, label: "x", style: "default" }] }],
    ["sin requestId", { ...PREGUNTA, requestId: undefined }],
    ["libre no es booleano", { ...PREGUNTA, libre: "no" }],
    ["prompt numérico", { ...PREGUNTA, prompt: 3 }],
    ["texto sin delta", { v: 1, t: "texto" }],
    ["delta numérico", { v: 1, t: "texto", delta: 5 }],
    ["espera con índice de texto", { v: 1, t: "espera", indice: "9" }],
    ["espera con índice infinito", { v: 1, t: "espera", indice: Infinity }],
    ["sesion sin id", { v: 1, t: "sesion", indice: 0 }],
    ["error con terminal de texto", { v: 1, t: "error", codigo: "x", mensaje: "m", terminal: "si" }],
    ["error sin código", { v: 1, t: "error", mensaje: "m", terminal: true }],
    ["desenlace con reporte numérico", { v: 1, t: "desenlace", que: "reportado", reporte: 7 }],
    ["paso sin que", { v: 1, t: "paso" }],
    ["resuelta con optionId numérico", { v: 1, t: "pregunta_resuelta", requestId: "r", outcome: "o", optionId: 4 }],
  ])("un evento conocido mal formado se descarta: %s", (_n, e) => {
    expect(normalizarEvento({ v: 1, ...e })).toBeNull();
  });
  it("no es un objeto → null", () => {
    for (const x of [null, 3, "t", [], undefined]) expect(normalizarEvento(x)).toBeNull();
  });
  it("la tabla cubre todos los eventos y exige lo que el tipo exige", () => {
    expect(Object.keys(FORMA_V1).sort()).toEqual(["actividad", "asistente", "desenlace", "error", "espera", "fin", "herramienta", "paso", "pregunta", "pregunta_resuelta", "sesion", "texto", "usuario"]);
  });
});

describe("parsearLinea con eventos mal formados", () => {
  it("la línea se salta como una que no es v1, y la siguiente se lee normal", () => {
    expect(parsearLinea(JSON.stringify({ ...PREGUNTA, opciones: null }))).toBeNull();
    expect(parsearLinea(JSON.stringify(PREGUNTA))).toMatchObject({ t: "pregunta" });
  });
});

// T3 (plan «ui-agnóstico»): `pregunta.reporte` —el título y el cuerpo de la confirmación, por separado— es un campo OPCIONAL agregado a v1. Si viene, tiene que venir bien.
describe("pregunta.reporte (opcional, aditivo en v1)", () => {
  it("sin el campo, el evento es válido (un backend anterior no lo manda)", () => {
    expect(normalizarEvento(PREGUNTA)).toBe(PREGUNTA);
  });
  it("con título y cuerpo (aunque vacíos), pasa", () => {
    const e = { ...PREGUNTA, reporte: { titulo: "Guardar falla", cuerpo: "" } };
    expect(normalizarEvento(e)).toBe(e);
  });
  it.each<[string, unknown]>([
    ["un texto", "Guardar falla"],
    ["null", null],
    ["una lista", []],
    ["sin cuerpo", { titulo: "t" }],
    ["sin título", { cuerpo: "c" }],
    ["un título numérico", { titulo: 1, cuerpo: "c" }],
    ["un cuerpo nulo", { titulo: "t", cuerpo: null }],
  ])("un `reporte` mal formado (%s) hace que la pregunta no se reciba: una confirmación a medias nunca se muestra", (_, reporte) => {
    expect(normalizarEvento({ ...PREGUNTA, reporte })).toBeNull();
    expect(parsearLinea(JSON.stringify({ ...PREGUNTA, reporte }))).toBeNull();
  });
  it("la forma del cable lo declara opcional", () => {
    expect(FORMA_V1.pregunta.reporte).toBe("reporte?");
  });
});

