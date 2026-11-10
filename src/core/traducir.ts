import { etiquetaDelElemento, puedeAgregar, type Adjunto } from "../evidencia/adjuntos";
import type { Mensaje, Paso, PreguntaPendiente } from "../estado";
import type { EventoDelWidget, OpcionDePregunta, ReporteDeLaConfirmacion } from "../protocolo";
import type { PermisosDelWidget } from "../estado-del-widget";
import type { EstadoDelNucleo } from "./controlador";
import type { ChatActivity, ChatAllows, ChatAttachment, ChatEvent, ChatMessage, ChatOutcome, ChatState, ChatStep, PendingQuestion, QuestionOption } from "./tipos";

// La frontera entre el vocabulario del cable (protocolo v1, en castellano) y el público (inglés). Es pura: lo que entra es el estado interno
// o un evento v1, lo que sale es lo único que una interfaz propia ve. Lo que NO se conoce se descarta acá (`null`), no más adentro: es la
// regla de compatibilidad del protocolo —dentro de v1 sólo se agrega, y un evento nuevo no tumba a un núcleo viejo—.

function tipoDePregunta(kind: string): PendingQuestion["kind"] {
  switch (kind) {
    case "tool-approval": return "report_confirmation";
    case "question": return "question";
    case "session-limit": return "session_limit";
    default: return "other";
  }
}

function opcion(o: OpcionDePregunta): QuestionOption {
  return { id: o.id, label: o.label, style: o.style === "primary" || o.style === "danger" ? o.style : "default" };
}

function pregunta(id: string, kind: string, prompt: string, opciones: OpcionDePregunta[], libre: boolean, reporte?: ReporteDeLaConfirmacion): PendingQuestion {
  const tipo = tipoDePregunta(kind);
  // `report` sólo existe en la confirmación del reporte: en otra pregunta no tiene sentido, venga lo que venga.
  return { id, prompt, kind: tipo, options: opciones.map(opcion), allowsText: libre, ...(tipo === "report_confirmation" && reporte !== undefined ? { report: { title: reporte.titulo, body: reporte.cuerpo } } : {}) };
}

function paso(p: Paso): ChatStep {
  switch (p.que) {
    case "guia_leida": return { kind: "guide_read", section: p.seccion };
    case "resumen_preparado": return { kind: "report_summarized" };
    case "pregunta_anotada": return { kind: "question_noted" };
  }
}

function mensaje(m: Mensaje): ChatMessage {
  if (m.rol === "desenlace") return { id: m.clave, role: "outcome", outcome: m.desenlace.que === "reportado" ? { kind: "reported", reportId: m.desenlace.reporte } : { kind: "answered" } };
  if (m.rol === "usuario") return { id: m.clave, role: "user", text: m.texto, pending: m.abierto };
  return { id: m.clave, role: "assistant", text: m.texto, streaming: m.abierto, steps: (m.pasos ?? []).map(paso), ...(m.copiaDelReporte === true ? { reportCopy: true as const } : {}) };
}

function adjunto(a: Adjunto): ChatAttachment {
  const estado = { pendiente: "pending", subiendo: "uploading", listo: "uploaded", fallo: "failed" } as const;
  return {
    id: a.clave,
    kind: a.tipo === "elemento" ? "element" : "screenshot",
    label: a.tipo === "elemento" ? etiquetaDelElemento(a.elemento) : null,
    thumbnail: a.tipo === "captura" ? a.imagen.miniatura : null,
    status: estado[a.estado],
    failure: a.estado === "fallo" ? a.motivo : null,
    retryable: a.reintentable,
    sentWithReport: a.enReporte,
  };
}

/** El prompt de la pregunta pendiente es el último mensaje del asistente (el reducer lo agrega justo antes de levantar la pregunta). */
function promptDe(mensajes: Mensaje[]): string {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i]!;
    if (m.rol === "asistente") return m.texto;
  }
  return "";
}

function preguntaPendiente(p: PreguntaPendiente | null, mensajes: Mensaje[]): PendingQuestion | null {
  return p === null ? null : pregunta(p.requestId, p.kind, promptDe(mensajes), p.opciones, p.libre, p.reporte);
}

