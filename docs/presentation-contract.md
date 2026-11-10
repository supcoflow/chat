# Supcoflow presentation contract — v1.1.0

Supcoflow gives you the engine of a support chat — the assistant, the guide, the reports, the limits, and `@supcoflow/chat/core` to talk to them — and **no design**. The chat looks like your app: it is built with your components, your icons and your styles, by you or by the coding agent working on your repo. Where it opens, and how, is yours to decide.

This contract says **what has to be shown**, never how it looks. It exists because a few guarantees of the chat live in the interface: the person must know they are talking to an assistant, must see exactly what is sent before it is sent, and must not be led to a link the assistant was talked into writing. Everything else is free.

`contract.json`, next to `package.json`, is this document in machine-readable form (`@supcoflow/chat/contract.json`). The two are checked against each other, and against the types of the core, by a test: they cannot drift apart. Its `version` is the one in the title.

## Levels

- **required** — Without it the guarantees of the chat do not hold. Every interface does it, whatever it looks like.
- **default_on** — Build it unless the developer says not to.
- **optional** — Build it only if the developer asks for it.

Each point has an id (`P1`…) and a capability has a name; they are what tools and reviews refer to. **Must** is what the interface does; **Free** is what the contract leaves to you. Names like `state.busy` or `confirmReport()` are those of [`@supcoflow/chat/core`](./core.md); the contract does not depend on a framework.

## Points that every interface follows

### P1 — Availability

**Level:** required

**Must**
- Call `checkAvailability()` before offering the chat.
- Do not offer the chat, or show it disabled, while `available` is `false`.

**Free**
- The whole trigger: a bubble, a header button, a menu item, a keyboard shortcut, a help page, a fixed panel.
- What a disabled chat looks like.

