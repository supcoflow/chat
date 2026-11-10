# A support chat in React, with no styles

`SupportChat.tsx` is a whole chat interface in one file, built on `useSupportChat` (`@supcoflow/chat/react`) and the helpers of `@supcoflow/chat/core`. It has **no CSS and no UI library**: bare
HTML elements. It is a skeleton, not a design — the chat has to look like **your** app, so swap every `<button>`, `<textarea>`, `<section>` and `<details>` for your own components, icons and tokens, and put
the trigger (here a «Help» button) wherever your app wants it: a header button, a menu item, a page, a side sheet.

What it does, and what to keep when you rewrite it. The `P…` comments in the code are the points of the [presentation contract](../../docs/presentation-contract.md); the rules live in the core, what is
here is what has to be **shown**:

| | |
|---|---|
| P1 | nothing at all unless the chat is available for this origin |
| P2 | says it is an automated assistant, before the first message |
| P3–P5 | the person's message shows at once; the assistant's text is the safe subset (`parseAssistantText`), never HTML; a «working» indicator |
| P6 | the exact report (title and body, plain text), the two actions with the server's own words, pressed by a person on **that** confirmation, disabled while a turn is in flight |
| P7–P9 | questions with options, the report number after a report, a text of your own per error code, «new conversation» |
| P10 | attachments only when the data agreement (`state.allows`) lets them be taken, and not after the report |
| P13–P15 | focus, a `log` region, «loading» instead of an empty chat while a saved conversation comes back, long pastes collapsed |

Not in the skeleton, because they are optional: the visible steps of the assistant (`message.steps`), a start screen, and the list of past conversations (P16, not served yet).

`useSupportChat` creates the chat when the component mounts and destroys it when it unmounts, so it is safe in React's `StrictMode` (which mounts, unmounts and mounts again in development) and in Next.js
(the chat is created in the browser, never while rendering on the server: put `"use client"` at the top of the file that uses it). Changing `tenantId`, `projectId` or `backendUrl` makes another chat;
the other options are read when the chat is created, so give the component a `key` if they change.

Run it:

```bash
npx esbuild main.tsx --bundle --format=esm --jsx=automatic --outfile=main.js   # from this folder, with @supcoflow/chat, react and react-dom installed
npx serve .                                                                     # then open /index.html?tenant=tnt_xxx&project=proj_xxx
```

Your site's origin has to be in the project's list of allowed origins (the same as for the widget), or the chat will not be available.
