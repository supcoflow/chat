// `@supcoflow/chat/core`: el núcleo SIN interfaz. Sirve para armar tu propio chat (React, Vue, Svelte, nativo con WebView, lo que sea) usando
// a Supcoflow como cerebro: mandar mensajes, recibir texto y eventos, la confirmación del reporte, reconexión, adjuntos y errores.
// Contrato en `docs/core.md` y `docs/protocol-v1.md`. No importa preact, react ni CSS.

export { createSupportChat } from "./soporte";
export { parseAssistantText } from "./texto-del-asistente";
export { isLongPaste, MESSAGE_MAX_LENGTH, PASTE_LIMITS, pasteSize } from "./texto-pegado";
export type { TextBlock, TextInline } from "./texto-del-asistente";
export { SDK_VERSION as CORE_VERSION } from "./version";
export { PROTOCOL_VERSION } from "../protocolo";
export type {
  AttachResult,
  Availability,
  ChatAllows,
  ChatCapabilities,
  ChatActivity,
  ChatAttachment,
  ChatError,
  ChatEvent,
  ChatMessage,
  ChatOutcome,
  ChatState,
  ChatStep,
  ChatUser,
  PendingQuestion,
  PickResult,
  QuestionOption,
  SupportChat,
  SupportChatOptions,
} from "./tipos";
