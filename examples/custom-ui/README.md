# A custom chat UI on `@supcoflow/chat/core`

`ui.ts` is a whole chat interface in under a hundred lines of plain DOM. It imports **only** `@supcoflow/chat/core`; nothing internal. It handles streaming text, the steps the
assistant took, the report confirmation (with the server's own labels), the outcome card, recovering a conversation after a reload, attachments (pick an element, attach an
image) and errors with retry. Read [`../../docs/core.md`](../../docs/core.md) for the contract.

Run it:

```bash
npx esbuild main.ts --bundle --format=esm --outfile=main.js   # from this folder, with @supcoflow/chat installed
npx serve .                                                    # then open /index.html?tenant=tnt_xxx&project=proj_xxx
```

Your site's origin has to be in the project's list of allowed origins (the same as for the widget), or the chat will not be available.
