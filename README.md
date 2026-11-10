# @supcoflow/chat

> ## ⚠️ Read this first: the quick start below is a demo with prepared answers, no AI
>
> The local try-out in this README runs a small server **on your machine** that replays conversations we wrote by hand. It does **not** use AI, it does **not** read your product, it **cannot** answer new questions (whatever you type, it follows the same script) and it does **not** create any GitHub issue. No account, no API key, no cost.
> The real assistant is Supcoflow's hosted service; see [Going live](#going-live-more-than-changing-a-url).

## Try the local demo

There is no hidden telemetry. In this demo the chat talks only to the demo server you start in step 2: nothing goes to Supcoflow's service or to GitHub. In production, the chat sends the messages and the data you allow to the backend you configure.

1. Install it (Next.js with the App Router, React 18 or newer):

   ```bash
   npm i @supcoflow/chat@2.4.0
   ```

2. Start the demo server and leave it running:

   ```bash
   npx supcoflow-chat-fake report-confirmed
   ```

   It prints `http://127.0.0.1:4010`.

3. Add the chat as a client component, `app/support-chat.tsx`:

   ```tsx
   "use client";
   import { ChatDeIntake } from "@supcoflow/chat";

   export function SupportChat() {
     return <ChatDeIntake tenantId="tnt_demo" projectId="proj_demo" backendUrl="http://127.0.0.1:4010" />;
   }
   ```

   Then render `<SupportChat />` in `app/layout.tsx`. (If your app sets a Content-Security-Policy, allow `http://127.0.0.1:4010` in `connect-src` while you try it.)

4. Run `npm run dev`, open your app, click the bubble and type any message: the prepared assistant asks which page you are on. Type anything again and you'll see a prepared bug report with its confirmation. Confirming only advances the local demo: no report is sent to Supcoflow or to GitHub.

More scenarios: `npx supcoflow-chat-fake --list`. Switch while it runs: `curl -X POST http://127.0.0.1:4010/__fake/scenario -d '{"name":"daily-cap-on-open"}'`.
Building your own chat UI instead of the widget: see [`docs/core.md`](./docs/core.md), [`docs/testing.md`](./docs/testing.md) and the [`conformance/`](./conformance/) checks.

### What the demo can't tell you

How the real assistant answers, whether its reports are useful, or what it costs. For that you need the hosted service.

### Going live (more than changing a URL)

The real assistant runs on Supcoflow's hosted service. To put it in front of your users you need: a Supcoflow account (sign in with GitHub), the Supcoflow GitHub App on your repo (personal repos today; for an organization, write to us), a product guide in your repo (`.supcoflow/guide.md`), the sites allowed to show the chat, and **your own Vercel AI Gateway account with credits**: your AI usage is billed to you directly.

## License and name

