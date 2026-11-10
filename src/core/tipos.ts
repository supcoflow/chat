// The PUBLIC API of the core (`@supcoflow/chat/core`), in English, and the only vocabulary a custom UI sees. Every name in this file is a
// commitment: it does not change without a major version (plan de las tres formas, §6.4). Internally the engine speaks wire protocol v1,
// which keeps its Spanish names so nothing breaks; `traducir.ts` is the single border between the two vocabularies.

/** Who the user is according to YOUR app. Declared, not verified: it grants nothing, it is context for diagnosis.
 * There is no `name` field on purpose: the name of another company's user never leaves the browser. */
export interface ChatUser {
  /** Up to 100 characters. */
  id?: string;
  /** Up to 60 characters. */
  role?: string;
  /** Up to 8 pairs (keys up to 39 characters, values up to 200). `id`, `role` and `name` are not valid keys. */
  attributes?: Record<string, string>;
}

export interface SupportChatOptions {
  tenantId: string;
  projectId: string;
  /** Default: `https://chat.supcoflow.dev`. With or without a trailing slash. */
  backendUrl?: string;
  user?: ChatUser;
  /** YOUR app's version; it travels with the first message and with the report. */
  appVersion?: string;
  /** Send the page URL (without query or hash) and the browser with the first message. Default `true`. Console errors: never. */
  autoContext?: boolean;
  /** Where the conversation cursor is kept so a reload can pick the conversation back up: `"session"` (sessionStorage, the default), `"none"`,
   * or your own store. What is kept is an opaque record that belongs to the core (today `{ id, indice }`; a later version may add session credentials): store it as a string, do not parse it or build it. Never the history: that is rewound from the server. */
  storage?: "session" | "none" | Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** If a conversation was saved, rewind it when the chat is created. Default `true`. */
  resume?: boolean;
  /** The language of your app (`"es"`, `"pt-BR"`, `"en"`…). The server writes the fixed words of the report confirmation — its two buttons and the frame around the report — in it: Spanish, English or
   * Portuguese; any other language, or none, gets English. It is read when the chat is created and sent with each request, so a conversation you rewind later comes back in the language you declared then. */
  locale?: string;
  /** What YOUR interface really offers besides taking text. The server tells the assistant, in plain words (never with the name of one of your buttons), so it offers only what exists: without this it would invite
   * the user to point at an element or attach a screenshot that your interface cannot take. Declare only what a person can actually do in your interface; the project's data agreement can only take more away.
   * It is read on every message, so it may change while the chat is open. A missing key counts as `false`, except `newConversation` (see below). */
  capabilities?: ChatCapabilities;
  /** For tests, or environments without a global `fetch`. */
  fetch?: typeof fetch;
}

/** The closed list of what an interface can offer. */
export interface ChatCapabilities {
  /** The user can point at an element of the page and send it as evidence. Your interface draws its own frame (`pickElement()` draws none beyond a minimal one while choosing). */
  pickElement?: boolean;
  /** The user can attach a screenshot of the page. It is sent only if the browser can capture (`canCaptureScreen()`), whatever you declare. */
  screenshot?: boolean;
  /** The user can attach an image file. */
  attachImage?: boolean;
  /** The user can start another conversation (after a report, the contract requires it: P8). Declared `true` unless you say `false`. */
  newConversation?: boolean;
}

/** A step the assistant TOOK. Closed vocabulary: it shows up only after the server saw the fact, and it carries no arguments or reasoning. */
export type ChatStep =
  /** It read section `section` of the product guide. */
  | { kind: "guide_read"; section: string }
  /** The report summary is ready and shown to the user to confirm. It is NOT sent yet: that is an `outcome`. */
  | { kind: "report_summarized" }
  /** It noted a question the guide does not cover. */
  | { kind: "question_noted" };

/** How a path of the conversation ended. The text shown to the user is yours to write, never the model's. */
export type ChatOutcome =
  /** The report was sent. `reportId` is the number you can show the user, or `null` if the server did not send one. */
  | { kind: "reported"; reportId: string | null }
  /** The question was answered. */
  | { kind: "answered" };

