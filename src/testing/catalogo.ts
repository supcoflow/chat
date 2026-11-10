// EL CATÁLOGO del banco de pruebas: una ficha por cada escenario grabado en `core/contrato/*.json` (nombre en inglés, descripción para el developer y los
// puntos del contrato de presentación que deja ver). Los archivos son los mismos que repite `core/contrato.test.ts` contra el núcleo: lo que el banco
// entrega es lo que el núcleo ya prueba que anda. Un archivo nuevo sin ficha, o una ficha sin archivo, hace fallar `catalogo.test.ts`.

import { escenarioDesdeGrabacion, type Grabacion, type Scenario } from "./escenario";

import reload_of_expired_conversation from "../core/contrato/reload-of-expired-conversation.json";
import report_confirmed from "../core/contrato/report-confirmed.json";
import report_revised from "../core/contrato/report-revised.json";
import stale_screen_approval from "../core/contrato/stale-screen-approval.json";
import reload_with_pending_confirmation from "../core/contrato/reload-with-pending-confirmation.json";
import reload_of_many_turns from "../core/contrato/reload-of-many-turns.json";
import confirmation_no_longer_current from "../core/contrato/confirmation-no-longer-current.json";
import confirmation_from_older_backend from "../core/contrato/confirmation-from-older-backend.json";
import no_confirmation_no_approval from "../core/contrato/no-confirmation-no-approval.json";
import question_answered from "../core/contrato/question-answered.json";
import steps_after_the_answer from "../core/contrato/steps-after-the-answer.json";
import conversation_ended from "../core/contrato/conversation-ended.json";
import daily_cap_on_open from "../core/contrato/daily-cap-on-open.json";
import terminal_error from "../core/contrato/terminal-error.json";
import unknown_events from "../core/contrato/unknown-events.json";
import malformed_events from "../core/contrato/malformed-events.json";
import data_agreement_closed from "../core/contrato/data-agreement-closed.json";
import link_to_another_site from "../core/contrato/link-to-another-site.json";
import image_in_text from "../core/contrato/image-in-text.json";
import html_in_text from "../core/contrato/html-in-text.json";
import daily_cap_mid_conversation from "../core/contrato/daily-cap-mid-conversation.json";
import session_limit_mid_conversation from "../core/contrato/session-limit-mid-conversation.json";
import attachment_failed from "../core/contrato/attachment-failed.json";
import report_with_attachment from "../core/contrato/report-with-attachment.json";
import assistant_question from "../core/contrato/assistant-question.json";
import chat_unavailable from "../core/contrato/chat-unavailable.json";

