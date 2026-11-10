# `@supcoflow/chat/react` — the chat in React, with no design

One hook. It turns [`@supcoflow/chat/core`](./core.md) into the state and the methods a React component needs, and nothing else: **no components, no CSS, no icons**. The chat is drawn by you (or by the coding agent working on your repo) with your app's own components, as [the presentation contract](./presentation-contract.md) asks. A complete unstyled example is in [`examples/react`](../examples/react/README.md).

```bash
npm install @supcoflow/chat react
```

```tsx
"use client"; // Next.js: the chat lives in the browser

import { useSupportChat } from "@supcoflow/chat/react";

export function Help() {
  const { chat, state, available, ready } = useSupportChat({ tenantId: "tnt_xxx", projectId: "proj_xxx", locale: "es" });
  if (!available || chat === null) return null; // P1: not active for this origin → draw nothing
  // …draw `state` with your components; call `chat.send`, `chat.confirmReport(id)`… from your buttons.
}
```

`useSupportChat(options)` takes the [options of the core](./core.md#options) (`tenantId`, `projectId`, `backendUrl`, `user`, `appVersion`, `autoContext`, `storage`, `resume`, `locale`, `capabilities`, `fetch`) plus one more, and returns:

| | |
|---|---|
| `chat` | The core's `SupportChat` (`send`, `answer`, `confirmReport`, `reviseReport`, `retry`, `newConversation`, `attachImage`, …). `null` on the server and in the first render: it is created when the component mounts |
| `state` | The latest `ChatState` of the core, to draw. An empty state while there is no `chat` (`EMPTY_CHAT_STATE`, exported) |
| `availability` | The answer of `checkAvailability()` (`{ available, status, reason, allows }`), or `null` until it arrives. Asked once per chat |
| `available` | `availability?.available === true`. Until it is `true`, draw nothing (P1) |
| `ready` | The saved conversation, if there was one, has been rewound from the server (`chat.ready`). Until then show «loading», not an empty chat (P14). `false` while there is no `chat` |
| `onAvailability` (option) | Called once with the answer of the check: the way to learn **why** the chat does not appear (`origen_no_admitido`, `tope_de_mensajes`…). On `localhost` the reason is also logged to the console |

## When the chat is created and destroyed

- **Not while rendering.** Creating the core reads `sessionStorage` and starts rewinding a saved conversation, and a render can happen on the server, twice or be thrown away. The chat is created in an effect, so on the server (Next.js) and in the first render there is no `chat`, no request and the state is empty.
- **Destroyed on unmount.** `chat.destroy()` cuts whatever is in flight (a turn, a rewind, an upload, an open element picker). Closing your panel does **not** unmount the hook if the component that calls it stays mounted: the conversation is still there when the person opens it again. Call the hook in a component that lives as long as the chat should.
- **Safe in `StrictMode`.** React mounts, unmounts and mounts again in development: the first chat is destroyed (its turn and its rewind are aborted; its availability check is only ignored, and neither counts against the cap) and only the second one is drawn. In development you will see two `GET /api/chat/estado` for that reason. One message goes out once; `onAvailability` is called once.
- **Which chat it is.** `tenantId`, `projectId` and `backendUrl` decide it: changing one destroys the chat and creates another (with its own state and its own check); the render right after the change already shows no chat, never the previous project's. The rest of the options (`user`, `appVersion`, `storage`, `locale`…) are read when the chat is created; to change them, remount the component with a `key`.
- **One per project and tab** (P12). If another part of your page also calls `createSupportChat` for the same project, they share the saved conversation record: keep one.

## What it deliberately does not do

It does not decide when the chat opens, where, or how it looks; it does not translate texts (you write the ones of your interface; the server writes the report confirmation's words in the `locale` you declare); and it does not add the rules of the chat to your code — `confirmReport(id)` only answers the confirmation the server asked, whatever your component does. To check the interface you build against the presentation contract, copy the [conformance checks](./conformance.md). Import the core (`@supcoflow/chat/core`) for `parseAssistantText`, `isLongPaste` and the types: the hook uses that same copy.
