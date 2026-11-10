import { useEffect, useRef, useState } from "react";
import { createSupportChat, MESSAGE_MAX_LENGTH, parseAssistantText, type ChatState, type SupportChat, type TextInline } from "@supcoflow/chat/core";
import { EMPTY_CHAT_STATE, useSupportChat, type UseSupportChatOptions } from "@supcoflow/chat/react";

// A small chat interface on purpose WRONG in one way at a time — the mistakes a developer (or a coding agent) really makes. It exists to prove that the conformance checks have
// teeth: `broken.test.tsx` mounts it with each `fault` and expects the check that guards that point to FAIL, and mounts it with `"none"` and expects the same check to pass, so
// the failure is the fault's and nobody else's. It is not shipped, and it is not an example to copy (the example is `examples/react`).

export type Fault =
  | "none"
  | "always-offered" //            offers the chat even when the backend says it is off (P1)
  | "typed-yes-approves" //        «yes» typed in the field confirms the report (P6)
  | "auto-approve" //              confirms the report by itself as soon as it is shown (P6)
  | "markdown-report" //           draws the report as Markdown (P6)
  | "truncated-report" //          cuts the body of the report (P6)
  | "links-as-html" //             inserts the assistant's text as HTML, bare URLs turned into links (P4)
  | "no-working-indicator" //      nothing says the assistant is working (P5)
  | "no-new-conversation" //       no way to start another conversation after a report (P8)
  | "shows-server-message" //      shows `error.message` (P9)
  | "retry-after-terminal" //      offers Retry on a terminal error (P9)
  | "no-live-region" //            new messages are not announced (P13)
  | "silent-cut" //                a paste that does not fit is cut without a word (P15)
  | "name-leaks" //                the signed-in person's name goes to the backend (P11)
  | "message-on-known-code" //     shows `error.message` for a code it does know (P9)
  | "never-destroys" //            never destroys its chat when it goes away (P12)
  // Not faults: interfaces that are DIFFERENT but right. The checks must not reject them (they ask nothing about structure).
  | "hidden-working-indicator" //  the indicator is always mounted and hidden with `hidden` (P5)
  | "report-in-blockquote" //      the report body in a <blockquote> (P6)
  | "report-in-pre-code" //        the report body in <pre><code> (P6)
  | "more-button" //               an unrelated «More» button in the panel (P9)
  | "inert-closed-panel"; //       the panel stays mounted and, closed, is `inert` (all of P1…P15 that open the chat)

const ERROR_TEXT: Record<string, string> = { tope_de_mensajes: "The assistant is not available for now.", limite_de_sesion: "This conversation reached its limit. You can start another one.", confirmacion_no_vigente: "The report was not sent: that confirmation is out of date." };

export function BrokenChat(props: UseSupportChatOptions & { fault: Fault }) {
  return props.fault === "never-destroys" ? <LeakyChat {...props} /> : <Chat {...props} />;
}