`checkAvailability()` does not count against the daily cap, so call it as often as you need. The reasons it can give are listed in [`core.md`](./core.md#methods).

### P2 — Automated assistant

**Level:** required

**Must**
- Say that the person is talking to an automated assistant, in a place that is visible whenever the chat is open, including before the first message.

**Free**
- Where it goes and the words and language it uses.

This is the one piece of text the contract asks you to write. The chat is run by a model, and the person has the right to know.

### P3 — What the person writes

**Level:** required

**Must**
- Show a user message as soon as it is sent (`pending: true`), and keep it in the list if the turn fails: what the person typed is never lost.

**Free**
- Bubbles or not, alignment, how a pending message looks.

The core already shows the message right away and keeps it; your job is not to undo that. After a refusal in the middle of a conversation (the daily cap), `retry()` resends the same message and it shows once; when the very first request fails, on a retry the same message can appear twice (see *Known limits* in [`core.md`](./core.md#known-limits)).

### P4 — The assistant's text

**Level:** required

**Must**
- Show the complete text of every assistant message, in order and unedited: nothing summarized, cut or rewritten.
- Draw it as plain text or with the safe subset: paragraphs, lists, bold, italic, inline code, code blocks, and links only to your own site's origin.
- If your Markdown library turns bare URLs or e-mail addresses into links (for example `remark-gfm`), draw a link only when its `href` has your origin, and its text otherwise.
- Never insert assistant text as HTML: no `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, and no raw-HTML option of a Markdown library.
- Never draw an image that comes from assistant text, and never turn a bare URL into a link.

**Free**
- Typography.
- How the streaming looks.

The text is Markdown-flavored. This subset is exactly what the official widget draws, and what `parseAssistantText(text, origin)` of `@supcoflow/chat/core` parses (see [`core.md`](./core.md#drawing-the-assistants-text)). Any other construct is text, not markup. The server already breaks the syntax of a link to another site, of an image and of an HTML tag in the text it sends, but the address of a removed link stays written as text, and a Markdown library that turns bare URLs into links (`remark-gfm` does) would make it a link again: the server cannot know what library your app uses, so the rule is on your side too.

### P5 — Working indicator

**Level:** required

**Must**
- Show that the assistant is working while `busy` is `true` and the answer has no text yet.

**Free**
- A spinner, a shine, a skeleton, three dots.
- Whether the indicator says more than "working" (see `reading_guide`).

Between sending a message and the first word it is normal to wait 4 to 8 seconds when the assistant looks something up. Without an indicator the chat looks frozen.

### P6 — Report confirmation

**Level:** required

**Must**
- Show everything that will be sent, complete: `pendingQuestion.report` (title and body) when it is there, otherwise `pendingQuestion.prompt`, which has all of it and is also the last assistant message. Do not cut, summarize or edit it.
- Offer two clear actions with it: send the report, and fix something first. Use `options[].label` exactly as it arrives for their words.
- Draw the text of the report as plain text, character by character and keeping its line breaks, never as Markdown or HTML, wherever it appears, including its copy as the last assistant message of `messages` (the one with `reportCopy: true`): what the person reads has to be what is sent.
- Declare the language of your app in the `locale` option, so that the two labels and the frame around the report come in it.
- Call `confirmReport(id)` only from a gesture of the person on that confirmation: never automatically, never on a timer, never from typed text.
- Pass the `id` of the confirmation the pressed button belongs to, never "whatever is pending now".
- Disable both actions while `busy` is `true`.
- Say which attachments go with the report: those with `status: "uploaded"` do, those still uploading or failed do not.
- When the error `confirmacion_no_vigente` arrives, say that the report was not sent.

**Free**
- A card, a modal or inline in the conversation.
- Icons, spacing and the look of the two actions.
- How the attachments are mentioned.

This is the rule that makes "the assistant cannot report on its own" true for the person: they saw the exact text before it was sent. The server only sends the report when it receives `approve` for the **current** confirmation, from the project that opened the conversation, and only if the person wrote nothing after the question (see [`core.md`](./core.md#the-report-confirmation)). `pendingQuestion.report` carries the title and the body of the report apart from each other, exactly as they will be sent (an older backend does not send it: then `prompt` has everything, with a frame). The labels of the two options and the frame are fixed by Supcoflow, not by the model or by your interface, in the language you declare in `locale`: Spanish, English or Portuguese, and English for any other. Draw the two texts of `report` as plain text, since the assistant wrote them and what the person reads has to be what is sent. The same text also arrives as the last assistant message of `messages` (the core adds it there and marks it with `reportCopy: true`, also after the person answered and after a reload): draw it as plain text too, or show only one of the two.

### P7 — Questions from the assistant

**Level:** required

**Must**
- Show the options of a `question` and, when `allowsText` is `true`, a field for free text.
- Answer with `answer(id, …)` using the `id` of the question that was drawn.

**Free**
- Chips, buttons, a list.

Today the assistant asks its questions in the text and the person answers by typing, so you will rarely see one. A question with options is part of the protocol, though, and a later version may use it: handle it.

### P8 — After a report

**Level:** required

**Must**
- When an outcome of kind `reported` arrives, say that the report was sent and show `reportId` when it is not `null`.
- Stop offering attachments once `reported` is `true`.
- Offer a way to start another conversation, which calls `newConversation()`.
- Promise nothing the chat does not know, such as who will read the report or when.

**Free**
- A card, a toast, a button to copy the number.
- The words.

The report is closed once it is sent: nothing written afterwards is added to it, and attachments added afterwards belong to no report.

### P9 — Errors

**Level:** required

**Must**
- Write your own text for each error `code` you handle, and never show `error.message` to the person.
- Show a generic failure for a code you do not know.
- Offer `retry()` for a non-terminal error, and another conversation for a terminal one.
- For `tope_de_mensajes` say that the chat is not available for now, and for `limite_de_sesion` that the conversation reached its limit and another can be started.
- Never offer a button that asks for more messages or more budget.

**Free**
- The words and the shape of the error.

The list of codes is in [`protocol-v1.md`](./protocol-v1.md#error-codes). It is not closed, hence the generic failure. `error.message` comes from servers and libraries and may be in any language. Errors never offer "more budget": the server turns that request into a terminal error on purpose.

### P10 — Attachments

**Level:** required
**Applies when:** your interface offers attachments of any kind

**Must**
- Show the status of each attachment: uploading, uploaded or failed.
- Offer to remove only an attachment that is not uploaded yet: one that already uploaded goes with the report even if it leaves the list.
- Offer to retry a failed attachment only when `retryable` is `true`.
- Do not offer attachments once `reported` is `true`, or when `canAttachMore` is `false`.
- When capturing the screen, hide your own interface in `hideUi` and show it again in `showUi`; when pointing at an element, pass your interface root as `ignore`.

**Free**
- Which attachments are offered, the icons and the thumbnails.

An attachment that already uploaded is linked to the report when the report is created, even if it is taken off the list: there is no way to withdraw it. That is why it has no "remove".

### P11 — Privacy

**Level:** required

**Must**
- Never send the name of the person: not in `user`, not in `user.attributes`, not in `appVersion`.
- Declare in `user` only the fields the developer chose to share.
- Never log, parse or build the saved conversation record (`storage`): it holds a credential.

**Free**
- Whether to declare a user at all.

The core has no field for the name: it never leaves the browser. The conversation record in `storage` contains the session credential.

### P12 — One chat

**Level:** required

**Must**
- Have a single chat per project in a tab, and call `destroy()` when the interface that created it goes away.

**Free**
- Where the chat is created and which part of the app owns it.

The official widget and the core keep the same record under the same key; do not run both for one project on the same page.

### P13 — Accessibility

**Level:** required

**Must**
- The chat can be opened, used and closed with the keyboard.
- Focus goes to the message field when the chat opens.
- A screen reader announces the new assistant messages.

**Free**
- How: the app's own components, ARIA live regions, focus handling.

Nothing here depends on the core: it is how your interface is built. Reuse the components of your app that already do this.

### P14 — Conversation history

**Level:** required

**Must**
- Keep the conversation recoverable: leave `resume` at `true` and do not set `storage` to `"none"`.
- When the person comes back, show the conversation again, including a confirmation that was still pending.
- Wait for `ready` before showing an empty conversation, so that the person never sees an empty chat that then fills in.
- Start another conversation only when the person asks for it, never automatically when the page loads.

**Free**
- Where and how the recovered conversation is drawn.
- Your own `storage` (for example one that survives closing the tab).

The conversation belongs to the server, not to the browser: the browser keeps only a cursor, and `ready` resolves when the conversation has been rewound from it. The default `storage` is the tab's `sessionStorage`, which survives a reload but not a new tab; the session id expires after 24 hours either way.

### P15 — Pasted text

**Level:** required

**Must**
- Show a text the person pastes that is longer than `isLongPaste()` says collapsed, as a short marker such as «[pasted text]» instead of the whole text, both while they write and once it is sent.
- Let the person expand the collapsed text to read it whole, before sending it and after, and collapse it again.
- Send the pasted text whole: collapsing changes only how it is drawn, never what is sent.
- If a pasted text does not fit in a message (`MESSAGE_MAX_LENGTH`), tell the person how much of it was kept; never cut it silently.
- Collapse a user message of the conversation that is longer than `isLongPaste()` says, even after a reload: by then pasted text cannot be told from typed text.
- Never collapse an assistant message or the report confirmation (`pendingQuestion.report` and its copy in `messages`, see P6): only what the person wrote.

**Free**
- The words and the look of the marker, and how it tells the size.
- Where the expanded text appears.

The limit is the one of the core: `isLongPaste(text)` is `true` for more than 1,000 characters or more than 10 lines (`PASTE_LIMITS`), and `pasteSize(text)` gives the numbers for a marker like «[pasted text] · 30 lines · 1,234 characters». Both are in [`core.md`](./core.md#long-pasted-text). A message holds at most `MESSAGE_MAX_LENGTH` (4,000) characters: a longer paste is cut where the message ends, and the person has to be told, because the marker does not show it. The core keeps the full text in `messages`; only the drawing collapses it.

### P16 — Past conversations

**Level:** required
**Applies when:** the server supports it, which it does not yet

**Must**
- Offer the person a list of their previous conversations, with what they asked, sent and reported in each.
- Let the person open one of them and read it.
- Show the list only to the person it belongs to, as identified by the verified identity the server requires; a declared `user.id` alone is not enough.

**Free**
- Where the list lives: a menu, a drawer, a page.
- How each conversation is summarized.

**What it needs, and what exists today.** Every chat will keep a history per person: their consultations, and what they sent, asked and reported in each. For that the server must know **who the person is** — a stable and verified identity — and keep and serve their conversations. Neither exists yet: `user.id` is declared by your app and is **not verified** (it grants nothing, see P11), and the server keeps a conversation only for the browser tab that holds its cursor. So no interface can offer this today, and this point does not apply until the server says it supports it; when it does, it arrives with a new major version of this contract (a new required point is a new requirement for every interface) and the core API to list and open conversations. What applies today is P14: the conversation in progress comes back.

## Capabilities

A capability is something the chat can offer besides text. The ones **on by default** are built unless the developer says not to; the **optional** ones, only if asked. None of them changes a required point.

### attach_image — Attach an image

**Level:** default_on

**Must**
- Let the person attach an image file with `attachImage(file)` while `canAttachMore` is `true`.
- Handle every result of `attachImage`, since a refused image is not an error of the chat.
- Declare it in the `capabilities` option (`attachImage: true`) when you offer it, so the assistant invites the person to attach an image only when your interface can take one.

**Free**
- The control, its icon and the thumbnails.

The image is re-encoded in the browser, which also drops its EXIF and location.

### screenshot — Capture the screen

**Level:** default_on

**Must**
- Offer the capture only when `canCaptureScreen()` is `true`.
- Capture with `attachScreenshot`, as P10 says for your interface.
- Declare it in the `capabilities` option (`screenshot: true`) when you offer it; the core only sends it while `canCaptureScreen()` is `true`.

**Free**
- The control and its icon.

The browser asks the person for permission to share the screen; a refusal comes back as `no_capture`.

### pick_element — Point at an element

**Level:** default_on

**Must**
- Let the person point at an element of the page with `pickElement`, passing your interface root as `ignore`.
- Declare it in the `capabilities` option (`pickElement: true`) when you offer it.

**Free**
- The control and its icon.

The core draws a temporary frame around the element under the pointer while the person chooses; that frame is not configurable yet.

### reading_guide — Reading the guide

**Level:** default_on

**Must**
- While `activity` is `reading_guide`, say that the assistant is reading the product guide.

**Free**
- The words, and whether it is a different indicator or the same one.

It lasts until the next text arrives.

### visible_steps — Visible steps

**Level:** optional

**Must**
- Draw each entry of `steps` of an assistant message together with its answer, with your own words.

**Free**
- Everything about how a step looks.

`guide_read` (with the section), `report_summarized` and `question_noted`. Each one appears only after the server saw the fact.

### answered_outcome — Answered outcome

**Level:** optional

**Must**
- Draw an outcome of kind `answered` as a small mark that the question was answered, with your own words.

**Free**
- Everything about how it looks.

It carries no text of its own: the words are yours.

### page_context — Page context

**Level:** optional

**Must**
- Leave `autoContext` at `true` to send the page URL (without query or hash) and the browser with every message, or set it to `false` to send neither.

**Free**
- The choice itself.

It is on by default. Console errors are never sent.

### declared_user — Declared user

**Level:** optional

**Must**
- Pass `user` and `appVersion` only when the developer wants the report to carry them, subject to P11.

**Free**
- Which fields.

Declared by your app, not verified: it grants nothing and is context for diagnosing.

### event_hooks — Event hooks

**Level:** optional

**Must**
- Use `onEvent` for side effects only, such as sounds, analytics or scrolling, never to draw the conversation.

**Free**
- What the side effects are.

`onEvent` delivers each stream event in order, before the next state notification.

## What the contract does not ask for

**Not asked**
- A mark, logo or attribution of Supcoflow anywhere in the chat.
- Colors, fonts, spacing, radius, dark mode or animations.
- A component library, an icon library, class names or data attributes.
- A way of opening the chat: bubble, button, menu item, page or panel.
- A language for the texts you write: use your app's own.
- A framework: the contract is the same for React, Vue, Svelte or plain DOM.

## Known limits

- **The assistant learns what your interface offers only from what you declare.** The `capabilities` option (`pickElement`, `screenshot`, `attachImage`, `newConversation`) is sent with every message, and the server tells the assistant, in plain words and never with the name of one of your buttons, what it can offer the person. Declare only what a person can really do in your interface: what you do not declare is never offered, and starting another conversation counts as declared unless you say `false` (P8 asks for it). The server can only take away: a project whose data agreement does not allow screenshots or pointing at an element gets them left out even if you declare them. A client that sends no declaration at all (the widget of version 2.3 and earlier) is assumed to offer the three evidence tools and a new conversation.
- **The server rewrites a few characters, in code too.** To make a link, an image or an HTML tag harmless it replaces one character of its syntax by a look-alike full-width one (`＜`, `］`), also inside code: `<div>` arrives as `＜div>`, and `arr[0](x)` as `arr[0］(x)`. Someone who copies that code copies something that does not run.

## Versioning of the contract

The contract has its own version, the one in the title and in `contract.json`; the package that carries it has another. Inside `1.x` things are only **added**: a new optional capability or a new `default_on` one raises the minor number; a clarification raises the patch number. A new **required** point is a new major version, announced, so an interface that follows `1.x` stays valid for as long as `1.x` is served.
