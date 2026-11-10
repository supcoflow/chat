/// <reference types="node" />
// Los tipos de Node SÓLO en este test (el tsconfig del widget deja `types: []` para que el código
// del navegador no pueda usar Node): el barrido lee los componentes del disco.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARRANQUES, inicialesDe, TEXTOS } from "./textos";

// 2.3.0 (etapa 1 «la landing es verdad», T0.1): el widget pasa a inglés. Lo que PRUEBA el idioma es
// este inventario —cada valor exacto, copiado de la tabla del plan— y no un regex (R13 de la
// revisión del plan: «sin tildes» no es lo mismo que «en inglés»).
const INVENTARIO: Record<keyof typeof TEXTOS, string> = {
  abrir: "Open the help chat",
  cerrar: "Close",
  minimizar: "Minimize",
  placeholder: "Ask or tell us what happened…",
  enviar: "Send",
  pensando: "Thinking…",
  errorDeEnvio: "Couldn't send. Try again.",
  sesionVencida: "The previous conversation expired. Write to start a new one.",
  reintentar: "Retry",
  respuestaLibre: "Type your answer…",
  responder: "Reply",
  esUnaMaquina: "You're talking to an automated assistant.",
  preview: "Preview",
  senalar: "Pick an element",
  seleccionando: "Click the element that isn't working. Esc to cancel.",
  adjuntar: "Attach",
  capturarPantalla: "Take a screenshot",
  capturarElemento: "Capture this element",
  adjuntarImagen: "Attach an image",
  quitar: "Remove",
  pendiente: "Pending",
  subiendo: "Uploading…",
  adjuntado: "Attached",
  adjuntadoYaEnviado: "Attached. It goes with your report if you send one.",
  adjuntadoYaFueAlReporte: "Attached. It was sent with your report.",
  acompanaAlReporte: "Your attachments that go with it:",
  aunNoAdjunto: "Not attached yet:",
  falloDeSubida: "Couldn't attach.",
  reintentarSubida: "Retry",
  sinCaptura: "No screenshot. The element is attached anyway.",
  topeDeAdjuntos: "Up to 4 attachments per conversation.",
  imagenInvalida: "That file isn't an image, or it's too large.",
  elementoSenalado: "Pointed element",
  hola: "Hi",
  saludoPorDefecto: "How can we help?",
  oEscribi: "or type below",
  asistenteAutomatico: "Automated assistant",
  atribucion: "Supcoflow",
  enviarAria: "Send the message",
  // Nuevos de la 2.3.0: los dibuja el widget, no el modelo (spec §6).
  leyendoLaGuia: "Reading the support guide…",
  reportado: "Report sent.",
  reporteCerrado: "Nothing written here from now on is added to it.",
  reporte: "Report",
  respondida: "Answered · no issue",
  guiaLeida: "Read the guide",
  resumenPreparado: "Summarized the report",
  preguntaAnotada: "Noted your question",
  // T0.7 (D2): después de un reporte, la salida de «recargá la página» (recargar retoma la MISMA sesión).
  textoPegado: "[pasted text]",
  linea: "line",
  lineas: "lines",
  caracteres: "characters",
  pegadoRecortadoA: "Only the first",
  pegadoRecortadoB: "characters of the pasted text fit in one message.",
  pegadoNoEntra: "The pasted text doesn't fit: the message is full.",
  nuevaConversacion: "New conversation",
  // T0.2: los errores del backend con texto propio. La landing no los muestra; los eligió quien
  // construyó la 2.3.0 (anotado en el resumen de la fase).
  limiteDeSesion: "This conversation reached its limit. Write to start a new one.",
  topeDeMensajes: "The chat can't take more messages right now. Try again later.",
  chatNoDisponible: "The chat isn't available on this site right now.",
  asistenteNoDisponible: "The assistant isn't available right now. Please try again later.",
  confirmacionVencida: "That confirmation is out of date. Check the latest summary and answer that one.",
};

const ARRANQUES_ESPERADOS = [
  { titulo: "Report a bug", detalle: "Something isn't working right", mensaje: "I want to report a bug" },
  { titulo: "I have a usage question", detalle: "How to do something in the product", mensaje: "I have a question about how to use the product" },
];

// Alarma PARCIAL, no prueba de idioma: agarra un olvido con tilde, no «El usuario no puede guardar».
const CASTELLANO = /[¿¡ñáéíóúÁÉÍÓÚÑ]/;

describe("TEXTOS: el inventario en inglés (T0.1)", () => {
  it("cada valor es EXACTAMENTE el del inventario, y no hay ni uno de más ni de menos", () => {
    expect({ ...TEXTOS }).toEqual(INVENTARIO);
  });
});

describe("ARRANQUES (§5.2 de la marca: son las dos tools del agente, ni una más)", () => {
  it("son dos, con los textos exactos del inventario", () => {
    expect(ARRANQUES).toEqual(ARRANQUES_ESPERADOS);
  });
  it("cada uno manda un texto distinto del rótulo", () => {
    for (const a of ARRANQUES) expect(a.mensaje).not.toBe(a.titulo);
  });
});

describe("alarma parcial de castellano (no prueba inglés: lo prueba el inventario)", () => {
  it("ningún valor de TEXTOS ni de ARRANQUES tiene ¿¡ñ ni tildes", () => {
    for (const v of Object.values(TEXTOS)) expect(v).not.toMatch(CASTELLANO);
    for (const a of ARRANQUES) for (const v of Object.values(a)) expect(v).not.toMatch(CASTELLANO);
  });
  it("los componentes no tienen literales visibles con esos caracteres (fuera de los comentarios)", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "componentes");
    for (const archivo of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const fuente = readFileSync(join(dir, archivo), "utf8");
      const sinComentarios = fuente
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\s\/\/ .*$/gm, "");
      const lineas = sinComentarios.split("\n").filter((l) => CASTELLANO.test(l));
      expect({ archivo, lineas }).toEqual({ archivo, lineas: [] });
    }
  });
});

describe("inicialesDe: el avatar sin logo", () => {
  it("dos palabras → dos iniciales; una → dos letras; mayúsculas", () => {
    expect(inicialesDe("Ayuda de Turnera")).toBe("AT");
    expect(inicialesDe("Help")).toBe("HE");
    expect(inicialesDe("soporte wúru")).toBe("SW");
  });
  it("vacío o raro no rompe: cae a la S de Supcoflow", () => {
    expect(inicialesDe("")).toBe("S");
    expect(inicialesDe("   ")).toBe("S");
  });
});