function Chat({ fault, ...options }: UseSupportChatOptions & { fault: Fault }) {
  const { chat, state, available } = useSupportChat(options);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const q = state.pendingQuestion;

  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  useEffect(() => { if (fault === "auto-approve" && q?.kind === "report_confirmation") void chat?.confirmReport(q.id); }, [fault, q, chat]);

  if (chat === null || (!available && fault !== "always-offered")) return null;
  const last = state.messages[state.messages.length - 1];
  const working = state.busy && (last === undefined || last.role !== "assistant" || last.text === "");
  const another = state.reported || state.error?.terminal === true;

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    if (fault === "typed-yes-approves" && q?.kind === "report_confirmation" && /^(yes|approve)$/i.test(text)) void chat!.confirmReport(q.id);
    else void chat!.send(text);
  }
  function paste(e: { clipboardData: DataTransfer; preventDefault(): void }) {
    const pasted = e.clipboardData.getData("text");
    const room = MESSAGE_MAX_LENGTH - draft.length;
    if (pasted.length <= room) return;
    e.preventDefault();
    const kept = pasted.slice(0, room);
    setDraft(draft + kept);
    if (fault !== "silent-cut") setNotice(`Only the first ${kept.length} of ${pasted.length} characters fit in a message.`);
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)}>Help</button>
      {(open || fault === "inert-closed-panel") && (
        <section aria-label="Support chat" {...(fault === "inert-closed-panel" ? { inert: !open } : {})}>
          <p>You are chatting with an automated assistant.</p>
          {fault === "more-button" && <button type="button">More</button>}
          <div {...(fault === "no-live-region" ? {} : { role: "log", "aria-live": "polite" as const })}>
            {state.messages.map((m) => {
              if (m.role === "user") return <p key={m.id}>{m.text}</p>;
              if (m.role === "outcome") return null;
              if (q?.kind === "report_confirmation" && m.text === q.prompt) return null; // drawn once, in the card below
              if (m.reportCopy === true && fault !== "markdown-report") return <pre key={m.id}>{m.text}</pre>;
              if (fault === "links-as-html") return <div key={m.id} dangerouslySetInnerHTML={{ __html: m.text.replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1">$1</a>') }} />;
              return <div key={m.id}>{fault === "markdown-report" ? <Formatted text={m.text} /> : <p>{m.text}</p>}</div>;
            })}
            {q?.kind === "report_confirmation" && (
              <article aria-label="Report to send">
                {q.report ? <><h3>{q.report.title}</h3>{fault === "markdown-report" ? <Formatted text={q.report.body} /> : fault === "report-in-blockquote" ? <blockquote style={{ whiteSpace: "pre-wrap" }}>{q.report.body}</blockquote> : fault === "report-in-pre-code" ? <pre><code>{q.report.body}</code></pre> : <pre>{fault === "truncated-report" ? `${q.report.body.slice(0, 40)}…` : q.report.body}</pre>}</> : <pre>{q.prompt}</pre>}
                {q.options.map((o) => <button key={o.id} type="button" disabled={state.busy} onClick={() => void (o.id === "approve" ? chat.confirmReport(q.id) : chat.reviseReport(q.id))}>{o.label}</button>)}
              </article>
            )}
            {q !== null && q.kind !== "report_confirmation" && <div>{q.options.map((o) => <button key={o.id} type="button" disabled={state.busy} onClick={() => void chat.answer(q.id, { optionId: o.id })}>{o.label}</button>)}</div>}
            {fault === "hidden-working-indicator" ? <p role="status" hidden={!working}>Working…</p> : working && fault !== "no-working-indicator" && <p role="status">Working…</p>}
            {state.error !== null && (
              <p role="alert">
                {fault === "shows-server-message" || (fault === "message-on-known-code" && state.error.code === "tope_de_mensajes") ? state.error.message : (ERROR_TEXT[state.error.code] ?? "Something went wrong.")}
                {(!state.error.terminal || fault === "retry-after-terminal") && state.error.code !== "confirmacion_no_vigente" && <button type="button" onClick={() => void chat.retry()}>Retry</button>}
              </p>
            )}
            {state.reported && <p>Report sent{reportId(state.messages) !== null && ` · ${reportId(state.messages)}`}.</p>}
            {another && fault !== "no-new-conversation" && <button type="button" onClick={() => chat.newConversation()}>New conversation</button>}
          </div>
          <form onSubmit={submit}>
            <textarea ref={field} aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} onPaste={paste} />
            <button type="submit" disabled={state.busy}>Send</button>
            <small>{draft.length} / {MESSAGE_MAX_LENGTH}</small> {/* a counter has numbers, like the marker of a paste: numbers alone do not tell that a paste was cut */}
            {notice !== null && <p role="status">{notice}</p>}
          </form>
        </section>
      )}
    </div>
  );
}

// A chat that creates its core and never destroys it: what a developer does with `createSupportChat` in an effect without a cleanup. A turn in flight stays alive after the interface left.
function LeakyChat(options: UseSupportChatOptions & { fault: Fault }) {
  const { fault: _fault, ...chatOptions } = options;
  const [chat, setChat] = useState<SupportChat | null>(null);
  const [state, setState] = useState<ChatState>(EMPTY_CHAT_STATE);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const c = createSupportChat(chatOptions);
    c.subscribe(() => setState(c.getState()));
    setChat(c); // …and no `return () => c.destroy()`
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (chat === null) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)}>Help</button>
      {open && (
        <section aria-label="Support chat">
          <p>You are chatting with an automated assistant.</p>
          <div role="log" aria-live="polite">{state.messages.map((m) => (m.role === "outcome" ? null : <p key={m.id}>{m.text}</p>))}</div>
          <form onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t !== "") { setDraft(""); void chat.send(t); } }}>
            <textarea aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit">Send</button>
          </form>
        </section>
      )}
    </div>
  );
}

// The Markdown drawing of a careless interface: the report body goes through the same parser as any assistant text.
function Formatted({ text }: { text: string }) {
  return <>{parseAssistantText(text, null).map((b, i) => (b.kind === "paragraph" ? <p key={i}>{inline(b.children)}</p> : b.kind === "list" ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul> : <pre key={i}><code>{b.text}</code></pre>))}</>;
}
function inline(nodes: TextInline[]): React.ReactNode {
  return nodes.map((n, i) => (n.kind === "text" ? n.text : n.kind === "code" ? <code key={i}>{n.text}</code> : n.kind === "bold" ? <strong key={i}>{inline(n.children)}</strong> : n.kind === "italic" ? <em key={i}>{inline(n.children)}</em> : <a key={i} href={n.href}>{inline(n.children)}</a>));
}

function reportId(messages: { role: string; outcome?: { kind: string; reportId?: string | null } }[]): string | null {
  for (const m of [...messages].reverse()) if (m.role === "outcome" && m.outcome?.kind === "reported") return m.outcome.reportId ?? null;
  return null;
}
