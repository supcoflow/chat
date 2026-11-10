import { describe, expect, it } from "vitest";
import { alEnviar, estadoInicial, reducir } from "../estado";
import { agregarCaptura, agregarElemento, marcar, sinAdjuntos } from "../evidencia/adjuntos";
import { ELEMENTO, IMAGEN } from "../evidencia/adjuntos.test";
import type { EventoDelWidget } from "../protocolo";
import { PERMISOS_COMO_HOY } from "../estado-del-widget";
import type { EstadoDelNucleo } from "./controlador";
import { eventoPublico, estadoPublico } from "./traducir";

const correr = (...evs: EventoDelWidget[]): EstadoDelNucleo => ({ chat: evs.reduce(reducir, alEnviar(estadoInicial(null), "hola")), adjuntos: sinAdjuntos(), permisos: PERMISOS_COMO_HOY });

describe("estadoPublico", () => {
  it("el estado inicial es vacío y sin sesión", () => {
    expect(estadoPublico({ chat: estadoInicial(null), adjuntos: sinAdjuntos(), permisos: PERMISOS_COMO_HOY })).toEqual({
      messages: [], pendingQuestion: null, busy: false, error: null, activity: null, hasSession: false, reported: false, attachments: [], canAttachMore: true,
      allows: { screenshots: true, elements: true, pageAndBrowser: true },
    });
  });
  it("traduce mensajes: usuario pendiente → confirmado, asistente en streaming → cerrado con sus pasos, desenlace → outcome", () => {
    const s0 = correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "texto", delta: "Hol" });
    expect(estadoPublico(s0).messages).toEqual([
      { id: 1, role: "user", text: "hola", pending: true },
      { id: 2, role: "assistant", text: "Hol", streaming: true, steps: [] },
    ]);
    const s1 = correr(
      { v: 1, t: "sesion", id: "s1", indice: 0 },
      { v: 1, t: "usuario", texto: "hola" },
      { v: 1, t: "paso", que: "guia_leida", seccion: "Billing" },
      { v: 1, t: "asistente", texto: "Hola." },
      { v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" },
      { v: 1, t: "desenlace", que: "respondida" },
      { v: 1, t: "espera", indice: 5 },
    );
    expect(estadoPublico(s1).messages).toEqual([
      { id: 1, role: "user", text: "hola", pending: false },
      { id: 2, role: "assistant", text: "Hola.", streaming: false, steps: [{ kind: "guide_read", section: "Billing" }] },
      { id: 3, role: "outcome", outcome: { kind: "reported", reportId: "rep_1" } },
      { id: 4, role: "outcome", outcome: { kind: "answered" } },
    ]);
    expect(estadoPublico(s1)).toMatchObject({ busy: false, hasSession: true, reported: true });
  });
  it("NUNCA expone el id de la sesión (es una capacidad al portador): ni en el estado ni en sus textos", () => {
    const publico = estadoPublico(correr({ v: 1, t: "sesion", id: "01JSECRETISIMO", indice: 3 }));
    expect(JSON.stringify(publico)).not.toContain("01JSECRETISIMO");
    expect(publico.hasSession).toBe(true);
  });
  it("la confirmación del reporte: kind report_confirmation, opciones tal cual y prompt = el último mensaje del asistente", () => {
    const s = correr(
      { v: 1, t: "sesion", id: "s1", indice: 0 },
      { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "Esto es lo que mando:\n\nTítulo\n\nCuerpo\n\n¿Lo mando?", opciones: [{ id: "approve", label: "Sí", style: "primary" }, { id: "cancel", label: "No", style: "default" }], libre: false },
    );
    expect(estadoPublico(s).pendingQuestion).toEqual({
      id: "r1",
      prompt: "Esto es lo que mando:\n\nTítulo\n\nCuerpo\n\n¿Lo mando?",
      kind: "report_confirmation",
      options: [{ id: "approve", label: "Sí", style: "primary" }, { id: "cancel", label: "No", style: "default" }],
      allowsText: false,
    });
  });
  it("T6: el mensaje que repite la confirmación lleva `reportCopy: true`, también después de contestarla y tras una recarga; ningún otro mensaje lo lleva", () => {
    const pregunta: EventoDelWidget = { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "Esto es lo que mando:\n\n- **uno**\n\n¿Lo mando?", opciones: [{ id: "approve", label: "Sí", style: "primary" }, { id: "cancel", label: "No", style: "default" }], libre: false };
    const copias = (s: EstadoDelNucleo) => estadoPublico(s).messages.filter((m) => m.role === "assistant" && m.reportCopy === true).map((m) => (m.role === "assistant" ? m.text : ""));
    const pendiente = correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "asistente", texto: "¿En qué página?" }, pregunta);
    expect(copias(pendiente)).toEqual([pregunta.prompt]);
    // Contestada, la pregunta ya no está pendiente y la copia sigue marcada: es lo único que la distingue de un mensaje cualquiera del asistente.
    const contestada = correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, pregunta, { v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "denied", optionId: "cancel" }, { v: 1, t: "asistente", texto: "Dale, ¿qué cambiamos?" });
    expect(estadoPublico(contestada).pendingQuestion).toBeNull();
    expect(copias(contestada)).toEqual([pregunta.prompt]);
    // Los mensajes que no son la copia no tienen la propiedad (la forma de siempre).
    expect(estadoPublico(contestada).messages.filter((m) => "reportCopy" in m)).toHaveLength(1);
    // Una recarga rebobina el mismo evento por el mismo reductor: la marca vuelve.
    const recargada: EstadoDelNucleo = { chat: [pregunta].reduce(reducir, estadoInicial({ id: "s1", indice: 4 })), adjuntos: sinAdjuntos(), permisos: PERMISOS_COMO_HOY };
    expect(copias(recargada)).toEqual([pregunta.prompt]);
  });
  it("T6: la pregunta del asistente que no es la confirmación no marca su mensaje como copia del reporte", () => {
    const s = correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "pregunta", requestId: "r", kind: "question", prompt: "¿Qué navegador?", opciones: [], libre: true });
    expect(estadoPublico(s).messages.some((m) => "reportCopy" in m)).toBe(false);
  });
  it("los otros tipos de pregunta: question, session-limit, y uno desconocido cae en other", () => {
    const de = (kind: string) => estadoPublico(correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "pregunta", requestId: "r", kind: kind as "question", prompt: "¿?", opciones: [], libre: true })).pendingQuestion;
    expect(de("question")).toMatchObject({ kind: "question", allowsText: true });
    expect(de("session-limit")).toMatchObject({ kind: "session_limit" });
    expect(de("algo-de-un-v1-futuro")).toMatchObject({ kind: "other" });
  });
  it("error, actividad y ocupado", () => {
    const leyendo = correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "actividad", que: "leyendo_la_guia" });
    expect(estadoPublico(leyendo)).toMatchObject({ activity: "reading_guide", busy: true, error: null });
    const roto = correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "error", codigo: "red", mensaje: "x", terminal: false });
    expect(estadoPublico(roto)).toMatchObject({ activity: null, error: { code: "red", message: "x", terminal: false } });
  });
  it("adjuntos: el elemento lleva su etiqueta y la captura su miniatura; el estado de la subida y el motivo; nunca los bytes ni el HTML", () => {
    let a = agregarElemento(sinAdjuntos(), ELEMENTO);
    a = agregarCaptura(a, { ...IMAGEN, base64: "BYTESSECRETOS" });
    a = marcar(a, 1, { estado: "listo", evidenciaId: "evd_SECRETO" });
    a = marcar(a, 2, { estado: "fallo", motivo: "tope_de_evidencias", reintentable: false });
    const publico = estadoPublico({ chat: estadoInicial(null), adjuntos: a, permisos: PERMISOS_COMO_HOY });
    expect(publico.attachments).toEqual([
      { id: 1, kind: "element", label: "button «Guardar»", thumbnail: null, status: "uploaded", failure: null, retryable: true, sentWithReport: false },
      { id: 2, kind: "screenshot", label: null, thumbnail: IMAGEN.miniatura, status: "failed", failure: "tope_de_evidencias", retryable: false, sentWithReport: false },
    ]);
    const texto = JSON.stringify(publico);
    expect(texto).not.toContain("evd_SECRETO");
    expect(texto).not.toContain("BYTESSECRETOS");
    expect(texto).not.toContain("htmlSnippet");
  });
  it("allows: el acuerdo de datos del proyecto, con nombres públicos (T0.5)", () => {
    const e = { chat: estadoInicial(null), adjuntos: sinAdjuntos(), permisos: { capturas: false, elementos: true, paginaYNavegador: false } };
    expect(estadoPublico(e).allows).toEqual({ screenshots: false, elements: true, pageAndBrowser: false });
  });
  it("canAttachMore baja a false con 4 adjuntos", () => {
    let a = sinAdjuntos();
    for (let i = 0; i < 4; i++) a = agregarCaptura(a, IMAGEN);
    expect(estadoPublico({ chat: estadoInicial(null), adjuntos: a, permisos: PERMISOS_COMO_HOY }).canAttachMore).toBe(false);
  });
});