export type ChatMessage =
  /** `pending`: sent and not yet confirmed by the server (it shows right away; what the user typed is never lost). */
  | { id: number; role: "user"; text: string; pending: boolean }
  /** `streaming`: fragments are still arriving. `steps`: what the assistant did during the turn of this answer. `reportCopy`: present (and `true`) only on the message that is the
   * copy of a report confirmation — the text that was asked to be sent — and it stays on it after the person answered and after a reload. Draw it as plain text (P6). */
  | { id: number; role: "assistant"; text: string; streaming: boolean; steps: ChatStep[]; reportCopy?: true }
  | { id: number; role: "outcome"; outcome: ChatOutcome };

export interface QuestionOption {
  /** Sent back as is when answering. In the report confirmation: `approve` and `cancel`. */
  id: string;
  /** The button text. Draw it exactly as it arrives. */
  label: string;
  style: "primary" | "default" | "danger";
}

export interface PendingQuestion {
  /** Who this question is. Hand it back to `answer`, `confirmReport` and `reviseReport`: an answer is bound to the question the user SAW, so a button left over from an
   * earlier question (the draft the user rejected, say) can never approve the one that came after it. */
  id: string;
  /** The text of the question: the last assistant message. In the report confirmation it is EVERYTHING that will be sent, uncut. */
  prompt: string;
  /**
   * - `report_confirmation`: "shall I send it?". This is what guarantees the assistant never reports on its own: show `prompt` and `options` as they arrive.
   * - `question`: a question from the assistant, with options and/or a free-text answer.
   * - `session_limit`: the server does not show it today (it turns it into the terminal error `limite_de_sesion`); it exists for compatibility.
   * - `other`: a kind this version does not know; it can still be drawn with `options`.
   */
  kind: "report_confirmation" | "question" | "session_limit" | "other";
  options: QuestionOption[];
  /** The user may answer with free text (`answer({ text })`). */
  allowsText: boolean;
  /** Only in the report confirmation, and only when the server sends it (an older backend does not): the title and the body of the report, EXACTLY as they will be sent, apart from each other
   * and without the frame `prompt` puts around them. Draw these two to lay the report out as you like; when this is absent, `prompt` has everything. */
  report?: { title: string; body: string };
}

/** What the assistant is doing besides writing. Closed vocabulary; what is not known is ignored. */
export type ChatActivity = "reading_guide";

export interface ChatError {
  /** Decide what to show from the CODE (`docs/protocol-v1.md` lists them). `message` comes from the server, may be in any language and is not for the user. */
  code: string;
  message: string;
  /** `true`: the conversation is over (start another one). `false`: `retry()` makes sense. */
  terminal: boolean;
}

export interface ChatAttachment {
  id: number;
  kind: "element" | "screenshot";
  /** The chip text of an element («button «Save»»); `null` for a screenshot. */
  label: string | null;
  /** A small data URL of a screenshot (produced by the core's own canvas, not by the page); `null` for an element. */
  thumbnail: string | null;
  status: "pending" | "uploading" | "uploaded" | "failed";
  /** With `failed`: the reason (`red`, `tope_de_evidencias`, …). */
  failure: string | null;
  /** With `failed`: `retryAttachment` makes sense (network, server down) or not (cap reached, rejected). */
  retryable: boolean;
  /** It was already uploaded when the report was created: it went with the report. */
  sentWithReport: boolean;
}

/** What the project's data agreement lets the chat take from the page. It is a courtesy so you do not offer what would be thrown away: the server filters anyway
 * (what the assistant sees, and what is stored), also for a chat that ignores this. Until the core knows (`checkAvailability()` or the first action), everything is `true`. */
export interface ChatAllows {
  /** Screenshots and attached images. */
  screenshots: boolean;
  /** Pointing at an element of the page. */
  elements: boolean;
  /** The page URL and the browser (the automatic context), and the page of a pointed element. */
  pageAndBrowser: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  pendingQuestion: PendingQuestion | null;
  /** A turn is in flight: another message cannot be sent until it ends. */
  busy: boolean;
  error: ChatError | null;
  activity: ChatActivity | null;
  /** There is a conversation open on the server. Its id is NOT exposed: it is a bearer capability. */
  hasSession: boolean;
  /** The conversation already has its report. Attaching more is no longer offered. */
  reported: boolean;
  attachments: ChatAttachment[];
  /** There is room for more: the maximum is 4. */
  canAttachMore: boolean;
  /** What the data agreement lets the chat take (see `ChatAllows`). */
  allows: ChatAllows;
}

/**
 * The stream events, in English, delivered in order as they are consumed. An event this version does not know is not delivered (the protocol's
 * compatibility rule: within v1 things are only added). The agent's tool calls (`herramienta`) do NOT exist here: they are preview-only.
 */
