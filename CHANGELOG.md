# @supcoflow/chat changelog

## 2.4.0 — 2026-11-09

Additive within protocol v1: one new event, `paso`. Two fixed texts change (the report card) and new ones are added
(the steps, «Thinking…» and the attachments). These attachment and report-card changes were first written under
2.3.1, but they are not in the 2.3.1 published to npm on 2026-10-29.

**New**
- **`@supcoflow/chat/react`: the chat in React, with no design.** `useSupportChat(options)` returns `{ chat, state, availability, available, ready }`: it creates the core when the component mounts (never while rendering, so it is safe on the server and in Next.js), destroys it on unmount (so `StrictMode`'s first mount leaves nothing alive: its turn and rewind are aborted, its availability check is ignored), and
  sets `ready` once a saved conversation has been rewound (so the interface never shows an empty chat that fills in later). No components, no CSS, no icons: the interface is yours. It imports `@supcoflow/chat/core` instead of bundling it, so there is one copy of the engine on the page
  (0.7 KB gzipped). `react` is an optional peer, as before. `docs/react.md` and an unstyled example, `examples/react` (bare HTML elements, the points of the presentation contract marked in its comments, tested against the real core), travel in the package.
- **`@supcoflow/chat/testing`: a test bench for the interface you build.** A fake backend that plays the recorded conversations of the core's contract tests and records what your interface asked and when:
  as a `fetch` for your tests (`createFakeBackend(scenario)` → `{ fetch, requests, answers(), hold(), … }`) and as a local server with open CORS (`startFakeServer()` from `@supcoflow/chat/testing/server`, Node only, or the new command `supcoflow-chat-fake`)
  so you can see each state in your app without spending anything. 26 scenarios: the report confirmation, the screen left over from an old confirmation, a reload with the confirmation pending, a conversation that expired overnight, the daily cap
  and the conversation limit (on open and in the middle), an attachment that fails, a link to another site, an image, HTML in the text, a question of the assistant, a chat that is off. It looks at requests, text and roles — never
  at the design. `completeElementPick(chat)` points at an element in a test DOM, for the scenarios with an attachment. No React, Preact, CSS or Node in `@supcoflow/chat/testing` (about 13 KB gzipped), so it bundles for a browser too. Contract in `docs/testing.md`; a test ties the document to the catalog. The scenario files of the core's contract tests
  (`src/core/contrato/*.json`, not published) were renamed to English and nine were added.
- **Safe text, on the server and in the core.** The backend now breaks the syntax of a link to another origin than the page's, of an image and of an HTML tag in the assistant's text, whatever interface draws it: a link to another
  site becomes «label (url)» and the character that would open a tag, a link, an image or a reference definition becomes a look-alike full-width one (the report confirmation is never rewritten: it arrives exactly as it will be sent). The rule
  used to live only in the widget. The address of a rewritten link stays written as text, so an interface whose Markdown library links bare URLs must still draw links only to its own origin. `@supcoflow/chat/core` also exports
  `parseAssistantText(text, origin)`, the widget's own parser (paragraphs, lists, bold, italic, code, and links only to `origin`) with English node names, so an interface can draw the same subset. The widget draws the same, except for the
  text the server now neutralizes (a foreign link shows as «label (url)», a `<b>` as `＜b>`, and `![x](own-site)` as text).
- **The report confirmation, structured and in your app's language.** `pendingQuestion.report` is `{ title, body }`: the report apart from the frame that `prompt` puts around it, exactly as it will be sent (on the wire, an optional `reporte`
  inside v1; an older backend does not send it and `prompt` has everything). The new `locale` option (`x-supcoflow-locale` on the three session requests) makes the server write the two buttons and that frame in Spanish, English or
  Portuguese (a closed table; English for any other language or none). The widget does not send it: it keeps its English buttons.
