# Checking a chat interface against the contract — `conformance/`

The [presentation contract](./presentation-contract.md) says what an interface built on [`@supcoflow/chat/core`](./core.md) has to show. This is the same contract **as tests**: you copy two files into the tests of your app, adapt one of them, and a test run tells you which points your interface keeps — in CI, with no browser, in a few seconds.

They look at three things and never at the design:

1. **What your interface asked the backend, and when** — for example, that no `approve` went out before the person pressed the button, and that the `approve` that went out carries the id of *that* confirmation.
2. **The text it shows** — the whole report, as plain text; the report number after it was sent. Hidden text (`hidden`, `aria-hidden`) and a collapsed `<details>` do not count as shown.
3. **The accessible roles and names of its controls** — a `button` named like your «send» button, a `textbox` named like your field.

No class names, no `data-*` attributes, no layout, no Tailwind, no component library. Your interface can look like anything.

A **skipped** check is not a pass: when the adapter does not give what a check needs (P10 without `pickElement`; P11 without `personWired`), the report lists it as skipped and says what is missing.

They run on the [fake backend](./testing.md) (`@supcoflow/chat/testing`): it plays prepared conversations, so nothing is spent, nobody waits for a model and production is never touched.

## Use it

You need a test environment with a DOM (happy-dom or jsdom), vitest, and `@testing-library/dom` (`@testing-library/react` brings it). Your app probably has all of that.

1. **Copy** `node_modules/@supcoflow/chat/conformance/checks.ts` and `chat.conformance.template.tsx` into the tests of your app. Rename the template `chat.conformance.test.tsx`. Do not edit `checks.ts`: it is replaced when the contract version changes (`CONTRACT_VERSION`, the same as `contract.json`). It needs vitest: the checks write `expect(value, "why")`, which the `expect` of jest does not accept.
2. **Adapt the template** — three places, marked `ADAPT`:
   - the **component** to mount (yours; the template mounts the unstyled example of the package);
   - your **words**: what your interface calls its controls and what it says, as regular expressions in the language of your app;
   - how to **mount** it: render it the way your app does, with the options you are given (`backendUrl`, `fetch`, `storage`, `locale`, `user`), and say where to look (`root`). `person.name` is the name of the signed-in person of the test: **put it where your app reads who is signed in** (the mock of your auth provider, what `useUser()` returns). The P11 check looks for that name in everything the interface sends; if it never reaches your app, there is nothing to find: set `personWired: true` only once it does, and until then the check is skipped instead of passing.
3. **Run** the test file. Each failure names the point of the contract and says what it expected: `P6 — pressing «send it» answers approve with the id of the confirmation shown, once, and both actions are off while the turn runs`.
4. **Do the manual list** below, and say so — with a screenshot of the running app for what is visual.

A DOM of a test does not load your CSS: for the checks, a chat is **closed** when it is unmounted, `hidden`, `inert` or `aria-hidden` (they press your trigger when the field is not usable). A panel that only a class (`.hidden` of Tailwind) hides looks open to them, and the check that closes it fails.

The test page needs an `http(s)` origin (`http://localhost:3000` is the default of happy-dom and jsdom): the checks use it as «your own site» for links.

### Your words

| word | what it is |
|---|---|
| `trigger`, `close` | the control that opens the chat and the one that closes it. `trigger: null` if the chat is always on screen |
| `messageField`, `send` | the accessible name of the field the person writes in and of its send button |
| `retry`, `newConversation` | the buttons of the same name |
| `automatedAssistant` | the sentence that says it is an automated assistant (P2) |
| `working` | what it shows (text or accessible label) while the assistant works (P5) |
| `reportSent`, `reportNotSent` | what it says after a report was sent, and when the confirmation was out of date (P8, P6) |
| `somethingWrong` | the generic failure for an error code it does not know (P9) |
| `emptyConversation` | the greeting of an empty conversation, if it has one: it must not flash while a saved conversation comes back (P14) |
| `freeText` | the field and button of a free-text answer to a question, when they are not the message field (P7) |
| `pickElement`, `removeAttachment`, `retryAttachment` | the attachment controls, **if your interface offers them** (P10). Leave them out and those checks pass without looking |

## What checks what

`checks.ts` holds the checks; `MANUAL` the points no test can tell. A test ties this table to both and to `contract.json`.

