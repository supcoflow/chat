# `@supcoflow/chat/core` — the chat without a UI

Use Supcoflow as the brain and the infrastructure of **your own chat**: you draw the messages, the buttons and the panel; the core talks to Supcoflow, rebuilds the
conversation after a reload, retries without re-sending a turn that already ran, uploads attachments, and enforces the one rule that matters — **the assistant cannot send a report on its own**.

If you just want a chat, the one-line widget or `<ChatDeIntake />` is far less work. This is the step with the most freedom and, as with any "build it yourself" API, the
most code and maintenance on your side. Every public name here is a commitment: it changes only with a major version.

It runs in the browser. It has no dependency on React, Preact or CSS (it is about 13 KB gzipped) and does not need a framework: `getState()` and `subscribe()` fit
`useSyncExternalStore`, Vue's `shallowRef`, Svelte stores, or a plain `render()` function. A complete example with no framework is in [`examples/custom-ui`](../examples/custom-ui/). In React, [`@supcoflow/chat/react`](./react.md) is the hook that creates and destroys the chat for you (safe in `StrictMode`), with an unstyled example in [`examples/react`](../examples/react/).

**What your interface has to show** — that it says it is an automated assistant, shows the exact report before it is sent, keeps the conversation when the person comes back, and so on — is written in the [presentation contract](./presentation-contract.md) (`@supcoflow/chat/contract.json` is the same thing for tools). How it looks is yours.

To check an interface without a real conversation —and to see the confirmation, a reload or the daily cap in your app— use the [test bench](./testing.md) (`@supcoflow/chat/testing`).

## Quick start

```ts
import { createSupportChat } from "@supcoflow/chat/core";

const chat = createSupportChat({ tenantId: "tnt_xxx", projectId: "proj_xxx" });

chat.subscribe((state) => render(state));   // every change, with the new state
render(chat.getState());

await chat.send("The save button does nothing");   // resolves when the turn ends
```

Register your listeners **right after** creating the chat. If a conversation was saved, it is rewound as soon as the chat is created (`chat.ready` resolves when it is done), and
events are delivered while that happens.

## Options

| option | default | what |
|---|---|---|
| `tenantId`, `projectId` | — | required, public ids |
| `backendUrl` | `https://chat.supcoflow.dev` | with or without trailing slash |
| `user` | — | `{ id, role, attributes }`: who the user is **according to your app**. Declared, not verified: it grants nothing, it is context for diagnosis. Since 2.4.0 it goes to the report only: the assistant does not read it in its notes. `id` up to 100 characters, `role` 60, up to 8 `attributes` (keys up to 39, values up to 200). Keys `id`, `role`, `name` are not sent. **There is no user name field**: it never leaves the browser |
| `appVersion` | — | your app's version; goes with every message and with the report. The assistant does not read it |
| `autoContext` | `true` | send the page URL (no query, no hash) and the browser with every message (the assistant reads **only the page**, in a note of each turn, so it can say where the person is; the page can change mid-conversation. The browser goes to the report, not to the assistant). Console errors: never |
| `storage` | `"session"` | where the conversation cursor is kept: `"session"` (sessionStorage), `"none"`, or your own `{ getItem, setItem, removeItem }`. What is kept is an **opaque record that belongs to the core** — today `{ id, indice }`, and its `id` is a **signed session id** issued by the backend (it ties the session to your project and expires after 24 hours; the backend answers a missing, expired or foreign one exactly like a session that no longer exists, and the core then clears the record) — so store it as a string and do not parse or build it. **Never the history** (it is rewound from the server). A record from an older version may be discarded and the conversation reopened |
| `resume` | `true` | rewind a saved conversation when the chat is created |
| `locale` | — | the language of your app (`"es"`, `"pt-BR"`, `"en"`…). The server writes the fixed words of the report confirmation — its two buttons and the frame around the report — in Spanish, English or Portuguese; any other language, or none, is English. It goes with every request of the conversation, so a conversation rewound after a reload comes back in the language you declared now. **Declare it**: it is how the buttons come in your app's language |
| `capabilities` | `{ newConversation: true }` | what YOUR interface really offers besides text: `{ pickElement, screenshot, attachImage, newConversation }`, each `true` or `false`. It goes with every message (header `x-supcoflow-capabilities`), and the server tells the assistant **in plain words, never with the name of one of your buttons**, so it invites the person to point at an element or attach a screenshot only if your interface can take one. Declare only what a person can really do in it. What you leave out is never offered; `newConversation` counts as declared unless you say `false` (P8 asks you to offer it); `screenshot` is only sent while `canCaptureScreen()` is `true`. The server can only take away: a project whose data agreement does not allow screenshots or pointing at an element gets them left out even if you declare them. It is read on every message, so it may change while the chat is open |
| `fetch` | global `fetch` | for tests |