- **Long pasted text, collapsed.** A text the person pastes that is longer than 1,000 characters or 10 lines shows as «[pasted text]» (with its size, expandable) instead of the whole text, in the box where they write and in the conversation, and
  it is **sent whole**. `@supcoflow/chat/core` exports the criterion (`isLongPaste`, `pasteSize`, `PASTE_LIMITS`) so any interface collapses the same; the widget does it. A user message that long is collapsed even after a reload. What is pasted shows, before sending, its size and first line and can be opened; a paste that does not fit in a message (`MESSAGE_MAX_LENGTH`, 4,000) is cut and the person is told how much was kept.
- **The presentation contract** (`docs/presentation-contract.md`, and `contract.json` in the package). It says what an interface built on `@supcoflow/chat/core` has to show — never how it looks —
  as numbered points (P1…P14): the person knows it is an automated assistant, sees the exact report before it is sent, gets text drawn safely, is told what happened after a report, and finds
  the conversation again when they come back (the conversation history is required). It also separates what is on by default (image, screenshot, pointing at an element, «reading the guide») from
  what is optional. No mark of Supcoflow is asked for. P15 asks for long pasted text to be collapsed; P16 (the list of a person's past conversations) is required once the server supports it, which it does not yet. A test ties the document, the JSON and the types of the core: they cannot drift apart.
- **Conformance: the presentation contract as tests** (`conformance/`, `docs/conformance.md`). `checks.ts` (copy it unedited) holds one check per point of the contract (P1…P15; 30 checks) and `chat.conformance.template.tsx` is the adapter you adapt: how your
  interface is mounted and the words of its controls. They run on the fake backend of `@supcoflow/chat/testing`, with Testing Library and vitest, in CI and with no browser, and look only at the requests your interface makes, the text it shows and the accessible roles and names
  of its controls — never classes, `data-*`, layout or Tailwind. What no test can tell (the language of «automated assistant», what a screen reader says) is listed in `MANUAL`. The official widget and the React example pass every check; `broken-chat.tsx` (not shipped) is
  a chat with one mistake at a time (16 cases) and a test proves each check fails it, and accepts interfaces that are different but right (an indicator hidden when idle, the report in a quote or a code block, a «More» button, a panel closed with `inert`). A check the adapter cannot apply (attachments without `pickElement`, the person's name without `personWired`) is reported as skipped, not as passed.
- **`ChatMessage.reportCopy`** (additive): the assistant message that is the copy of a report confirmation carries `reportCopy: true`, also after the person answered and after a reload, so an interface can draw it as plain text (P6) without remembering which message it was. The widget draws that
  message as plain text now (it drew it as Markdown). The example in `examples/react` uses the mark instead of remembering the confirmations it saw.
- **`RecordedRequest.aborted`** (`@supcoflow/chat/testing`, additive): `true` on a request whose `AbortSignal` fired, whenever that was: the core aborts it when it is destroyed, with the turn still in flight or already finished.
- `completeElementPick(start)` (`@supcoflow/chat/testing`) also takes a function that presses YOUR «point at an element» control, for tests of a whole interface; it resolves `true` when the selector of the core opened and was clicked.
- **`@supcoflow/chat/core`: the chat without a UI.** `createSupportChat(options)` talks to Supcoflow for you — sending messages, streaming text and events (including `paso`), the report
  confirmation (`confirmReport()` / `reviseReport()`, only for the confirmation the server asked), reconnection after a reload, attachments, errors — and gives you a state to draw
  (`getState()` / `subscribe()`) with English names. No React, Preact or CSS (about 13 KB gzipped). Contract in `docs/core.md` and `docs/protocol-v1.md`; a complete interface in under a
  hundred lines in `examples/custom-ui`. The widget now runs on the same engine (`ControladorDelChat`) with no change in what it does (one small difference: if a second chat on the page starts an element picker, the first one's panel comes back instead of staying folded).
- **Every request carries `x-supcoflow-sdk: core/<version>` or `widget/<version>`**, so Supcoflow can tell how many sites run which version (nothing is decided with it). The chat backend
  has to be deployed with the new CORS list **before** a site runs this version, or the browser's preflight will refuse the request; the one-line script is served by the backend itself, so it
  is always in step.
- **The steps the assistant really took, as a line above its answer**: «Read the guide · Billing» (the
  guide section it looked up), «Summarized the report» (the draft report is ready and shown to you; it is
  not sent yet) and «Noted your question» (a question the guide doesn't cover was recorded). Each one
  shows only after the backend saw the fact — a section is named only if the guide lookup returned it, and
  the question is «noted» only if the product confirmed it. They carry no tool names, arguments, results or
  reasoning. Nothing is shown when nothing happened (for example, when the whole guide is already in the
  assistant's context there is no lookup, so no «Read the guide» line).
- The working indicator now says **«Thinking…»** (with a moving shine) instead of three dots, and keeps
  saying «Reading the support guide…» during a lookup.

**The assistant sees the page, the pointed element and what your interface offers in EVERY answer (diagnosis «chat-contexto-ciego»; additive within protocol v1)**
- Until now the context of a turn (page URL, browser, declared user, the pointed element, and `interface_offers`) reached the model in a single call of the turn, the first one, and was dropped. The instructions make the assistant call a tool (`clasificar`, often `orientar`) before it writes, so the answer the
  person read was written by a later call that saw none of it: «I don't know what page you're on», «you didn't point at anything», and an assistant that never invited the person to point at an element or attach a screenshot. Now the backend hands to the model, as a system note of **every** turn, three things already filtered by the data agreement and trimmed: the page, the pointed element and what the interface offers. **Not** the declared user (`usr_*`), the browser or the app version: they still go to the report, but the model does not read them and eve does not keep them in its run record (owner's privacy decision).
- The core and the widget send the page URL, the browser, the app version and the declared user with **every** message (before, only with the first one): the person can change page mid-conversation. The copy that goes to the report is still the first one only.
- The assistant's instructions (`chat-v16`) say that it may use the note to answer «where am I?» or «what did I point at?», without presenting it as something the person said.
- The conformance template checks that an interface that offers pointing at an element declares it in `capabilities` (`P10.declares-what-it-offers`).

**Capabilities your interface declares, and an assistant that no longer names buttons (T7; additive within protocol v1)**
- **`capabilities` option** (`{ pickElement, screenshot, attachImage, newConversation }`, each `true` or `false`; header `x-supcoflow-capabilities` on the three session requests). Until now the assistant's instructions
  told it the exact names of the widget's buttons («Pick an element», «Take a screenshot», «Attach an image», «New conversation»), so an interface with other buttons — or without a screenshot — got an assistant that invited the person to
  press something that was not there. Now the interface says what it really offers and the server tells the assistant, **in plain words and never with the name of a button**, so it invites the person to point at an element or attach a
  screenshot only if the interface can take one. What is not declared is never offered; `newConversation` counts as declared unless you say `false` (P8 asks for it); `screenshot` is only sent while `canCaptureScreen()` is `true`.
  The server can only take away: the project's data agreement still removes what it does not allow, and the console preview offers no evidence. The widget declares what it draws (the same things its panel decides).
  The assistant's instructions are now `chat-v14`: they no longer name any button of the widget, nor the two buttons of the report confirmation (whose words come in the language of your `locale`).
- **A report is plain text.** The server refuses a report whose title or body has link, image or HTML syntax (the assistant is told why and rewrites it) before the person is asked to confirm, so what is shown, what is sent and what is safe are the
  same text. The name of a guide section in a `guia_leida` step goes through the same safe-text filter as the assistant's text.
- **The presentation contract is `1.1.0`** (a minor: the three evidence capabilities say "declare it in `capabilities` when you offer it"; nothing becomes required). Its "Known limits" no longer says the assistant does not know what your interface offers.

**Privacy (the project's data agreement), widget and core**
- **The chat no longer offers, or sends, what the project's data agreement does not allow.** `GET /api/chat/estado` now answers `permite: { capturas, elementos, pagina_y_navegador }`. The widget hides
  «Pick an element», «Take a screenshot» and «Attach an image» (and «Capture this element») when they are not allowed, and does not send the page URL or the browser. It is a courtesy: the backend
  filters what the assistant sees, and the engine filters what is stored, whatever a widget sends.
- **Core:** `state.allows` and `checkAvailability().allows` (`{ screenshots, elements, pageAndBrowser }`); `attachImage`, `attachScreenshot` and `pickElement` resolve `"not_allowed"` and attach nothing. The core
  finds out once, with one `GET /api/chat/estado` (no cap), before the first action that could send something; a failed request blocks nothing. See `docs/core.md#data-agreement`.
- **The data the model reads now travels as data, with unambiguous keys.** `usr_id`, `usr_rol` and `usr_attr_<key>` replace `usuario_id`, `usuario_rol` and `usuario_<key>` (an attribute called `id` used to overwrite the
  user's id); an attribute called `id`, `rol` or `nombre`, or with a key over 39 characters, is not sent (a warning in the console). The single `evidencia` string is replaced by `evidencia_elemento`,
  `evidencia_elemento_pagina` and `evidencia_capturas`; the backend writes the sentence for the model after filtering.
- What the user **types** is not filtered. Tell your users not to write personal data in the chat.

**Changed**
- **`x-supcoflow-sdk` identifies the code, not only the version.** It now carries the package version plus a short fingerprint of what goes into the build (the source, the build configuration and the locked versions of the dependencies) (`core/2.4.0+ab12cd34`, semver build metadata). The
  version alone could not tell two builds apart: the `<script>` served from `main` can carry changes that are not published yet under the same version number as npm. The same label is now the same code. Informative only:
  the backend decides nothing with it. `CORE_VERSION` is unchanged.
- **The report card no longer promises anything.** It said «Reported. The team will review it.»: the chat can't back that. It now says «Report sent.», the number, and what the chat does
  know: «Nothing written here from now on is added to it.» (the report is closed). The «New conversation» button stays.
- **«Remove» only appears where it does something.** An attachment that already uploaded is linked to the report even if it is taken off the list (there is no way to withdraw it), so it no
  longer has a «Remove» button: it says «Attached. It goes with your report if you send one.» A pending or failed attachment (never uploaded) can still be removed.
- **Only what had already uploaded is said to have gone with the report.** An attachment that finishes uploading after the report is just «Attached», and a failed one can no longer be retried.
- **After a report is sent, no more attachments.** The engine links evidence to the report only when it is created, so anything attached afterwards would go with no report. The attach buttons
  disappear once the report card is shown, and what was already uploaded says «Attached. It was sent with your report.» «New conversation» brings them back.
- **The report confirmation lists what goes with it**, under the summary: «Your attachments that go with it: 1 image, 1 pointed element.» (and «Not attached yet: n.» for what is still uploading or failed).
  No line when nothing was attached. The line only counts what the person attached (the page URL and browser sent with the first message are linked too, but are not theirs). After reloading the tab the list
  of attachments starts empty (it is not rebuilt from the stream) while the engine still links what was already uploaded.
- **`retry()` after a refusal resends the message instead of losing it.** When the server answers a message (or a button answer) in the middle of a conversation with an HTTP refusal that carries a
  reason — the daily cap, `tope_de_mensajes`, is the case — the turn never ran. `retry()` used to rewind the conversation, which brought nothing new, and the message was left looking delivered
  (`pending: false`) although the server had never seen it. Now it sends the SAME message (or answer) again, without repeating it in `messages`; if it is refused again, the next `retry()` sends it again.
  After a network cut or a `5xx` with no reason (a gateway: the request may have arrived) it still recovers, as before. The widget and `@supcoflow/chat/core` behave the same, and
  `daily-cap-mid-conversation` of the test bench now plays the retry. No protocol change: the client marks the refusals it made up itself (a field that only lives in the browser).

**Fixed**
- **The message list now follows the conversation to the bottom, even when a lot arrives at once.** It used to scroll down by itself only if what was added was shorter than 80 px, measured after the change. Since the
  server sends the text sentence by sentence, a long sentence (or your own bubble plus «Thinking…») went past that, and in a conversation longer than the panel the answer was left below the edge with no visible scrollbar:
  you saw the first sentence and the rest was hidden. Whether the list was at the bottom is now decided before it changes and the list goes down after every change if it was; sending a message, pressing an answer button
  or pressing «Retry» always goes to the bottom; if you scrolled up to read, you are not dragged down. A recovered conversation also opens at the bottom, and so does the panel when it is closed and reopened. A change of the panel's height that is not yours (the text box growing as you type or paste, the keyboard on a phone, resizing the window) keeps the list at the bottom without waiting for the next message. Widget only: no protocol or backend change.

**Compatibility**
- With an older chat backend the `paso` event never arrives and nothing changes. An older widget ignores it.
- **Deploy the chat backend before a site runs this version with `locale`.** The option sends `x-supcoflow-locale`, and a backend that does not name it in its CORS answer fails the browser's preflight: the whole chat stops, not
  only the button labels. Without `locale` the header is never sent. The same goes for a `backendUrl` that points to an old preview.
- With an older backend `pendingQuestion.report` is absent (use `prompt`) and the text is not rewritten.
- **Deploy the chat backend before a site runs this version.** The widget and the core send `x-supcoflow-capabilities` on every session request; a backend that does not name it in its CORS answer fails the browser's preflight and the whole
  chat stops (same as with `locale`). With an older backend the header is ignored and the assistant keeps naming the widget's buttons. A client that never sends it (widget 2.3 and earlier) is assumed to offer all four capabilities.
- This version needs the chat backend that filters by the agreement (it accepts both the new and the old keys). An older backend (without the filter) passes the new keys to the assistant as they come, without the sentence that frames the evidence as
  information and without the data agreement: deploy the backend first.

## 2.3.1 — 2026-10-29

Bug fix. No API or protocol changes, no new texts.

**Fixed**
- **«Take a screenshot» could leave the whole chat hidden.** The widget hid itself (panel and bubble)
  *before* asking the browser for permission to capture the screen, and only came back when that request
  finished. In a browser that never answers the dialog (headless Chrome, or a dialog nobody touches) the chat
  stayed hidden until the page was reloaded. Now the permission is requested with the chat in view, the
  widget hides only for the instant of the frame (and always comes back), and nothing waits forever: the
  permission request gives up after 60 s and the frame after 5 s, and the user sees the usual
  «No screenshot…» notice. If the permission arrives after the timeout, the capture it opened is closed.
- A second tap on «Take a screenshot» while the first request is pending no longer opens another dialog —
  also after the 60 s timeout: the browser's own permission request can't be cancelled, so the widget keeps
  it as pending and asks again only once it has been answered (or rejected).

## 2.3.0 — 2026-10-29

Additive within protocol v1.

**The widget is in English.** Every fixed text (buttons, placeholders, notices, the start screen)
is now English, always, with no per-project switch. The assistant still replies in the language the
user writes in. A site that updates sees its chat in English.

**New**
- «Reading the support guide…» while the assistant looks up the guide (the `actividad` event).
- After a report: a card «Reported. The team will review it.» with «Report rep_…»; after an
  answered question: the chip «Answered · no issue» (the `desenlace` event). The widget draws them,
  not the model.
- Errors mid-conversation show the widget's own text chosen by the error code, never the backend's
  message.
- After a report, the card has a «New conversation» button. Reloading the page resumes the SAME
  session, so a user who had already reported was stuck; the button forgets the saved session (the
  messages stay on screen) and the next message opens a new one.

**Changed**
- The widget only draws a link when it points to the site's own origin (the page that hosts the
  chat). Any other URL the assistant writes stays as plain text, so a manipulated assistant can't
  send your users to another site.
- Default `titulo`: `"Ayuda"` → `"Help"`.

**Compatibility**
- 2.3.0 is meant for the chat backend released with it. With an older chat backend the new events
  (`actividad`, `desenlace`) don't show, because it doesn't send them; everything else works as in 2.2.1.
- **The chat backend retired `POST /api/chat` on 2026-10-29** (it now answers 404). That route was
  only for `@supcoflow/chat@0.1.0`: a site still on 0.1.0 can no longer chat and must update the
  widget to 2.x. 2.x does not use it: it talks to `/api/chat/sesion*`, `/api/chat/estado` and
  `/api/evidencias`, which are unchanged.
- Size measured when closing the phase: 25.2 KB + 25.4 KB gzip (budget 80).
- `versionApp` is trimmed to 100 characters (a longer one made the backend reject the whole turn).

## 2.2.1 — 2026-09-12

CSS only. No API or protocol changes.

**New**
- `--scf-alto`: in `modo="inline"` the panel takes that height from its container (a custom property
  on any ancestor of `<ChatDeIntake>`). Without it, 560px as before. Supcoflow's console preview uses
  it to stretch the widget to the full column.

## 2.2.0 — 2026-09-11

Additive within protocol v1.

**The look changes.** It's a minor because the API only grows, but a site that updates sees a
different widget: the header is light with the logo as avatar, the accent paints the user's bubble
and the send button and nothing else, the tools live inside the composer as icons, attachments are
thumbnails with status, and the assistant types with three animated dots.

**New**
- **Start screen**: a greeting with the user's name, the project's greeting (edited in the console
  or via `saludo`), and two starters that go in as the user's first message.
- `usuario.nombre` (and `data-usuario-nombre`): only for the greeting. Never sent.
- `saludo` (and `data-saludo`), `abierto` (and `data-abierto`).
- The text over the accent is computed: a light accent (`#fcba03`) gets dark text.
- Surfaces derive from `fondo` and `texto` with `color-mix()`: a dark site sets those two and the
  rest follows. Requires a 2023 or later browser.
- In the footer: the automated-assistant disclosure and «Supcoflow».
- `onEvento` (internal) and the `herramienta` stream event, only in the console's preview.

**Fixed**
- With a saved conversation, reloading the tab showed an EMPTY list while the assistant carried on
  with memory: the widget rewound from the last index instead of from zero.

**Inside**
- `TEMA_POR_DEFECTO.radio` goes from `12px` to `20px` (the panel).
- Size measured when closing the PR: 23.8 KB + 24.0 KB gzip (budget 80).

## 2.1.0 — 2026-09-09

Additive within protocol v1.

**New**
- `usuario` (`{ id, rol, atributos }`, and `data-usuario-id`/`data-usuario-rol` on the `<script>`):
  who the user is according to your app, declared. Goes to the assistant and the report. No `nombre`
  yet.
- The **project's branding** (logo, title, theme) edited from Supcoflow's console applies on its own
  at mount, under whatever you pass in code. Logo in the panel header.
- `previewToken` (internal): what the console uses to show you the real widget before installing it.
  With it the widget carries the «Preview» badge and uploads no evidence.

**Inside**
- `x-supcoflow-preview` header on `GET /api/chat/estado` and on every request to `/api/chat/sesion*`.
- `GET /api/chat/estado` returns `marca`; an old backend doesn't send it and the widget uses its
  defaults.
- Size measured when closing the PR: 20.5 KB + 20.6 KB gzip (budget 80).

## 2.0.0 — 2026-09-06

Widget rewrite.

**Never published to npm under this number**: the 2.x line reached npm as 2.1.0 (2026-09-10). There
were no betas on npm — `npm publish` without `--tag` marks any version `latest`, and an
`npm i @supcoflow/chat` would have installed the beta.

**Breaking**
- React is no longer required: `peerDependencies.react` is optional and accepts `>=18` (was `>=19`,
  required). `ChatDeIntake` keeps its props (`tenantId`, `projectId`, `backendUrl`, `contexto`).
- The panel is a **floating bubble** by default. `modo: "inline"` brings back the 1.x behavior (the
  panel wherever you mount it).
- `contexto.url` is no longer declared: it goes on its own with `contextoAutomatico` (default `true`).
- The browser no longer talks to `/eve/v1`: it talks to the chat backend's `/api/chat/sesion*`, in a
  format of its own (v1). The 1.x backend doesn't serve it; both have to be deployed together.

**New**
- `https://chat.supcoflow.dev/widget.js` serves the IIFE with a five-minute cache.
- `montarChat()` for sites without React, and `widget.js` (IIFE) to paste as one `<script>` line.
- The assistant's Markdown rendered (a safe subset, no HTML).
- Report confirmation with buttons (Eve's `ask_question`, translated by the backend).
- The conversation survives a tab reload.
- A mid-conversation error is shown and keeps what was typed, instead of hiding the panel.
- `onDiagnostico` and `motivo` in `GET /api/chat/estado`: the developer knows why it doesn't show.
- Theming via CSS variables.
- **Pick an element** of the page (selector from [Orca](https://github.com/stablyai/orca), MIT),
  **take a screenshot** (`getDisplayMedia`, cropped to the element) and **attach an image**.
  Everything goes to the report and to the agent that fixes it; the chat's model only gets a
  description. Up to 4 attachments per conversation; they can be added before the first message.
- The `contexto` (URL, browser, `versionApp`) finally reaches the report: the backend forwards it
  with the first turn.

**Inside**
- Preact and a custom NDJSON client, bundled with esbuild; `eve` stays on the server. The package
  goes from 47 MB installed (with `eve` as a dependency) to one file under 80 KB gzip (measured:
  19.8 KB + 19.9 KB). The build checks the budget.
- Nothing from the selector or the screenshot travels through the agent's session: the chat
  backend's `POST /api/evidencias`, which counts against the message cap and forwards to the engine.

## 1.0.0 — 2026-09-02

For whoever installs, not whoever maintains.

**Retired on the backend side on 2026-09-06**: `/eve/v1` stopped accepting the
browser, so this version mounts but doesn't converse. It was retired with zero installed sites
(measured 2026-09-03). If you have it, update to 2.x.

- **The transport moves to Eve** (`useEveAgent`): a session per conversation and an NDJSON stream
  against `{backendUrl}/eve/v1/*`. Using the component doesn't change: same three props.
- **React ≥19**, as before.
- **New requirement: Node ≥24** in the install and build environment, because of `eve`.
- **New dependency: `eve@0.47.7`** (~47 MB installed) and `ai` as a peer npm installs on its own.
  Declared debt: splitting the client into a light package is a separate slice.
- **`contexto` leaves the README**: the prop is still accepted for type compatibility but doesn't
  reach the report. It was already like that in 0.1.0 and the README promised it anyway.
- **The CSP enters the README** (`connect-src`), and «cap per day» becomes «rolling 24 h window».
- At the time of 1.0.0 the backend kept serving `POST /api/chat` for 0.1.0 installs (1.0.0 no longer
  used it: the transport moved to Eve). **That coexistence ended on 2026-10-29**: the route was
  retired (see the 2.3.0 compatibility notes). `GET /api/chat/estado` is different: the widget polls
  it when mounting, and the engine also uses it to «test the installation», so it stays.

## 0.1.0 — 2026-08-19

First release: AI SDK `useChat` transport, status probe, no configurable styles.
