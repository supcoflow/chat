# Supcoflow chat protocol — v1

This is the wire contract between `chat.supcoflow.dev` and any client: the widget, `@supcoflow/chat/core`, or something you write yourself.
If you use `@supcoflow/chat/core` you do not need to read it (the core speaks it for you and gives you English names, see [`core.md`](./core.md)); it is here so
that nothing between your page and Supcoflow is a secret, and so that the list of events, the fields of each one and which of them are optional cannot change without this file changing too — a test fails otherwise. That is the whole of what the tests
enforce on this file; see [Versioning](#versioning) for what they do not.

**The compatibility rule.** Inside v1 things are only **added**: new events, new optional fields, new `que` values. Nothing is renamed or removed. A client must
**ignore** what it does not know — but treat a **known** event with a missing or mistyped field as not received (the core drops it; a confirmation that arrives incomplete is never shown): an unknown event type, an unknown `que`, an unknown field, a line that is not v1. Following that rule is what keeps an old client
working when the chat gets better. A breaking change would be `v: 2`, announced, and served next to v1 for a stated period.

The protocol keeps its Spanish names (`sesion`, `texto`, `indice`…) so that nothing already installed breaks. The JavaScript API of the core is in English and
translates them.

## Who can talk

- The ids (`tenantId`, `projectId`) are **public**, like a DSN. They contain nothing secret and there is **no secret key in the browser**.
- What contains them is on Supcoflow's side: the project's list of allowed origins (checked against the browser's `Origin` header, on every message) and a daily cap of
  messages.
- This protocol is **for browsers**. A request with no `Origin` is accepted today, but without the allowed-origins protection; do not build a server on it.
  (There is a different, planned product for agents that run on a server.)

## Requests

Base URL: `https://chat.supcoflow.dev`. The session routes and `/api/evidencias` carry these headers (`GET /api/chat/estado` carries only the ids in its query string, and the preview token when there is one):

| header | value |
|---|---|
| `x-supcoflow-tenant` | your tenant id |
| `x-supcoflow-project` | your project id |
| `x-supcoflow-sdk` | optional, informative, on the session routes and `/api/evidencias` (not on `GET /api/chat/estado`, which stays a simple request with no preflight): `core/<version>` or `widget/<version>`, where `<version>` is the package version plus a fingerprint of the build it came from (`2.4.0+ab12cd34`, semver build metadata), so the same label is the same code. It is there so that Supcoflow *can* count how many sites run which version; today the backend only allows the header and decides nothing with it. Send it from your own client as `custom/<version>` if you like |
| `x-supcoflow-locale` | optional, on the three session routes only: the language of your app (`es`, `pt-BR`, `en`…). The server writes the fixed words of the report confirmation in it, from a closed table (`es`, `en`, `pt`); anything else is English. Only the primary language counts (`es-AR` is `es`) |
| `x-supcoflow-capabilities` | optional, on the three session routes only: what your interface really offers besides text, as a comma-separated list of `pickElement`, `screenshot`, `attachImage` and `newConversation` (or `none`). The server tells the assistant, **in plain words and never with the name of one of your buttons**, what it can offer, so it does not invite the person to press something your interface does not have. It is guidance, not a permission: the server can only take away (a project whose data agreement does not allow screenshots or pointing at an element gets them left out even if you list them, and the console preview offers no evidence), and an unknown name is ignored. Without the header, the client is assumed to be the widget of version 2.3 and earlier, which offers all four. Declare it on every request that carries a message |
| `content-type` | `application/json` on POST |

All of them (and `x-supcoflow-preview`, which is internal to Supcoflow's console) are named in the CORS preflight answer.

| route | what | counts against the daily cap |
|---|---|---|
| `GET /api/chat/estado?tenant_id=…&project_id=…` | is the chat active for this origin? Answer: `{ ok, motivo, marca, permite }` (`motivo` is `null` when `ok`; `permite` is `{ capturas, elementos, pagina_y_navegador }`, what the project's data agreement lets the chat take: a missing `permite` means everything, as before) | no |
| `POST /api/chat/sesion` | **open** a conversation with its first message. Body: `{ mensaje, contexto? }`. Answer: NDJSON stream | yes |
| `POST /api/chat/sesion/:id` | **follow**: one more message, or the answer to a question. Body: `{ indice, mensaje, contexto? }` or `{ indice, respuesta: { requestId, optionId?, text? } }`. Answer: NDJSON stream | yes |
| `GET /api/chat/sesion/:id/eventos?desde=n` | **recover**: rewind the conversation from event `n` (use `0` to rebuild the whole thing after a reload). Answer: NDJSON stream | no |
| `POST /api/evidencias` | upload an attachment. See [Attachments](#attachments) | yes |

Limits: `mensaje` is 1–4,000 characters. `contexto` is a map of strings: at most 16 keys, keys up to 48 characters, values up to 600 (up to 1,500 for `evidencia_elemento`, the pointed element's summary). `indice` is the cursor the last
stream gave you (`espera.indice`, or `sesion.indice` before the first border).

The keys the official clients put in `contexto`: `url` (page URL **without** query or hash), `agente_usuario`, `version_app` (every message since 2.4.0; before, only the first); `usr_id`, `usr_rol`,
`usr_attr_<key>` (the user as your app declares it; there is no name key: the user's **name never leaves the browser**; an attribute called `id`, `rol` or `nombre` is not sent); and, every turn, what the
user attached as data: `evidencia_elemento` (the pointed element: tag, text, selector, path, style; no URL), `evidencia_elemento_pagina` (the page it was pointed on) and `evidencia_capturas` (how many screenshots).
The backend builds the sentence the model reads **after** filtering by the project's data agreement, and the model reads it as information, never as instructions. Since 2.4.0 the clients send all of these keys (not only the evidence) with every message, and the backend hands to the model, as a system note of **every** turn, only three things: the page (`url`), the pointed element (`evidencia`) and what the interface declares (`x-supcoflow-capabilities`). The declared user (`usr_*`), the browser and the app version are **not** part of the note (they still go to the report): the assistant can say where the person is and what they pointed at in any answer, not only in the first call of a turn. Clients before 2.3.0 sent `usuario_id`, `usuario_rol`,
`usuario_<key>` and one `evidencia` string instead; the backend still accepts them, more conservatively when an agreement is set. **The backend drops from `contexto` whatever the agreement does not allow before the assistant sees it**,
whatever the client sent.

## The stream

`application/x-ndjson`: one JSON object per line, every line has `"v": 1`. A line that is not a v1 event is skipped.

**Every stream ends with a border**: `espera` (the turn ended, the conversation stays open), `fin` (the conversation ended) or a terminal `error`. If the connection
dies before a border, the client must treat the turn as unfinished: `recover` from the last cursor. A failed HTTP request (a status that is not 2xx) is not a stream: the
body is `{ ok: false, motivo }`, and the official clients turn it into one non-terminal `error` whose `codigo` is that `motivo` (or `http_<status>` if there is none).

### Events

#### `sesion`
`{ "v": 1, "t": "sesion", "id": string, "indice": number }` — the first line of an **open**: the conversation exists. `id` is the session id: **today** it is a bearer
capability (whoever has it can continue the conversation; a later version may require more than the id), so keep it out of logs and URLs you share; the core never shows it to your UI. `indice` is the cursor to
start from. Core event: `session`.

#### `usuario`
`{ "t": "usuario", "texto": string }` — a user turn, confirmed by the server. The client already showed what the user typed; this confirms it (or, when rewinding,
it is history). Core event: `user_message`.

#### `texto`
`{ "t": "texto", "delta": string }` — a fragment of the assistant's answer, as it is written. Core event: `text_delta`.

#### `asistente`
`{ "t": "asistente", "texto": string }` — the assistant's message, complete. It replaces the fragments that came before it (or is the only thing there is, when rewinding).
Core event: `assistant_message`.

**The server breaks the syntax of a link to another site, of an image and of an HTML tag in the text of `texto` and `asistente`**: it rewrites a link to another origin than the request's `Origin` as `label (url)`, and replaces the `<` that could open an HTML tag
or autolink (`＜`) and the `]` that could open a link, an image or a reference definition (`］`) by look-alike full-width characters. A link to the page's own origin is left as written. A bare URL is text, and so is the address of a rewritten link: a library that turns bare URLs into links would link it again, so the client still draws links only to its own origin (the presentation contract, P4). The question of a `pregunta` that is
not the report confirmation gets the same treatment; **the report confirmation is never rewritten**: what you show is what is sent.

#### `pregunta`
`{ "t": "pregunta", "requestId": string, "kind": string, "prompt": string, "opciones": Option[], "libre": boolean, "reporte"?: Report }` where an `Option` is `{ id, label, style }`, all strings, and a `Report` is `{ titulo, cuerpo }`, both strings. For example:
```json
{ "v": 1, "t": "pregunta", "requestId": "…", "kind": "tool-approval", "prompt": "…",
  "opciones": [ { "id": "approve", "label": "…", "style": "primary" }, { "id": "cancel", "label": "…", "style": "default" } ],
  "libre": false }
```
A question for the user. `kind`: `tool-approval` is **the report confirmation** (see below), `question` is a question from the assistant, `session-limit` is turned into the
terminal error `limite_de_sesion` and never shown. `opciones` are the buttons (`style` is `primary`, `default` or `danger`); `libre: true` means free text is also accepted.
Answer it with `POST /api/chat/sesion/:id` and `respuesta: { requestId, optionId }` or `{ requestId, text }`.

For the report confirmation: `prompt` is **everything that will be sent**, uncut (it is capped at 2,000 characters on the server precisely so it can be shown whole), and the
`label`s are fixed by the server. `reporte` (added inside v1; an older backend does not send it, and only the confirmation has it) carries the report apart from the frame `prompt` puts around it: `titulo` and `cuerpo` are exactly what the
assistant's `reportar` call will send. The words the server fixes — the two labels and the frame of `prompt` — come in the language of the `x-supcoflow-locale` header of the request (see [Requests](#requests)): Spanish (`es`), Portuguese (`pt`) or English; any
other language, or none, is English. **Show `prompt` (or `reporte`) and the options as they arrive.** The server only sends the report when it receives `approve` for the **current**
request, from the same tenant and project that opened the session, and only if the user wrote nothing after the question. Typing "yes" does not approve it. Core event:
`question`.

#### `pregunta_resuelta`
`{ "t": "pregunta_resuelta", "requestId": string, "outcome": string, "optionId"?: string, "text"?: string }` — the question was answered. Core event: `question_resolved`.

#### `herramienta`
`{ "t": "herramienta", "nombre": string, "resumen": string, "resultado"?: string }` — a tool call of the agent. **Only sent to Supcoflow's own console preview**; it is never
sent to a site. A client must ignore it and must never draw it on a page of its own: the rule on someone else's site is *text, and nothing more*. The core does not deliver it.

#### `actividad`
`{ "t": "actividad", "que": string }` — what the assistant is doing besides writing; it lasts until the next text. Closed vocabulary (`que`): `leyendo_la_guia`, it is looking something up in the guide. Core event: `activity`
(`reading_guide`).

#### `paso`
`{ "t": "paso", "que": string, "seccion"?: string }` — a step the assistant **took**. It is sent only after the server saw the fact, and carries no arguments, results or reasoning. Closed vocabulary (`que`):

- `guia_leida` — with `seccion`: it read that section of the guide.
- `resumen_preparado` — the report summary is ready and is shown to the user to confirm. It is **not** sent yet (that is a `desenlace`).
- `pregunta_anotada` — a question the guide does not cover was recorded.

Core event: `step`.

#### `desenlace`
`{ "t": "desenlace", "que": string, "reporte"?: string | null }` — how a path ended. Closed vocabulary (`que`):

- `reportado` — the `reporte` field is present: the report was sent. `reporte` is the number (`rep_…`) you can show. It is sent after the server
  confirmed the report, never in a preview, and not for a second confirmation in the same session.
- `respondida` — the consultation was answered.

The text the user reads is yours (or the widget's), not the model's. Core event: `outcome`.

#### `espera`
`{ "t": "espera", "indice": number }` — **border**: the turn ended and the conversation stays open. `indice` is the new cursor. Core event: `turn_end`.

#### `fin`
`{ "t": "fin" }` — **border**: the conversation ended. There is no cursor any more. Core event: `end`.

#### `error`
`{ "t": "error", "codigo": string, "mensaje": string, "terminal": boolean }` — `terminal: true` is a **border** (the conversation is over); `false` does not close the
stream (a non-terminal error is followed by `espera`) and is worth retrying. Decide what to show by `codigo`; `mensaje` comes from servers and libraries, may be in any
language, and is not meant for your users. Core event: `error`.

### Error codes

The list is **not closed**: show a generic failure for a code you do not know.

| `codigo` | meaning | what to do |
|---|---|---|
| `red` | the network failed before or during the request (made up by the client) | retry |
| `tope_de_mensajes` | the project reached its daily message cap | say the chat is unavailable for now |
| `origen_no_admitido` | this site's origin is not in the project's allowed origins | a configuration problem: tell the developer (it is also in `/api/chat/estado`) |
| `chat_deshabilitado` | the chat of this project is off | hide the chat |
| `proyecto_desconocido` | the ids do not belong to any project | a configuration problem |
| `motor_inalcanzable` | Supcoflow's backend could not reach its engine | retry later |
| `sesion_vencida` | the conversation expired | start a new one |
| `limite_de_sesion` | the conversation reached its limit (terminal) | start a new one |
| `confirmacion_no_vigente` | the confirmation was answered when it was no longer the current one (the user wrote something in between) | the report was **not** sent; show the new state |
| `stream_cortado` | the stream ended before reaching the border | retry (it recovers) |
| `stream_fallo`, `traductor_fallo` | an internal failure while streaming | retry |
| `http_<status>` | the server answered with that status and no reason | retry |
| `evidencia_<motivo>` | an attachment upload failed (made up by the core, see below) | per the `motivo` |

## Attachments

Evidence does not go through the conversation: `POST /api/evidencias` with `{ session_id, evidencia }`, where `session_id` is the `id` of the `sesion` event, and `evidencia`
is one of:

- `{ "tipo": "elemento", "contenido": { … } }` — the element the user pointed at on the page (at most 16,000 characters once serialized).
- `{ "tipo": "captura", "imagen": base64, "mime": "image/webp" | "image/png" | "image/jpeg", "ancho": n, "alto": n }` — an image of at most 1,500,000 bytes, base64 **without**
  the `data:` prefix. The core re-encodes every image in the browser, which also drops its EXIF and location.

Answer: `201 { ok: true, evidencia_id }`, or `{ ok: false, motivo }`. The server counts **5** per session of any kind and the first message's `contexto` takes one, so the
official clients allow **4**. The server answers `404 sesion_desconocida` for a moment after a session opens (its copy is written a beat later): the core retries three times
(0.5 s, 1.5 s, 4 s). Anything else below 500 (a `429` cap, a `400`, a `403`) is not retried. The model never sees ids, bytes or HTML: only the short text summary in `contexto.evidencia`.

Evidence is linked to the report **when the report is created**; anything uploaded after the report belongs to no report, so the official clients stop offering attachments
once the report exists.

## Versioning

- The npm package follows semver. The protocol has its own number, the `v` of each line.
- Inside v1, additions only (see the top). What the tests in this repository guarantee, honestly: **(1)** this file lists exactly the event types the code knows, and the first shape line of each
  event names exactly the fields (and which are optional) that the code validates (`src/validar-evento.ts`); **(2)** every event type and every closed-vocabulary `que` has a recorded conversation
  (`src/core/contrato/*.json`) that checks what the core sends, emits and shows; **(3)** every event the backend's real translator produces, for the cases its own tests cover, passes that validation
  (a test in the chat backend's translator). They do **not** compare the *types* of each field with the prose, nor the request bodies: those are described here and enforced
  by the validator and by the recorded conversations, so a change to them still needs this file updated by hand.
