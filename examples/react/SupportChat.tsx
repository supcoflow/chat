import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { isLongPaste, MESSAGE_MAX_LENGTH, parseAssistantText, pasteSize, type AttachResult, type ChatMessage, type ChatState, type PendingQuestion, type SupportChat as Chat, type TextInline } from "@supcoflow/chat/core";
import { useSupportChat, type UseSupportChatOptions } from "@supcoflow/chat/react";

// A whole support chat in React with NO styles and NO UI library: bare HTML elements only, on `useSupportChat` (`@supcoflow/chat/react`) and the helpers of the core
// (`@supcoflow/chat/core`). It is a skeleton, not a design. The rules of the chat — sending, reconnecting, the report confirmation, uploads — live in the core and arrive
// with `npm update`; what is here is what has to be SHOWN. Make it yours: swap every <button>, <textarea>, <section> for your app's own components, icons and tokens, and put
// the trigger wherever your app wants it (a header button, a menu item, a page). The `P…` comments name the points of the presentation contract (docs/presentation-contract.md).

const ERROR_TEXT: Record<string, string> = {
  tope_de_mensajes: "The assistant is not available for now. Please try again later.", // P9: never a button that asks for more messages
  limite_de_sesion: "This conversation reached its limit. You can start another one.",
  confirmacion_no_vigente: "That confirmation is out of date, so the report was not sent. Read the new summary and confirm again.", // P6
};
const GENERIC_ERROR = "Something went wrong."; // P9: a code we do not know; `error.message` is never shown
const ATTACH_NOTICE: Partial<Record<AttachResult, string>> = { limit: "You can attach up to 4 things.", invalid_image: "That file is not an image we can use.", no_capture: "The screen could not be captured.", not_allowed: "This project does not take that." };

export function SupportChat(options: UseSupportChatOptions) {
  // P6: declare the language of your app so the two buttons of the confirmation and its frame come in it (Spanish, English or Portuguese; English otherwise).
  const { chat, state, available, ready } = useSupportChat({
    locale: globalThis.document?.documentElement.lang || undefined,
    // T7: this interface offers all three evidence tools (below), so it declares them: the assistant only invites the person to do what the interface can take.
    capabilities: { attachImage: true, screenshot: true, pickElement: true },
    ...options,
  });
  const [open, setOpen] = useState(false);
  // The root of YOUR whole interface (trigger and panel): it is what P10 hides while the screen is captured and what cannot be picked as an element.
  const root = useRef<HTMLDivElement>(null);
  if (!available || chat === null) return null; // P1: nothing at all unless the chat is active for this origin
  return (
    <div ref={root}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Help</button>
      {open && <Panel chat={chat} state={state} ready={ready} root={root} />}
    </div>
  );
}

// The text that goes out: what the person typed, then what they pasted, one line apart.
const joined = (typed: string, pasted: string): string => [typed, pasted].filter(Boolean).join("\n");