describe("eventoPublico", () => {
  it.each<[EventoDelWidget, unknown]>([
    [{ v: 1, t: "sesion", id: "s1", indice: 4 }, { type: "session", index: 4 }],
    [{ v: 1, t: "usuario", texto: "hola" }, { type: "user_message", text: "hola" }],
    [{ v: 1, t: "texto", delta: "Ho" }, { type: "text_delta", delta: "Ho" }],
    [{ v: 1, t: "asistente", texto: "Hola." }, { type: "assistant_message", text: "Hola." }],
    [{ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "approved", optionId: "approve" }, { type: "question_resolved", id: "r1", outcome: "approved", optionId: "approve" }],
    [{ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "answered", text: "esa" }, { type: "question_resolved", id: "r1", outcome: "answered", text: "esa" }],
    [{ v: 1, t: "actividad", que: "leyendo_la_guia" }, { type: "activity", activity: "reading_guide" }],
    [{ v: 1, t: "paso", que: "guia_leida", seccion: "Billing" }, { type: "step", step: { kind: "guide_read", section: "Billing" } }],
    [{ v: 1, t: "paso", que: "resumen_preparado" }, { type: "step", step: { kind: "report_summarized" } }],
    [{ v: 1, t: "paso", que: "pregunta_anotada" }, { type: "step", step: { kind: "question_noted" } }],
    [{ v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" }, { type: "outcome", outcome: { kind: "reported", reportId: "rep_1" } }],
    [{ v: 1, t: "desenlace", que: "reportado", reporte: null }, { type: "outcome", outcome: { kind: "reported", reportId: null } }],
    [{ v: 1, t: "desenlace", que: "respondida" }, { type: "outcome", outcome: { kind: "answered" } }],
    [{ v: 1, t: "espera", indice: 9 }, { type: "turn_end", index: 9 }],
    [{ v: 1, t: "fin" }, { type: "end" }],
    [{ v: 1, t: "error", codigo: "tope_de_mensajes", mensaje: "HTTP 429", terminal: false }, { type: "error", error: { code: "tope_de_mensajes", message: "HTTP 429", terminal: false } }],
  ])("%j → %j", (wire, publico) => {
    expect(eventoPublico(wire)).toEqual(publico);
  });
  it("la pregunta lleva su id y el prompt del propio evento", () => {
    expect(eventoPublico({ v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "¿Lo mando?", opciones: [{ id: "approve", label: "Sí", style: "primary" }], libre: false })).toEqual({
      type: "question", question: { id: "r1", prompt: "¿Lo mando?", kind: "report_confirmation", options: [{ id: "approve", label: "Sí", style: "primary" }], allowsText: false },
    });
  });
  it("T3: la confirmación estructurada llega como `report: { title, body }`, además del prompt; sin el campo, la pregunta es la de siempre y no tiene `report`", () => {
    const base = { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "Esto es lo que mando:\n\nGuardar falla\n\nNo pasa nada.\n\n¿Lo mando?", opciones: [{ id: "approve", label: "Sí", style: "primary" as const }], libre: false };
    expect(eventoPublico({ ...base, reporte: { titulo: "Guardar falla", cuerpo: "No pasa nada." } } as EventoDelWidget)).toEqual({
      type: "question", question: { id: "r1", prompt: base.prompt, kind: "report_confirmation", options: [{ id: "approve", label: "Sí", style: "primary" }], allowsText: false, report: { title: "Guardar falla", body: "No pasa nada." } },
    });
    const sin = eventoPublico(base as EventoDelWidget);
    expect(sin && sin.type === "question" && "report" in sin.question).toBe(false);
  });
  it("T3: `report` también está en el estado (`pendingQuestion`), con el id de la pregunta", () => {
    const e = estadoPublico(correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "p", opciones: [], libre: false, reporte: { titulo: "T", cuerpo: "C" } }));
    expect(e.pendingQuestion).toMatchObject({ id: "r1", kind: "report_confirmation", report: { title: "T", body: "C" } });
  });
  it("T3: `report` sólo existe en la confirmación del reporte, aunque otra pregunta lo traiga", () => {
    const e = estadoPublico(correr({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "pregunta", requestId: "r1", kind: "question", prompt: "¿?", opciones: [], libre: true, reporte: { titulo: "T", cuerpo: "C" } }));
    expect(e.pendingQuestion).not.toHaveProperty("report");
  });
  it("`herramienta` (sólo del preview) y lo que no se conoce no se entregan; tampoco un paso o un desenlace mal formado", () => {
    expect(eventoPublico({ v: 1, t: "herramienta", nombre: "reportar", resumen: "x" })).toBeNull();
    expect(eventoPublico({ v: 1, t: "algo_nuevo" } as unknown as EventoDelWidget)).toBeNull();
    expect(eventoPublico({ v: 1, t: "paso", que: "futuro" } as unknown as EventoDelWidget)).toBeNull();
    expect(eventoPublico({ v: 1, t: "paso", que: "guia_leida" } as unknown as EventoDelWidget)).toBeNull();
    expect(eventoPublico({ v: 1, t: "actividad", que: "futura" } as unknown as EventoDelWidget)).toBeNull();
    expect(eventoPublico({ v: 1, t: "desenlace", que: "futuro" } as unknown as EventoDelWidget)).toBeNull();
  });
});