The code in this repository is MIT (see [`LICENSE`](./LICENSE); third-party notices in [`LICENSES/`](./LICENSES/)). The name "Supcoflow" and its logo are not part of that license.
To report a vulnerability, read [`SECURITY.md`](./SECURITY.md). To contribute, read [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

Supcoflow's support chat, embeddable in any site. Your users talk to an assistant that answers
usage questions from your product's guide and, when there's a real bug, files a report in
Supcoflow.

The widget's own text (buttons, placeholders, notices) is always in English. The assistant replies
in the language the user writes in.

## Install

### With npm (React, Vue, Svelte, vanilla)

```bash
npm i @supcoflow/chat
```

In React:

```tsx
import { ChatDeIntake } from "@supcoflow/chat";

<ChatDeIntake tenantId="tnt_xxx" projectId="proj_xxx" />
```

Without React:

```ts
import { montarChat } from "@supcoflow/chat";

const chat = montarChat(document.body, { tenantId: "tnt_xxx", projectId: "proj_xxx" });
// chat.desmontar() when you need to remove it
```

### With one `<script>` line (WordPress, Webflow, plain HTML)

```html
<script src="https://chat.supcoflow.dev/widget.js" data-tenant="tnt_xxx" data-project="proj_xxx" defer></script>
```

Attribute options: `data-backend`, `data-posicion` (`derecha`|`izquierda`), `data-abierto="true"`,
`data-titulo`, `data-saludo`, `data-acento` (a color), `data-version-app`,
`data-contexto-automatico="false"`, `data-usuario-id`, `data-usuario-rol`, `data-usuario-nombre`.
`window.SupcoflowChat.montar(options)` / `.desmontar()` are also available.

The ids **are public** (like a DSN). What contains them is the project's list of allowed origins
plus the message cap, both on Supcoflow's side.

## Build your own chat UI (no widget)

If you want your own messages, buttons and panel, use the core: Supcoflow stays the brain and the infrastructure, you draw the interface. It has no React, Preact or CSS in it.

```ts
import { createSupportChat } from "@supcoflow/chat/core";

const chat = createSupportChat({ tenantId: "tnt_xxx", projectId: "proj_xxx" });
chat.subscribe((state) => render(state)); // messages, the pending question, busy, error, attachments…
await chat.send("The save button does nothing");
```

It handles streaming text, the steps the assistant took, **the report confirmation** (the assistant cannot file a report without the user's "yes"; your UI shows the question as it arrives),
reconnection after a reload, attachments and errors. Read [`docs/core.md`](./docs/core.md) for the contract, [`docs/protocol-v1.md`](./docs/protocol-v1.md) for the wire protocol, and
[`examples/custom-ui`](./examples/custom-ui/) for a complete interface in under a hundred lines. In React there is a hook, `useSupportChat` from `@supcoflow/chat/react` ([`docs/react.md`](./docs/react.md)), and an unstyled example with no UI library in [`examples/react`](./examples/react/): you build the chat with your app's own components. As with any "build it yourself" API, it takes more code and maintenance on your side than the widget.

To check that interface without spending anything, `@supcoflow/chat/testing` is a fake backend that plays prepared conversations (the report confirmation, a reload, the daily cap, an attachment that fails…) and records what your interface asked and when; `npx supcoflow-chat-fake` runs the same thing as a local server so you can see each state in your app. See [`docs/testing.md`](./docs/testing.md). The [presentation contract](./docs/presentation-contract.md) also comes as tests you copy into your app: `conformance/` runs one check per point (no browser, no design, only the requests your interface makes, the text it shows and the roles of its controls) — see [`docs/conformance.md`](./docs/conformance.md).

## Options

The option names are the package's API and stay as they are (in Spanish).

| option | default | what |
|---|---|---|
| `backendUrl` | `https://chat.supcoflow.dev` | the chat backend |
| `modo` | `"burbuja"` | `"burbuja"` (floating button + panel) or `"inline"` (the panel wherever you mount it) |
| `posicion` | `"derecha"` | which side the bubble sits on (`"derecha"` = right, `"izquierda"` = left) |
| `abierto` | `false` | the panel starts open |
| `titulo` | `"Help"` | the panel header |
| `saludo` | — | the second line of the start screen; wins over the console |
| `tema` | neutral | `{ acento, fondo, texto, textoSuave, radio, fuente }`, any subset |
| `contexto` | `{}` | `{ versionApp }` — sent with every message and kept in the report; the assistant does not read it |
| `contextoAutomatico` | `true` | sends the page URL (without query or hash) and the browser with every message. The assistant reads only the page (in a note of each turn); the browser goes to the report. Nothing the project's data agreement doesn't allow is sent. Console errors: never |
| `onDiagnostico` | — | `({ visible, status, motivo }) => void`, see below |
| `usuario` | — | `{ id, rol, atributos, nombre }` — who the user is according to your app, for diagnosis; `nombre` is only for the greeting and never leaves the browser. See below |
| `previewToken` / `onEvento` | — | **internal**: Supcoflow's console uses them for the preview; they do nothing useful on your site |

## Who the user is

```tsx
<ChatDeIntake tenantId="tnt_xxx" projectId="proj_xxx" usuario={{ id: "u_123", rol: "admin", atributos: { plan: "pro" } }} />
```

All optional. `id` (up to 100 characters), `rol` (60) and up to 8 `atributos` (keys up to 39
characters, values up to 200) travel with every message and, if a report is filed, go to the report: the
role is the cheapest diagnostic there is (half of «I don't see the button» are permissions). Since 2.4.0
the assistant does **not** read them in the chat: they are for the report. It is **declared, not
verified**: it grants nothing, it's context. Anything too long is
trimmed; anything other than `id`, `rol` or `atributos` is dropped. An attribute named `id`, `rol`
or `nombre` is not sent (the browser console says so).

`nombre` (up to 80) shows in «Hi {nombre} 👋» on the start screen and **never** reaches the
assistant or the report.

## The start screen

- Before the first message, the panel opens with «Hi {nombre} 👋» (or «Hi 👋» without `usuario.nombre`).
- Below it, two starters: «Report a bug» and «I have a usage question».
- The greeting comes from `saludo` (or the console, if the code doesn't set it), and each starter is
  sent as if the user had typed it: the first message of the conversation.

## What the chat shows on its own

These are drawn by the widget, not written by the assistant, so they don't depend on the prompt:

- «Reading the support guide…» while the assistant looks up your guide, and «Thinking…» the rest of the time it works before writing (instead of the typing dots).
- A short line above an answer for each real step: «Read the guide · <section>», «Summarized the report», «Noted your question». They appear only when the step actually happened.
- After a report is filed: «Report sent.», «Report rep_…» (the id the team can open in Supcoflow's
  console), «Nothing written here from now on is added to it.» (the report is closed, so attaching
  more is no longer offered), and a «New conversation» button (reloading the page would resume the
  same session). The card promises nothing about what the team will do.
- After a usage question is answered: «Answered · no issue».

They need a chat backend that sends them; with an older backend the widget simply doesn't show them.

## Branding from the console

The chat's logo, title and colors are edited at `/proyectos/<slug>/sdk` in Supcoflow and the widget
applies them on its own, before the first paint. Whatever you pass in code (`titulo`, `tema`) wins
over what's saved in the console, field by field.

## When something fails

**On load**, if the project's chat is off, the cap is used up, the site's origin isn't allowed or
the backend doesn't answer, the widget **doesn't render**: the person on the other side is an end
user of the product, and has nothing to do with «the project hit its cap». To find out why it doesn't
show up, pass `onDiagnostico` or look at the browser console on `localhost`:

| `status` | `motivo` | what to do |
|---|---|---|
| 403 | `chat_deshabilitado` | turn the chat on at `/proyectos/<slug>/sdk` |
| 403 | `origen_no_admitido` | add the site's origin on that same screen |
| 404 | `proyecto_desconocido` | check `tenantId` / `projectId` |
| 429 | `tope_de_mensajes` | wait: the cap reopens on its own |
| 502 | `motor_inalcanzable` | it's on Supcoflow's side |
| 0 | `sin_respuesta` | network, CSP or a mistyped `backendUrl` |

**Mid-conversation**, an error shows under the last message with a retry button, and what the user
typed is kept. The text is the widget's own, chosen by the error code (never the backend's message).
`onDiagnostico` gets it too, with the error code in `motivo`.

## What the widget does and doesn't do

- The conversation survives a reload **of the same tab**.
- The assistant writes with formatting (bold, lists, code, and links to your own site; a link to any
  other site is shown as plain text) and asks to confirm the report with buttons.
- The browser only talks to the chat backend, in a small format of its own; the agent runtime stays
  on the server.
- It doesn't follow up with whoever reported. On purpose.
- It doesn't collect console errors or anything not in the options table.
- Pointing, capturing and attaching are the user's actions: the widget captures nothing on its own.

## Pointing and attaching

The end user can **pick the element** of your page that isn't working, **take a screenshot** and
**attach an image**. That goes to the report (and to the agent that fixes it), never to the chat's
model, which only gets a short description (which element, on which page, how many screenshots).

The project's data agreement in Supcoflow decides what the chat may take, what is saved with a report
and what the agent that triages it reads. When it does not allow screenshots or pointing at an element,
the widget hides «Pick an element», «Take a screenshot», «Attach an image» and «Capture this element»,
and `@supcoflow/chat/core` refuses them (`"not_allowed"`, nothing is attached); when it does not allow
the page and browser, they are not sent. That is a courtesy of the client: the backend filters what the
assistant sees and what is stored whatever a client sends, and a project with no agreement set allows
everything. What the person **types** is not filtered (there is no way to know which words are
personal data), so tell your users not to write them in the chat.

What picking an element collects, and what it doesn't:

- Yes: the tag, a CSS selector, the DOM path, the visible text, the attributes `id class name type
  role href src alt title placeholder for action method` and `aria-*`, sixteen style properties,
  the text of nearby elements, and the element's HTML capped at 4 KB.
- No: **the value of any `input`, `textarea` or `select`**, any `<script>`, any URL query or hash;
  and any attribute or class that looks like a secret (`access_token`, `csrf`, `password`…) is
  replaced with `[redacted]`.

The user takes the screenshot with the browser's dialog (`getDisplayMedia`) and sees it as a
thumbnail before it uploads; they can remove it. Some browsers and iOS don't support
`getDisplayMedia`: there only «Attach an image» remains, which works everywhere. Images are
re-encoded (WebP or PNG, up to 1.5 MB) and keep no metadata from the original file. Up to **4
attachments per conversation**.

Whoever picks sees a highlight over your page: it's our own full-screen overlay, removed when they
pick or press Esc. The selector code comes from [Orca](https://github.com/stablyai/orca) (MIT),
ported to TypeScript; the license is in `LICENSES/orca.txt`.

## If your site has a CSP

`connect-src` has to allow the `backendUrl` (by default `https://chat.supcoflow.dev`). The widget
loads no third-party fonts or scripts. Screenshot thumbnails are `data:` URLs made in the browser:
if your `img-src` doesn't allow `data:`, the thumbnails don't show (the upload works anyway).

## Size and requirements

One file per output, no dependencies to install. React is optional (only for `ChatDeIntake`). No
webfonts. Works in browsers with ES2022 and Shadow DOM.

## Licenses

MIT. See `LICENSES/` for the third-party code included.