## State

`chat.getState()` returns a **new object for each change** (an object already handed out is never mutated), the same object while nothing changes.

| field | |
|---|---|
| `messages` | `{ id, role: "user" \| "assistant" \| "outcome", … }[]`. User: `text`, `pending` (sent, not yet confirmed — it shows right away). Assistant: `text`, `streaming`, `steps`, and `reportCopy: true` only on the message that is the copy of a report confirmation (see [the report confirmation](#the-report-confirmation)). Outcome: `outcome` |
| `pendingQuestion` | `null` or `{ id, prompt, kind, options, allowsText, report? }`. See [the report confirmation](#the-report-confirmation) |
| `busy` | a turn is in flight; you cannot send another message until it ends |
| `error` | `null` or `{ code, message, terminal }`. Decide what to show by `code` |
| `activity` | `null` or `"reading_guide"` (what the assistant is doing besides writing) |
| `hasSession` | there is a conversation open on the server. Its id is **not** exposed |
| `reported` | the conversation already has its report; attachments are no longer offered |
| `attachments` | the attachments bar, see [Attachments](#attachments) |
| `canAttachMore` | room for more (the maximum is 4) |
| `allows` | `{ screenshots, elements, pageAndBrowser }`: what the project's **data agreement** lets the chat take from the page. See [Data agreement](#data-agreement) |

A `steps` entry is `{ kind: "guide_read", section }`, `{ kind: "report_summarized" }` or `{ kind: "question_noted" }`: draw it as a line above the answer. An `outcome`
message is `{ kind: "reported", reportId }` (draw a card with the number) or `{ kind: "answered" }`. **The text of those is yours**, not the model's.

## Drawing the assistant's text

The `text` of an assistant message is written by a model and has Markdown flavor. Draw it as plain text, or with the safe subset: paragraphs, lists, bold, italic, inline code, code blocks and links to **your own site's origin** — never HTML,
never an image, never a bare URL turned into a link. `parseAssistantText(text, origin)` parses exactly that subset into a tree (never into HTML) and you draw the tree with your own components:

```ts
import { parseAssistantText } from "@supcoflow/chat/core";

const blocks = parseAssistantText(message.text, window.location.origin);
// TextBlock  = { kind: "paragraph", children } | { kind: "list", ordered, items } | { kind: "code", text }
// TextInline = { kind: "text" | "code", text } | { kind: "bold" | "italic", children } | { kind: "link", href, children }
```

A link is drawn only when its URL has exactly the origin you pass (same scheme, host and port, no credentials); with `origin` as `null` there are no links. What is not in the subset stays as text, as written.

If you would rather use a Markdown library, do: turn its raw HTML and its images off and allow links only to your origin. The server helps but does not replace that: it breaks the syntax of a link to another site (it arrives as «label (url)»), of an image and of an HTML tag, replacing one character of it by a look-alike full-width one (`＜`, `］`) that no
library reads as markup. The **address stays written as text**: a library that turns bare URLs into links (`remark-gfm` does) would link it again, so draw a link only when its `href` has your origin. The report confirmation is the exception, it
arrives exactly as it will be sent, and you draw it as plain text.

## Long pasted text

A text the person pastes that is long is not drawn whole: it is drawn collapsed, as a short marker (the widget says «[pasted text]»), and the person can expand it. It is **sent whole**. The core does not draw anything; it gives the criterion, so that every interface collapses
the same:

```ts
import { isLongPaste, MESSAGE_MAX_LENGTH, pasteSize, PASTE_LIMITS } from "@supcoflow/chat/core";

PASTE_LIMITS;            // { characters: 1000, lines: 10 }: longer than either is "long"
MESSAGE_MAX_LENGTH;      // 4000: the most a message holds; a longer paste is cut there and the person must be told
isLongPaste(text);       // true: draw it collapsed
pasteSize(text);         // { characters, lines }: for a marker like «[pasted text] · 30 lines · 1,234 characters»
```

Use it on the paste event (to collapse what was just pasted, keeping the full text to send) and on the user messages of the conversation (`messages[].text`): after a reload, pasted text cannot be told from typed text. A message holds at most `MESSAGE_MAX_LENGTH` (4,000) characters (the server answers 400 to a longer one): if a paste does not fit, keep what fits **and tell the person how much was kept** — the marker alone would hide the cut. Never collapse the assistant's messages or the report confirmation.
See the presentation contract, P15.

## Methods

- `send(text)` — a user message. Opens the conversation if there is none. Ignored when the text is empty or a turn is in flight. Resolves when the turn ends.
- `answer(questionId, { optionId } | { text })` — answers question `questionId`. Does nothing unless that is the question pending **right now**, `optionId` is one of its options (or, for text,
  it takes text), and no turn is in flight.
- `confirmReport(questionId)` / `reviseReport(questionId)` — see below.
- `retry()` — after a non-terminal error. If the server **refused** the last request with an HTTP answer that carries a reason (`tope_de_mensajes`, for one: the turn never ran) it **resends** that same message or answer, and the message is not
  repeated in `messages`. After any other failure with a conversation open it **recovers** from the cursor (it does not resend: the request may have arrived and the turn run anyway); without a conversation it reopens
  with the same text.
- `newConversation()` — start another one without reloading (for example after a report). The messages stay visible; the next `send` opens a new conversation.
- `checkAvailability()` — `{ available, status, reason, allows }`: is the chat active for this origin, and what does its data agreement allow (see [Data agreement](#data-agreement))? Does not count against the cap. `reason`: `chat_deshabilitado`,
  `origen_no_admitido`, `proyecto_desconocido`, `tope_de_mensajes`, `motor_inalcanzable`, `sin_respuesta`. Call it before showing your button.
- `subscribe(listener)` / `onEvent(listener)` — each returns the unsubscribe function. A listener that throws does not break the chat or the other listeners (the error is
  reported with `reportError`).
- `ready` — a promise that resolves when the initial rewind finished (immediately if there was none).
- `destroy()` — cancels what is in flight (requests, attachment uploads and their retries, an open element picker) and stops notifying. Evidence the server had **already accepted** is not removed.
- Attachments: `canCaptureScreen()`, `attachImage(file)`, `attachScreenshot({ crop?, hideUi?, showUi? })`, `pickElement({ ignore? })`, `removeAttachment(id)`, `retryAttachment(id)`.

## The report confirmation

When the assistant has a bug to report it does **not** send it. It writes a summary and the server asks the user, with a question whose `kind` is `report_confirmation`:

```ts
const q = chat.getState().pendingQuestion;
if (q?.kind === "report_confirmation") {
  // q.id      → who this question is: hand it back when the user presses a button
  // q.prompt  → everything that will be sent, uncut, with a frame around it
  // q.report  → { title, body }: the same report, apart from the frame and exactly as it will be sent (an older backend does not send it)
  // q.options → [{ id: "approve", label, style: "primary" }, { id: "cancel", label, style: "default" }]
}
```

The report is sent only if the server receives `approve` for the **current** question, from the same project that opened the conversation, and the user wrote nothing after
the question. Your UI may look however you like, but **keep these three things**:

1. **Show `report` (or, when it is absent, `prompt`) and the `options[].label` exactly as they arrive.** The user has to see what is going to be sent. `report.title` and `report.body` let you lay the two out as you like; they are what the assistant wrote,
   so draw them with the care of any assistant text (see above), and never cut, summarize or edit them. The same text is also the last assistant message of `messages`, which carries `reportCopy: true`: draw it as plain text too, also after the person answered and after a reload (the mark stays), or show only one of the two. The labels and the frame of `prompt` are fixed by the server, not by the model or by you, in the language you declared in `locale` (Spanish, English or Portuguese; English otherwise).
2. **Never call `confirmReport()` on your own.** Only when the user pressed the button, and always with the `id` of the confirmation **that button belongs to** (`q.id` when you drew it) —
   not "whatever is pending now". If the user rejected draft A and the assistant then wrote draft B, a button left over from A does nothing: an approval is bound to the draft the user saw.
   The assistant cannot report without the user's "yes"; your code must not be what removes the user from that.
3. **Do not send the user's name.** The core has no field for it; do not put it in `attributes` either.

`confirmReport(id)` answers `approve` and `reviseReport(id)` answers `cancel`, **only** if `id` is the pending report confirmation (otherwise they do nothing). Typing "yes"
never approves it. If the answer arrives late (the user wrote something in between) the report is **not** sent and you get the error code
`confirmacion_no_vigente`.

After the report: an `outcome` of kind `reported` arrives with the number, `state.reported` becomes `true`, and `newConversation()` is how the user starts another one.

## Events

`chat.onEvent((event) => …)` delivers each stream event, in English, in order, as it is consumed — before the next state notification. It is for things like analytics, sounds
or scrolling. To draw the chat you only need the state. Events this version does not know are not delivered, and the agent's tool calls (`herramienta`) never are.

The exact wire shapes are in [`protocol-v1.md`](./protocol-v1.md).

#### `session`
`{ type: "session", index }` — a conversation was opened.

#### `user_message`
`{ type: "user_message", text }` — a user turn, confirmed by the server.

#### `text_delta`
`{ type: "text_delta", delta }` — a fragment of the assistant's answer.

#### `assistant_message`
`{ type: "assistant_message", text }` — the assistant's message, complete.

#### `question`
`{ type: "question", question }` — a question for the user (`question` is a `PendingQuestion`, with its `id`).

#### `question_resolved`
`{ type: "question_resolved", id, outcome, optionId?, text? }` — a question was answered.

#### `activity`
`{ type: "activity", activity: "reading_guide" }`.

#### `step`
`{ type: "step", step }` — a step the assistant took.

#### `outcome`
`{ type: "outcome", outcome }` — `reported` or `answered`.

#### `turn_end`
`{ type: "turn_end", index }` — the turn ended and the conversation stays open.

#### `end`
`{ type: "end" }` — the conversation ended.

#### `error`
`{ type: "error", error }` — `error` is `{ code, message, terminal }`.

## Reconnection

The conversation is the server's, not the browser's. The browser keeps only a cursor — today `{ id, indice }` (an opaque record: see `storage`) in `sessionStorage`, under the key
`supcoflow-chat/<tenantId>/<projectId>` (the same key the widget uses, so a site can move from the widget to its own UI without losing conversations in progress) — and a reload
rewinds the whole conversation from the server, including a confirmation that was still pending. Scoping it to the tab is deliberate: the session id is a bearer capability.

## Attachments

`state.attachments` is `{ id, kind: "element" | "screenshot", label, thumbnail, status, failure, retryable, sentWithReport }[]` with `status` `pending` → `uploading` → `uploaded`
(or `failed`). They are uploaded as soon as a conversation exists (an attachment added before the first message waits for it). At most **4**.

- `pickElement({ ignore })` — lets the user click an element of the page (Esc cancels). `ignore` is your own UI root so it cannot be picked. Resolves `"picked"`, `"cancelled"` (Esc, another pick replacing it, or `destroy()`),
  `"limit"`, `"unavailable"` or `"not_allowed"` (the data agreement does not let the chat take elements).
- `attachScreenshot({ hideUi, showUi })` — captures the screen with the browser's own permission prompt. `hideUi`/`showUi` surround **only** the frame grab (hide your UI there so it is
  not in the picture); `showUi` always runs. Check `canCaptureScreen()` first.
- `attachImage(file)` — an image file, re-encoded in the browser (no EXIF).
- Results: `"ok"`, `"limit"`, `"no_capture"`, `"invalid_image"`, `"busy"`, `"unavailable"` (no browser, e.g. in Node), `"not_allowed"` (the data agreement does not let the chat take images; nothing was attached).
- The model never sees ids, bytes or HTML of an attachment, only a short text summary. Once `state.reported` is `true`, do not offer attachments: they would belong to no report.

## Data agreement

Each project fixes, with Supcoflow, which data of **your** users the chat may take: the page and browser, screenshots, pointed elements, and which user fields. `state.allows` (and `checkAvailability().allows`)
tells you, so you do not offer what would be thrown away: `screenshots` (`attachScreenshot`, `attachImage`), `elements` (`pickElement`) and `pageAndBrowser` (the page URL and browser that go with every message, and the page
of a pointed element). The core also **honours it by itself**: with a `false` it sends nothing of that kind, and `attachImage` / `attachScreenshot` / `pickElement` resolve `"not_allowed"` without attaching anything.

- The core finds out **once**, before the first action that could send something (`send`, attaching, pointing), with `GET /api/chat/estado` (it does not count against the cap); or when you call `checkAvailability()`. Until then
  `allows` is all `true`. If that request fails, nothing is blocked (it stays all `true`) and it is not retried: the server filters anyway.
- It is a courtesy, **not the control**: the server filters what the assistant sees and what is stored, also for a chat that ignores `allows`. A project without an agreement fixed allows everything.
- What the user **types** is not filtered: there is no way to know which words are personal data. Tell your users not to write them in the chat.

## Errors

`state.error` is `{ code, message, terminal }`. `terminal: false` → show a "retry" and call `retry()`. `terminal: true` → the conversation is over (`hasSession` is `false`); the next `send`
opens another. Decide what to show by `code`: the list is in [`protocol-v1.md`](./protocol-v1.md#error-codes). `message` is not for your users. An attachment upload that fails sets
`failure` on that attachment (for example `tope_de_evidencias`), not `state.error`.

## Known limits

- **The server rewrites a few characters, in code too.** Inside a code block `<div>` arrives as `＜div>` and `arr[0](x)` as `arr[0］(x)` (full-width look-alikes, see above): someone who copies that code copies something that does not run.
- **Browser only.** It relies on CORS, `Origin` and `sessionStorage`. For a server, wait for the server-side product; do not call this from Node (it works there for tests, without
  attachments).
- **Retry can repeat the user's message in `messages`.** When the first request fails before a conversation exists, `retry()` works but the user's message
  shows twice in the list (the same happens in the widget today). A request the server refused with a reason in the middle of a conversation (the daily cap, for one) is resent without repeating it. Draw your list knowing that, or de-duplicate consecutive identical user messages.
- **A refused message you do not retry still looks sent.** If the server refuses a message with a reason (the daily cap) and the person writes something else instead of retrying, the refused message stays in `messages` with `pending: false` and the error clears when the next one goes out, so the list does not tell it apart from one the assistant read. Today the interface has to remember it: it saw the error.
- **One chat per project per tab.** The widget and the core keep the same cursor under the same key: do not run both for the same project on the same page.
- **Names are a commitment.** The wire protocol keeps its Spanish names; the English API is the one you code against.

## Versions

The package follows semver; the protocol has its own number (`v: 1`, `PROTOCOL_VERSION`). Session and attachment requests carry `x-supcoflow-sdk: core/<version>` (`<version>` also carries a fingerprint of the build after a `+`, as in `2.4.0+ab12cd34`) (the availability check does not, so it stays a simple request) so that Supcoflow *can* tell how many
sites run which version; today the backend only allows the header — it does not count installs yet — and decides nothing with it. `CORE_VERSION` exports that version.