| point | checks | stays manual |
|---|---|---|
| P1 | `P1.asks-before-offering`, `P1.not-offered-when-unavailable` | — |
| P2 | `P2.automated-assistant` | the sentence is in the app's language and easy to see |
| P3 | `P3.what-the-person-writes-stays` | — |
| P4 | `P4.complete-text`, `P4.links-only-to-your-site`, `P4.no-images-from-text`, `P4.never-html` | typography, streaming; your own Markdown library, if you use one |
| P5 | `P5.working-indicator` | — |
| P6 | `P6.shows-everything-as-plain-text`, `P6.older-backend-prompt`, `P6.two-actions-and-no-automatic-yes`, `P6.approve-carries-the-id`, `P6.fix-something`, `P6.not-current-says-not-sent`, `P14.reload-with-a-pending-confirmation` | which attachments go with the report; `locale` is the app's language; that each button sends the id of the confirmation it was drawn for (the check sees that `approve` carries the id of the confirmation shown, not that the code did not read «the pending one») |
| P7 | `P7.options-and-free-text` | — |
| P8 | `P8.after-a-report` | nothing is promised that the chat does not know |
| P9 | `P9.unknown-code`, `P9.terminal-error`, `P9.session-limit-mid-conversation`, `P9.daily-cap`, `P14.expired-conversation` | the words for the daily cap and the conversation limit; that no button asks for more messages or budget (the protocol has no way to ask) |
| P10 | `P10.uploaded-attachment`, `P10.failed-attachment`, `P10.declares-what-it-offers` | `hideUi` / `showUi` while capturing, `ignore` while pointing; each attachment shows its status |
| P11 | `P11.the-name-never-leaves` | the `user` holds only the fields the developer chose to share; nothing touches the saved record |
| P12 | `P12.one-chat` (a turn in flight is cut when the interface goes away) | — |
| P13 | `P13.keyboard-focus-and-live-region` | a screen reader reads the new messages; the whole chat works with the keyboard alone |
| P14 | `P14.reload-with-a-pending-confirmation`, `P14.expired-conversation` | `resume` is `true` and `storage` is not `"none"` in the app |
| P15 | `P15.long-paste`, `P15.too-long-is-not-cut-silently` (a paste that did not fit says how much was kept: the size appears once more than when it fit) | the words of the marker and of the notice |
| P16 | — | does not apply yet: the server does not support past conversations |

The scenarios are the ones of the bench — `assistant-question`, `attachment-failed`, `chat-unavailable`, `confirmation-from-older-backend`, `confirmation-no-longer-current`, `conversation-ended`, `daily-cap-mid-conversation`, `daily-cap-on-open`, `html-in-text`, `image-in-text`, `link-to-another-site`, `question-answered`, `reload-of-expired-conversation`, `reload-with-pending-confirmation`, `report-confirmed`, `report-revised`, `report-with-attachment`, `session-limit-mid-conversation` and `terminal-error` — plus two of its own, written with the same `Scenario` shape: a report whose body Markdown would change, and an error code the interface has never heard of.

## What the checks do not do

- **They do not judge the design.** An ugly interface that keeps the contract passes, and a structure they did not expect (the report in a quote or a code block, an indicator that stays mounted and is hidden when idle, a «More» button) is not a failure.
- **They are not the real backend.** They cannot tell what the assistant will *say*, nor that the server filters links (the bench plays text already filtered). That is tested in the backend.
- **They do not replace the manual list.** A passing run says that the points a test can tell are kept; the others are still yours.
- **A screenshot capture and its `hideUi` need a real browser.** The checks point at an element (the selector of the core works in a test DOM) but do not capture the screen.

## Proof that they have teeth

A test suite that every interface passes tells nothing. `conformance/broken-chat.tsx` (not published) is a small interface that is wrong in one way at a time — it approves by itself, it draws the report as Markdown, it cuts the body, it inserts the assistant's text as HTML, it shows `error.message`, it offers the chat when the backend says it is off, it leaks the person's name, it cuts a paste in silence… — and `broken.test.tsx` mounts it with each fault, expects the check that guards that point to fail and the same interface without the fault to pass it. It also mounts interfaces that are different but right (the report in a `<blockquote>` or in `<pre><code>`, an indicator hidden with `hidden`, a «More» button) and expects the checks to accept them. Revision 1 of this work found three holes by breaking the React example one line at a time (a paste cut in silence next to a marker with numbers, the server's text shown for a code the interface knows, a chat nobody destroys); each is a fault there now.

The official widget and the React example of the package (`examples/react`) pass every check: `widget.test.ts` and `react-example.test.tsx`, in `conformance/`. The first run on the widget found that it drew the copy of the report as Markdown (P6); it draws it as plain text now.