export function permisosPublicos(p: PermisosDelWidget): ChatAllows {
  return { screenshots: p.capturas, elements: p.elementos, pageAndBrowser: p.paginaYNavegador };
}

/** De lo interno a lo que ve la interfaz. Nunca el id de la sesión (capacidad al portador), nunca ids de evidencia, bytes ni HTML. */
export function estadoPublico(e: EstadoDelNucleo): ChatState {
  const { chat } = e;
  return {
    messages: chat.mensajes.map(mensaje),
    pendingQuestion: preguntaPendiente(chat.pregunta, chat.mensajes),
    busy: chat.ocupado,
    error: chat.error === null ? null : { code: chat.error.codigo, message: chat.error.mensaje, terminal: chat.error.terminal },
    activity: chat.actividad === null ? null : actividad(chat.actividad),
    hasSession: chat.cursor !== null,
    reported: chat.reportado,
    attachments: e.adjuntos.adjuntos.map(adjunto),
    canAttachMore: puedeAgregar(e.adjuntos),
    allows: permisosPublicos(e.permisos),
  };
}

function actividad(a: "leyendo_la_guia"): ChatActivity {
  return a === "leyendo_la_guia" ? "reading_guide" : a;
}

/** Un evento v1 del cable → el público, o `null` si no se entrega (`herramienta` es del preview; lo desconocido o mal formado se ignora). */
export function eventoPublico(ev: EventoDelWidget): ChatEvent | null {
  switch (ev.t) {
    case "sesion":
      return { type: "session", index: ev.indice };
    case "usuario":
      return { type: "user_message", text: ev.texto };
    case "texto":
      return { type: "text_delta", delta: ev.delta };
    case "asistente":
      return { type: "assistant_message", text: ev.texto };
    case "pregunta":
      return { type: "question", question: pregunta(ev.requestId, ev.kind, ev.prompt, ev.opciones, ev.libre, ev.reporte) };
    case "pregunta_resuelta":
      return { type: "question_resolved", id: ev.requestId, outcome: ev.outcome, ...(ev.optionId === undefined ? {} : { optionId: ev.optionId }), ...(ev.text === undefined ? {} : { text: ev.text }) };
    case "actividad":
      return ev.que === "leyendo_la_guia" ? { type: "activity", activity: "reading_guide" } : null;
    case "paso": {
      const raw = ev as { que?: unknown; seccion?: unknown };
      if (raw.que === "resumen_preparado") return { type: "step", step: { kind: "report_summarized" } };
      if (raw.que === "pregunta_anotada") return { type: "step", step: { kind: "question_noted" } };
      if (raw.que === "guia_leida" && typeof raw.seccion === "string") return { type: "step", step: { kind: "guide_read", section: raw.seccion } };
      return null;
    }
    case "desenlace": {
      const raw = ev as { que?: unknown; reporte?: unknown };
      let outcome: ChatOutcome | null = null;
      if (raw.que === "reportado") outcome = { kind: "reported", reportId: typeof raw.reporte === "string" ? raw.reporte : null };
      else if (raw.que === "respondida") outcome = { kind: "answered" };
      return outcome === null ? null : { type: "outcome", outcome };
    }
    case "espera":
      return { type: "turn_end", index: ev.indice };
    case "fin":
      return { type: "end" };
    case "error":
      return { type: "error", error: { code: ev.codigo, message: ev.mensaje, terminal: ev.terminal } };
    default:
      // `herramienta` (sólo del preview: nunca sale hacia una interfaz ajena) y cualquier `t` de un v1 futuro.
      return null;
  }
}

/** Los tipos de evento públicos como valor: un `Record` por miembro de la unión, así que agregar uno sin listarlo acá no compila. `docs.test.ts` exige que `docs/core.md` los documente todos. */
export const TIPOS_DE_EVENTO_PUBLICO: Readonly<Record<ChatEvent["type"], true>> = {
  session: true,
  user_message: true,
  text_delta: true,
  assistant_message: true,
  question: true,
  question_resolved: true,
  activity: true,
  step: true,
  outcome: true,
  turn_end: true,
  end: true,
  error: true,
};