export type ChatEvent =
  | { type: "session"; index: number }
  | { type: "user_message"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "assistant_message"; text: string }
  | { type: "question"; question: PendingQuestion }
  | { type: "question_resolved"; id: string; outcome: string; optionId?: string; text?: string }
  | { type: "activity"; activity: ChatActivity }
  | { type: "step"; step: ChatStep }
  | { type: "outcome"; outcome: ChatOutcome }
  /** The turn ended and the conversation stays open. */
  | { type: "turn_end"; index: number }
  /** The conversation ended. */
  | { type: "end" }
  | { type: "error"; error: ChatError };

export interface Availability {
  /** The chat of this project is active for this origin. */
  available: boolean;
  /** The HTTP status; 0 if the request never got there. */
  status: number;
  /** Why not: `chat_deshabilitado`, `origen_no_admitido`, `proyecto_desconocido`, `tope_de_mensajes`, `motor_inalcanzable` or `sin_respuesta`. `null` when available. */
  reason: string | null;
  /** What the data agreement lets the chat take. `checkAvailability()` also tells the core, which then stops sending and accepting what is not allowed. */
  allows: ChatAllows;
}

/** `not_allowed`: the project's data agreement does not let the chat take that (`allows`). Nothing was attached. */
export type AttachResult = "ok" | "limit" | "no_capture" | "invalid_image" | "busy" | "unavailable" | "not_allowed";
export type PickResult = "picked" | "cancelled" | "limit" | "unavailable" | "not_allowed";

export interface SupportChat {
  /** The current state. A NEW object per change (one already handed out is never mutated), so it works as a snapshot for `useSyncExternalStore`. */
  getState(): ChatState;
  /** Calls back with the new state on every change. Returns the unsubscribe function. */
  subscribe(listener: (state: ChatState) => void): () => void;
  /** Every stream event, in order. Returns the unsubscribe function. */
  onEvent(listener: (event: ChatEvent) => void): () => void;
  /** Resolves when the initial rewind of a saved conversation finished (immediately if there was none). */
  readonly ready: Promise<void>;

  /** A user message. With no open conversation it opens one. Ignored if the text is empty or a turn is in flight. Resolves when the turn ends. */
  send(text: string): Promise<void>;
  /** Answers the question `questionId`. Does nothing unless it is the question pending RIGHT NOW (and no turn is in flight): an answer for a question that was replaced is never sent. */
  answer(questionId: string, answer: { optionId?: string; text?: string }): Promise<void>;
  /** The user said yes, send it: answers `approve` ONLY if `questionId` is the pending report confirmation. Pass the `id` of the confirmation you drew, never "whatever is pending". */
  confirmReport(questionId: string): Promise<void>;
  /** The user wants to fix something first: answers `cancel` ONLY if `questionId` is the pending report confirmation. */
  reviseReport(questionId: string): Promise<void>;
  /** After a non-terminal error. With an open conversation it RECOVERS (it does not resend: that would duplicate the turn); without one it reopens with the same text. */
  retry(): Promise<void>;
  /** Start another conversation without reloading (for example after a report). The messages stay visible; the next `send` opens a new one. */
  newConversation(): void;
  /** Is the chat of this project active for this origin, and what does its data agreement allow? It does not count against the cap. */
  checkAvailability(): Promise<Availability>;

  /** The browser can capture the screen (`getDisplayMedia`, secure context). */
  canCaptureScreen(): boolean;
  /** Attach an image file. It is re-encoded in the browser (no EXIF). */
  attachImage(file: File): Promise<AttachResult>;
  /** Capture the screen. `hideUi` / `showUi` surround ONLY the frame grab: hide your UI there so it does not show in the image; `showUi` always runs. */
  attachScreenshot(options?: { crop?: { x: number; y: number; width: number; height: number }; hideUi?: () => void; showUi?: () => void }): Promise<AttachResult>;
  /** Let the user point at an element of the page. Resolves when they pick one or cancel (Esc; also when another pick replaces it or the chat is destroyed). `ignore` is your own UI, which cannot be picked. */
  pickElement(options?: { ignore?: Element | null }): Promise<PickResult>;
  removeAttachment(id: number): void;
  retryAttachment(id: number): void;

  /** Cancels whatever is in flight and stops notifying. */
  destroy(): void;
}