const FICHAS: { name: string; description: string; covers: string[]; grabacion: Grabacion }[] = [
  { name: "report-confirmed", description: "The happy path of a bug: the assistant asks, summarizes, raises the report confirmation with its two buttons, and the person's \"yes\" sends the report. `confirmReport` answers `approve` with the id of the confirmation on screen.", covers: ["P6", "P8"], grabacion: report_confirmed as Grabacion },
  { name: "report-revised", description: "With the confirmation pending, the person picks \"fix something\": `reviseReport` answers `cancel`, nothing is reported and the conversation goes on.", covers: ["P6"], grabacion: report_revised as Grabacion },
  { name: "stale-screen-approval", description: "The person rejects draft A, the assistant writes draft B, and the handler of A's button, left over on screen, fires late. It must not approve B: an answer is bound to the confirmation the person SAW.", covers: ["P6"], grabacion: stale_screen_approval as Grabacion },
  { name: "reload-with-pending-confirmation", description: "The person reloads the tab with a confirmation still unanswered. The conversation is rewound from the saved cursor and the confirmation is pending again. Seed the storage with `storageWithSavedConversation`.", covers: ["P6", "P14"], grabacion: reload_with_pending_confirmation as Grabacion },
  { name: "reload-of-many-turns", description: "The reload of a conversation of several turns: the rewind brings the borders of the old turns and goes on to the end, so the confirmation at the end is still pending.", covers: ["P6", "P14"], grabacion: reload_of_many_turns as Grabacion },
  { name: "reload-of-expired-conversation", description: "The person comes back the next day: the saved conversation no longer opens (the seal lasts 24 hours; also if it belongs to another project or was revoked). The server answers the rewind with ONE terminal event, `sesion_vencida`. Nothing to retry, no empty chat that then fills in, and the next message opens a new conversation. Seed the storage with `storageWithSavedConversation`.", covers: ["P9","P14"], grabacion: reload_of_expired_conversation as Grabacion },
  { name: "confirmation-no-longer-current", description: "The confirmation is answered when it is no longer the current one (the person wrote something in between): the server refuses with `confirmacion_no_vigente`, the report is NOT sent and the screen has to say so.", covers: ["P6", "P9"], grabacion: confirmation_no_longer_current as Grabacion },
  { name: "confirmation-from-older-backend", description: "A backend older than the structured confirmation: the question arrives without `report`. `prompt` has everything, glued together, and confirming works the same way.", covers: ["P6"], grabacion: confirmation_from_older_backend as Grabacion },
  { name: "no-confirmation-no-approval", description: "With no confirmation pending, `confirmReport`, `reviseReport` and `answer` send nothing: a report is not approved on its own, and a question that is not there is not answered.", covers: ["P6", "P7"], grabacion: no_confirmation_no_approval as Grabacion },
  { name: "question-answered", description: "A usage question: the assistant reads a section of the guide, answers in fragments and the question counts as answered. It shows the activity, a step, the text, the outcome and the `espera` border.", covers: ["P3", "P4", "P5"], grabacion: question_answered as Grabacion },
  { name: "steps-after-the-answer", description: "The assistant writes and only AFTER that notes a question the guide does not cover: the step arrives after the answer and sticks to the last assistant message of that turn.", covers: ["P4"], grabacion: steps_after_the_answer as Grabacion },
  { name: "conversation-ended", description: "The server ends the conversation (`fin`): there is no cursor any more, the messages stay readable and the next message opens another conversation.", covers: ["P3", "P8"], grabacion: conversation_ended as Grabacion },
  { name: "daily-cap-on-open", description: "The daily message cap, on the very first message: the HTTP failure becomes ONE non-terminal error with the code `tope_de_mensajes`; no conversation opened and what the person typed stays on screen.", covers: ["P3", "P9"], grabacion: daily_cap_on_open as Grabacion },
  { name: "terminal-error", description: "A terminal error (`limite_de_sesion` on the first turn) ends the conversation: the cursor goes away, the error stays visible and there is nothing to retry.", covers: ["P9"], grabacion: terminal_error as Grabacion },
  { name: "unknown-events", description: "The compatibility rule: events, `que` values and fields from the future, and lines that are not v1, are ignored. An old interface keeps working when the chat gets better.", covers: ["P4"], grabacion: unknown_events as Grabacion },
  { name: "malformed-events", description: "A KNOWN event with a missing or mistyped field is treated as not received. In particular an incomplete confirmation is never shown: nothing approvable is invented.", covers: ["P6"], grabacion: malformed_events as Grabacion },
  { name: "data-agreement-closed", description: "The project closed its data agreement: `GET /api/chat/estado` says `permite` is false for everything. The core reads it before the first message and `allows` says so; the conversation goes on.", covers: ["P1", "P10"], grabacion: data_agreement_closed as Grabacion },
  { name: "link-to-another-site", description: "Assistant text with a link to another site. The server already rewrote it as `label (url)`, so it is text; the only link left is the one to your own origin (`{{origin}}`). A bare URL is text too: a Markdown library that links it must check the origin first.", covers: ["P4"], grabacion: link_to_another_site as Grabacion },
  { name: "image-in-text", description: "Assistant text with an image from another site. The server broke its syntax (a full-width `］`), so what arrives is text and no image for the browser to fetch. An interface never draws an image that comes from assistant text.", covers: ["P4"], grabacion: image_in_text as Grabacion },
  { name: "html-in-text", description: "Assistant text with HTML tags. The server swapped the `<` that could open a tag for a full-width `＜`, so it arrives as text. An interface never inserts assistant text as HTML.", covers: ["P4"], grabacion: html_in_text as Grabacion },
  { name: "daily-cap-mid-conversation", description: "The daily cap hits in the MIDDLE of the conversation: the second message gets `tope_de_mensajes`, the error is not terminal and what the person wrote stays in the list. The interface says the chat is not available for now and never offers a button that asks for more budget. Then the person retries: `retry()` sends the SAME message again (the turn never ran, so there is nothing to recover) and it shows once in the list; the second answer of the scenario accepts it.", covers: ["P3", "P9"], grabacion: daily_cap_mid_conversation as Grabacion },
  { name: "session-limit-mid-conversation", description: "The conversation reaches its limit mid-way: the server sends the terminal error `limite_de_sesion` (never a question asking for more budget). The conversation ends, what was written stays visible and starting another is all that is offered.", covers: ["P9"], grabacion: session_limit_mid_conversation as Grabacion },
  { name: "attachment-failed", description: "An attachment upload is refused (`tope_de_evidencias`, HTTP 429): the attachment is `failed` with `retryable: false` and the conversation goes on. Show each attachment's status and do not offer to retry what cannot be fixed. Needs a DOM (it points at an element).", covers: ["P10"], grabacion: attachment_failed as Grabacion },
  { name: "report-with-attachment", description: "A report with an attachment that already uploaded: the pointed element uploads when the conversation opens and, on confirming, it is marked as sent with the report (`sentWithReport`). The confirmation has to say which attachments go with the report. Needs a DOM.", covers: ["P6", "P8", "P10"], grabacion: report_with_attachment as Grabacion },
  { name: "assistant-question", description: "A question from the assistant that is not the report confirmation: three options plus free text. It is answered with the id of the question that was drawn and one of its options. The backend does not send these today (the assistant asks in its text); the protocol has them, so handle them.", covers: ["P7"], grabacion: assistant_question as Grabacion },
  { name: "chat-unavailable", description: "The chat of this project is off for this origin: `GET /api/chat/estado` answers 403 `chat_deshabilitado`. The interface does not offer the chat, or shows it disabled.", covers: ["P1"], grabacion: chat_unavailable as Grabacion },
];

export const scenarios: readonly Scenario[] = Object.freeze(FICHAS.map((f) => escenarioDesdeGrabacion(f.grabacion, f)));
export const scenarioNames: readonly string[] = Object.freeze(scenarios.map((s) => s.name));

export function getScenario(name: string): Scenario {
  const s = scenarios.find((x) => x.name === name);
  if (s === undefined) throw new Error(`Unknown scenario "${name}". The scenarios are: ${scenarioNames.join(", ")}.`);
  return s;
}