function Panel({ chat, state, ready, root }: { chat: Chat; state: ChatState; ready: boolean; root: RefObject<HTMLDivElement | null> }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [pasted, setPasted] = useState(""); // P15: a long paste is kept apart, drawn collapsed, and sent whole
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => field.current?.focus(), []); // P13: the focus goes to the message field when the chat opens

  const q = state.pendingQuestion;
  const last = state.messages[state.messages.length - 1];
  const working = state.busy && (last === undefined || last.role !== "assistant" || last.text === ""); // P5
  const canAttach = !state.reported && state.canAttachMore; // P10
  const another = state.reported || state.error?.terminal === true; // P8, P9

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const text = joined(draft, pasted).trim();
    if (text === "") return;
    setDraft(""); setPasted(""); setNotice(null);
    // P7: while the assistant waits for free text, that is the answer; otherwise it is a new message.
    void (q?.kind === "question" && q.allowsText ? chat.answer(q.id, { text }) : chat.send(text));
  }

  function paste(e: { clipboardData: DataTransfer; currentTarget: HTMLTextAreaElement; preventDefault(): void }) {
    const text = e.clipboardData.getData("text");
    const long = isLongPaste(text);
    const { selectionStart: from, selectionEnd: to } = e.currentTarget;
    // What is left in the message, counting the line break that joins the typed text with the pasted one (a message holds MESSAGE_MAX_LENGTH, line breaks included),
    // and, for a short paste, what the selection it replaces gives back.
    const separator = long ? (pasted !== "" || draft !== "" ? 1 : 0) : pasted !== "" && draft === "" ? 1 : 0;
    const room = MESSAGE_MAX_LENGTH - joined(draft, pasted).length - separator + (long ? 0 : to - from);
    if (!long && text.length <= room) return; // a short paste that fits: the browser does it
    e.preventDefault();
    const kept = text.slice(0, Math.max(0, room));
    if (long) setPasted(pasted === "" ? kept : `${pasted}\n${kept}`); else setDraft(draft.slice(0, from) + kept + draft.slice(to));
    setNotice(kept.length < text.length ? `Only the first ${kept.length} of ${text.length} characters fit in a message.` : null); // P15: never cut silently
  }

  async function attach(run: () => Promise<AttachResult | "picked" | "cancelled" | "unavailable" | "limit" | "not_allowed">) {
    const result = await run(); // P10: a refused image is not an error of the chat
    setNotice(result === "ok" || result === "picked" || result === "cancelled" ? null : (ATTACH_NOTICE[result as AttachResult] ?? "That could not be attached."));
  }

  return (
    <section aria-label="Support chat">
      <p>You are chatting with an automated assistant.</p> {/* P2: visible whenever the chat is open, before the first message */}
      <div role="log" aria-live="polite"> {/* P13: a screen reader announces the new messages */}
        {!ready && <p role="status">Loading your conversation…</p> /* P14: never an empty chat that fills in later */}
        {ready && state.messages.length === 0 && q === null && <p>How can I help?</p>}
        {state.messages.map((m) => <Message key={m.id} message={m} pendingReport={q?.kind === "report_confirmation" ? q.prompt : null} />)}
        {q !== null && <Question chat={chat} question={q} state={state} />}
        {working && <p role="status">{state.activity === "reading_guide" ? "Reading the guide…" : "Working…"}</p>}
        {state.error !== null && (
          <p role="alert">
            {ERROR_TEXT[state.error.code] ?? GENERIC_ERROR} {/* P9: our own text per code, never `error.message` */}
            {!state.error.terminal && state.error.code !== "confirmacion_no_vigente" && <button type="button" onClick={() => void chat.retry()}>Retry</button>}
          </p>
        )}
        {state.reported && <p>Report sent{lastReportId(state) !== null && ` · ${lastReportId(state)}`}.</p> /* P8: say it was sent, with the number when there is one */}
        {another && <button type="button" onClick={() => chat.newConversation()}>New conversation</button>}
      </div>

      {canAttach && (
        <div>
          {state.allows.screenshots && <input type="file" accept="image/*" aria-label="Attach an image" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(() => chat.attachImage(f)); e.target.value = ""; }} />}
          {state.allows.screenshots && chat.canCaptureScreen() && (
            // P10: hide your own interface while the screen is grabbed, and show it again. An inline `display` on purpose: it beats the classes of your app, which `hidden` does not.
            <button type="button" onClick={() => void attach(() => chat.attachScreenshot({ hideUi: () => { if (root.current) root.current.style.display = "none"; }, showUi: () => { if (root.current) root.current.style.display = ""; } }))}>Take a screenshot</button>
          )}
          {state.allows.elements && <button type="button" onClick={() => void attach(() => chat.pickElement({ ignore: root.current }))}>Pick an element</button> /* P10: your interface cannot be picked */}
        </div>
      )}
      {state.attachments.length > 0 && (
        <ul aria-label="Attachments">
          {state.attachments.map((a) => (
            <li key={a.id}>
              {a.label ?? "Screenshot"} — {a.status}{a.status === "failed" && a.failure !== null && ` (${a.failure})`}
              {a.status === "failed" && a.retryable && <button type="button" onClick={() => chat.retryAttachment(a.id)}>Try again</button>}
              {a.status !== "uploaded" && <button type="button" onClick={() => chat.removeAttachment(a.id)}>Remove</button> /* P10: one that is already uploaded goes with the report, so it has no "remove" */}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit}>
        {pasted !== "" && (
          <>
            <details><summary>{pastedMarker(pasted)}</summary><pre>{pasted}</pre></details>
            <button type="button" onClick={() => setPasted("")}>Remove pasted text</button>
          </>
        )}
        <textarea ref={field} aria-label="Message" value={draft} maxLength={MESSAGE_MAX_LENGTH - pasted.length - (pasted === "" ? 0 : 1)} onChange={(e) => setDraft(e.target.value)} onPaste={paste} />
        <button type="submit" disabled={state.busy}>Send</button>
        {notice !== null && <p role="status">{notice}</p>}
      </form>
    </section>
  );
}

function pastedMarker(text: string): string {
  const { lines, characters } = pasteSize(text);
  return `[pasted text] · ${lines} lines · ${characters} characters`;
}

function lastReportId(state: ChatState): string | null {
  for (const m of [...state.messages].reverse()) if (m.role === "outcome" && m.outcome.kind === "reported") return m.outcome.reportId;
  return null;
}

function Message({ message: m, pendingReport }: { message: ChatMessage; pendingReport: string | null }) {
  if (m.role === "user") {
    // P3: it shows right away and stays. P15: a long message is drawn collapsed (after a reload a paste cannot be told from typing), and the person can open it.
    return isLongPaste(m.text) ? <details><summary>{pastedMarker(m.text)}</summary><pre>{m.text}</pre></details> : <p aria-busy={m.pending}>{m.text}</p>;
  }
  // The answer "Answered" has no words of its own: they are yours (`answered_outcome`).
  if (m.role === "outcome") return m.outcome.kind === "answered" ? <p>Answered ✓</p> : null; // the sent report is said once, below the conversation (P8)
  // P6: the report is drawn once, in its own card; its copy as the last assistant message is not drawn again while the confirmation is pending, and once it was
  // answered it is still PLAIN text, never Markdown: the core marks that message with `reportCopy`, also after a reload.
  if (m.text === pendingReport) return null;
  return m.reportCopy === true ? <pre>{m.text}</pre> : <div><AssistantText text={m.text} /></div>;
}

function Question({ chat, question: q, state }: { chat: Chat; question: PendingQuestion; state: ChatState }) {
  if (q.kind !== "report_confirmation") {
    // P7: the options of a question, answered with the id of the question that was drawn.
    return <div>{q.options.map((o) => <button key={o.id} type="button" disabled={state.busy} onClick={() => void chat.answer(q.id, { optionId: o.id })}>{o.label}</button>)}</div>;
  }
  const sent = state.attachments.filter((a) => a.status === "uploaded").length;
  const left = state.attachments.length - sent;
  return (
    <article aria-label="Report to send">
      {/* P6: everything that will be sent, complete, as PLAIN text with its line breaks (never Markdown or HTML). `report` is absent only on an older backend: then `prompt` has it all. */}
      {q.report ? <><h3>{q.report.title}</h3><pre>{q.report.body}</pre></> : <pre>{q.prompt}</pre>}
      {/* P6: say which attachments go with the report: the ones already uploaded do, the others do not. */}
      <p>{sent === 0 ? "No attachments go with this report." : `Attachments that go with this report: ${sent}.`}{left > 0 && ` Not included (still uploading or failed): ${left}.`}</p>
      {q.options.map((o) => (
        // P6: the labels exactly as they arrive; disabled while a turn is in flight; and the id is the one of THIS confirmation, never "whatever is pending now".
        // Nothing here (no timer, no effect, no typed text) ever calls `confirmReport`: only the press of a person.
        <button key={o.id} type="button" disabled={state.busy} onClick={() => void (o.id === "approve" ? chat.confirmReport(q.id) : chat.reviseReport(q.id))}>{o.label}</button>
      ))}
    </article>
  );
}

// P4: the assistant's text as the safe subset — paragraphs, lists, bold, italic, code and links ONLY to this site's origin — drawn as elements, never as HTML.
function AssistantText({ text }: { text: string }) {
  const blocks = parseAssistantText(text, globalThis.location?.origin ?? null);
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "paragraph" ? <p key={i}>{inline(b.children)}</p>
        : b.kind === "list" ? (b.ordered ? <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol> : <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>)
        : <pre key={i}><code>{b.text}</code></pre>)}
    </>
  );
}

function inline(nodes: TextInline[]): ReactNode {
  return nodes.map((n, i) =>
    n.kind === "text" ? n.text
    : n.kind === "code" ? <code key={i}>{n.text}</code>
    : n.kind === "bold" ? <strong key={i}>{inline(n.children)}</strong>
    : n.kind === "italic" ? <em key={i}>{inline(n.children)}</em>
    : <a key={i} href={n.href}>{inline(n.children)}</a>);
}
