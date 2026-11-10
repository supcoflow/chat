# Testing a chat interface — `@supcoflow/chat/testing`

A fake Supcoflow backend for the interface you build on [`@supcoflow/chat/core`](./core.md). It plays prepared conversations — the report confirmation, the screen left over from an old confirmation, a reload, the daily cap, the conversation limit, an attachment that fails, a link to another site — so you can **check** the interface and **see** every state, without spending anything, without waiting for the model and without touching production.

It never looks at the design. Whatever your interface looks like, the bench only reads three things:

1. **What it asked the backend, and when.** For example: no `approve` before the person pressed the button, and the `approve` that goes out carries the id of *that* confirmation.
2. **The text it showed.** For example: the title and the body of the report, whole; the report number after it was sent.
3. **The accessible roles of its controls** (that is your test library's job; the bench gives it a backend to talk to).

Which of those to check for each point of the [presentation contract](./presentation-contract.md) is up to your tests; the `covers` of each scenario below says which points it lets you check.

## Two ways to use it

**As a `fetch` in your tests** (any runner, any DOM, or none):

```ts
import { createSupportChat } from "@supcoflow/chat/core";
import { createFakeBackend } from "@supcoflow/chat/testing";

const backend = createFakeBackend("report-confirmed");
const chat = createSupportChat({
  tenantId: "t", projectId: "p",
  backendUrl: backend.url, fetch: backend.fetch,
  storage: "none", autoContext: false,
});
// …render your interface with `chat`, then walk the scenario like the person would
// (`backend.scenario.script` says how) until the confirmation is on screen:
const confirmation = chat.getState().pendingQuestion!;       // keep it: after the press it is gone
expect(backend.answers()).toEqual([]);                       // nothing answered before the press
// …press the "send it" button of your interface…
expect(backend.answers()).toEqual([{ seq: 4, requestId: confirmation.id, optionId: "approve" }]);
```

**As a local server, to see it in your app.** The same backend behind real HTTP with open CORS on the protocol's routes. Point the chat's `backendUrl` at it while you develop (any `tenantId` and `projectId` work):

```sh
npx supcoflow-chat-fake report-confirmed          # from a project that has @supcoflow/chat installed
npx --package @supcoflow/chat supcoflow-chat-fake --list   # from anywhere
```

It prints the URL (`http://127.0.0.1:4010` by default). Options: `--port` (`0` picks a free one), `--host`, `--delay` (milliseconds between the lines of an answer, 300 by default, so you can see the text arrive; `0` for all at once). While it runs, `POST /__fake/scenario` with `{"name": "…"}` switches the scenario, `POST /__fake/reset` starts it over, `GET /__fake/scenarios` lists them and `GET /__fake/state` returns what your app asked. From code: `startFakeServer({ scenario, port, host, lineDelayMs })`, imported from `@supcoflow/chat/testing/server` (Node only), returns `{ url, port, backend, close() }`. It is a separate entry on purpose: `@supcoflow/chat/testing` imports nothing from Node, so it bundles for a browser (Storybook, a development page) too. The `/__fake/*` routes have **no** CORS: only your terminal and your tests read them, not other pages. A body bigger than the real route accepts (2,300,000 characters) gets `413 cuerpo_demasiado_grande`; an unknown scenario name on `POST /__fake/scenario` gets `404 escenario_desconocido`; an internal failure `500 fake_fallo`.

A scenario is a conversation with **a script**: the server answers the first request of the conversation with its first response, the second with the second, and so on, whatever the request says. Walk it as the person would — `scenario.script` lists the steps. Past the last response the server answers `409 escenario_agotado`, which your interface shows as an error instead of hanging.

## The backend

`createFakeBackend(scenario, options?)` — `scenario` is a name from the catalog or a `Scenario` object (see [Your own scenario](#your-own-scenario)). Options: `backendUrl` (default `https://chat.fake.test`), `origin` (the page's origin, for the link to your own site; default `location.origin`, or `https://app.example.test`), `lineDelayMs` (default `0`).

| member | what it is |
|---|---|
| `fetch` | for `createSupportChat({ fetch })`. Answers the five routes of the [protocol](./protocol-v1.md); any other path gets `404 ruta_desconocida` |
| `url` | the `backendUrl` to give the core |
| `scenario` | the scenario playing now |
| `requests` | everything the interface asked, in order. Each one: `seq` (from 1), `kind` (`availability`, `open`, `follow`, `recover`, `evidence` or `unknown`), `method`, `path` (with the query), `headers` (lower case), `body` (already parsed) and `aborted` (`true` when the request's `AbortSignal` fired, whenever that was — the core aborts it when it is destroyed, with the turn still in flight or already finished) |
| `requestsOfKind(kind)` | the same, filtered |
| `answers()` | what the interface *answered* to a question, the report confirmation included: `{ seq, requestId, optionId?, text? }` |
| `remaining` | scripted responses nobody asked for yet; `0` when the scenario was walked to the end |
| `hold(options?)` | holds the **next** request of the session: it arrives and is recorded, and it is not answered until you call the function it returns. The interface is "working" (`busy`, no text yet) for as long as you like. `hold({ afterLines: 2 })` delivers two lines of the answer and holds the rest, so you can check a half-written text |
| `use(scenario)` | switches scenario and starts over |
| `reset()` | starts the scenario over: nothing consumed, no requests |
| `handle(request)` | the handler behind `fetch` and the local server, for a request already read |

`GET /api/chat/estado` (the availability check) answers without consuming a scripted response, with the `permite` the backend always sends today (everything allowed); `confirmation-from-older-backend` answers without it, like a backend before the data agreement. `POST /api/evidencias` (an attachment) answers `201` with an id of its own, unless the scenario scripted a failure.

In the text of a scenario, `{{origin}}` is the origin of the page asking (the `Origin` header, for the local server): that is how a scenario carries a link to *your own* site next to one to another site.

### A saved conversation

The two reload scenarios start with a conversation the tab already had. `storageWithSavedConversation(scenario, { tenantId, projectId })` returns an in-memory `storage` holding it; give it to `createSupportChat({ storage })` and the core rewinds that conversation when it is created. It is the one place that writes the saved record: your interface never builds it (P11).

### Pointing at an element

`attachment-failed` and `report-with-attachment` start with `{ pickElement: true }`: the person points at an element of the page. `completeElementPick(chat, target?)` does that for you in a test DOM (jsdom, happy-dom): it opens the core's selector, moves over `target` (a button of its own if you give none) and clicks, and resolves what `pickElement` answered (`"picked"`, or `"not_allowed"` if the data agreement forbids it). You do not need to know how the selector is built. When you test your whole interface and do not hold the `chat`, give it a function that presses YOUR «point at an element» control instead: `completeElementPick(() => fireEvent.click(button))` waits for the selector of the core, clicks, and resolves `true` (or `false` if no selector opened). The [conformance checks](./conformance.md) use it. The fake answers any upload the same way, so the same scenarios work with `attachImage` where your environment can encode an image.

## The scenarios

`scenarios` is the list, `scenarioNames` the names and `getScenario(name)` one of them. Each has a `name`, a `description`, `covers` (points of the presentation contract it lets you check), `script` (what the person does), `responses` (what the server answers) and, when it needs them, `evidence`, `availability` and `saved`. They are frozen. The same conversations are replayed against the core by the package's own tests, so what the bench plays is what the core is known to handle.

| scenario | covers | what it shows |
|---|---|---|
| `report-confirmed` | P6, P8 | the happy path of a bug: the report confirmation, and the "yes" sends it |
| `report-revised` | P6 | the person picks "fix something": nothing is reported |
| `stale-screen-approval` | P6 | the button of an old confirmation fires late and must not approve the new one |
| `reload-with-pending-confirmation` | P6, P14 | a reload with the confirmation unanswered; it comes back pending (use `storageWithSavedConversation`) |
| `reload-of-many-turns` | P6, P14 | the reload of a conversation of several turns |
| `reload-of-expired-conversation` | P9, P14 | the person comes back the next day: `sesion_vencida`, terminal. No retry, no empty chat that fills in; the next message opens a new conversation (use `storageWithSavedConversation`) |
| `confirmation-no-longer-current` | P6, P9 | the server refuses an answer to a confirmation that is not current: the report was **not** sent |
| `confirmation-from-older-backend` | P6 | a backend without the structured report: `prompt` has everything |
| `no-confirmation-no-approval` | P6, P7 | with no question pending, nothing is answered |
| `question-answered` | P3, P4, P5 | a usage question: activity, a step, streaming text, the outcome |
| `steps-after-the-answer` | P4 | a step that arrives after the answer |
| `conversation-ended` | P3, P8 | the server ends the conversation; the next message opens another |
| `daily-cap-on-open` | P3, P9 | the daily cap on the first message (`tope_de_mensajes`) |
| `daily-cap-mid-conversation` | P3, P9 | the daily cap in the middle of the conversation; what was written stays. `retry()` then resends the same message and the error clears |
| `session-limit-mid-conversation` | P9 | the conversation limit (`limite_de_sesion`, terminal) in the middle |
| `terminal-error` | P9 | a terminal error on the first turn |
| `unknown-events` | P4 | events and fields from the future are ignored |
| `malformed-events` | P6 | an incomplete confirmation is never shown |
| `data-agreement-closed` | P1, P10 | the project's data agreement allows nothing to be taken from the page (`allows`) |
| `link-to-another-site` | P4 | a link to another site already rewritten as text, one to your own origin, a bare URL |
| `image-in-text` | P4 | an image from another site, already broken into text |
| `html-in-text` | P4 | HTML tags, already neutralized |
| `attachment-failed` | P10 | an upload refused (`tope_de_evidencias`): `failed`, not retryable. Needs a DOM (see [Pointing at an element](#pointing-at-an-element)) |
| `report-with-attachment` | P6, P8, P10 | an attachment that uploaded goes with the report. Needs a DOM, see [Pointing at an element](#pointing-at-an-element) |
| `assistant-question` | P7 | a question of the assistant: three options and free text. The backend does not send these today (the assistant asks in its text); the protocol has them, so handle them |
| `chat-unavailable` | P1 | the chat is off for this origin (`GET /api/chat/estado` answers 403) |

## Your own scenario

A scenario is plain data. When the catalog lacks the case you need, write it with the same shape:

```ts
import type { Scenario } from "@supcoflow/chat/testing";

const engineDown: Scenario = {
  name: "engine-down",
  description: "The engine cannot be reached on the second message.",
  covers: ["P9"],
  script: [{ send: "hello" }, { send: "and one more" }],
  responses: [
    { stream: [ { v: 1, t: "sesion", id: "ses_1", indice: 0 }, { v: 1, t: "usuario", texto: "hello" },
                { v: 1, t: "asistente", texto: "Hi!" }, { v: 1, t: "espera", indice: 4 } ] },
    { http: 502, body: { ok: false, motivo: "motor_inalcanzable" } },
  ],
};
const backend = createFakeBackend(engineDown);
```

A `stream` is the lines of the [protocol](./protocol-v1.md), one object each, ending in a border (`espera`, `fin` or a terminal `error`); a string is sent as is, to test a line that is not v1. `http` is a failure that is not a stream. `evidence` scripts the answers to the uploads, `availability` the answer of `GET /api/chat/estado` (`{ status?, body }`), `saved` the conversation a reload starts from.

## What the bench does not do

- **It does not check how the interface looks.** Not classes, not colors, not layout.
- **It is not the real backend.** The lines of each scenario are written by hand from the events the backend's translator emits; they are not captures of a live server, and nobody asked a model. It cannot tell you what the assistant will *say*.
- **It does not count.** The real server has a daily cap and 5 uploads per conversation; the fake only plays what the scenario scripted.
- **It does not play a retryable upload failure quickly.** The core retries a failed upload three times, waiting 0.5, 1.5 and 4 seconds, before it shows `retryable: true`. Write a scenario of your own and use fake timers.
- **It does not check the human points** of the contract (that "automated assistant" is said in your app's language, that a screen reader announces a message). Those are for a person looking at the screen.
