import type { ChatState, SupportChat } from "@supcoflow/chat/core";

// A complete custom chat UI in plain DOM, using ONLY `@supcoflow/chat/core`: streaming text, steps, the report confirmation, the outcome card,
// reload recovery (it just draws whatever `getState()` says), attachments and errors. Replace the DOM with React/Vue/Svelte: the rules stay in the core.
// The model's text is drawn with `textContent`, never as HTML.

export function mountCustomChat(root: HTMLElement, chat: SupportChat): () => void {
  const doc = root.ownerDocument;
  const h = (tag: string, cls = "", text = ""): HTMLElement => Object.assign(doc.createElement(tag), { className: cls, textContent: text });
  const button = (text: string, onClick: () => void, cls = ""): HTMLButtonElement => Object.assign(h("button", cls, text) as HTMLButtonElement, { type: "button", onclick: onClick });

  const log = h("div", "log");
  const bar = h("div", "attachments");
  const form = doc.createElement("form");
  const input = Object.assign(doc.createElement("input"), { placeholder: "Write here…" });
  const send = Object.assign(h("button", "send", "Send") as HTMLButtonElement, { type: "submit" });
  const pick = button("Pick an element", () => void chat.pickElement({ ignore: root }), "pick");
  const file = Object.assign(doc.createElement("input"), { type: "file", accept: "image/*", onchange: () => { const f = file.files?.[0]; if (f) void chat.attachImage(f); } });
  form.append(input, send, pick, file);
  form.onsubmit = (e) => { e.preventDefault(); const text = input.value.trim(); input.value = ""; void chat.send(text); };
  root.append(log, bar, form);

  const stepText = { guide_read: "Read the guide", report_summarized: "Summarized the report", question_noted: "Noted your question" } as const;

  function message(m: ChatState["messages"][number]): HTMLElement {
    if (m.role === "user") return h("p", "user", m.text);
    if (m.role === "outcome") {
      if (m.outcome.kind === "answered") return h("p", "outcome answered", "Answered ✓");
      return h("div", "outcome reported", `Report sent${m.outcome.reportId ? ` · ${m.outcome.reportId}` : ""}`);
    }
    const box = h("div", m.streaming ? "assistant streaming" : "assistant");
    for (const s of m.steps) box.append(h("small", "step", s.kind === "guide_read" ? `${stepText.guide_read} · ${s.section}` : stepText[s.kind]));
    box.append(h("p", "", m.text));
    return box;
  }

  function question(q: NonNullable<ChatState["pendingQuestion"]>): HTMLElement {
    const box = h("div", `question ${q.kind}`);
    // The report confirmation: the prompt (everything that will be sent) is the last assistant message above; the labels are the server's, drawn as they arrive.
    for (const o of q.options) {
      // Each answer carries the id of the question THIS card shows: a stale button can never answer a newer question.
      const onClick = q.kind !== "report_confirmation" ? () => void chat.answer(q.id, { optionId: o.id }) : o.id === "approve" ? () => void chat.confirmReport(q.id) : () => void chat.reviseReport(q.id);
      box.append(button(o.label, onClick, `option ${o.style}`));
    }
    return box;
  }

  function render(s: ChatState): void {
    log.replaceChildren(
      ...s.messages.map(message),
      ...(s.pendingQuestion ? [question(s.pendingQuestion)] : []),
      ...(s.busy ? [h("p", "busy", s.activity === "reading_guide" ? "Reading the guide…" : "Thinking…")] : []),
      ...(s.error ? [h("div", "error", s.error.terminal ? `This conversation ended (${s.error.code}).` : `Something failed (${s.error.code}).`)] : []),
    );
    if (s.error && !s.error.terminal) log.append(button("Retry", () => void chat.retry(), "retry"));
    if (s.reported) log.append(button("New conversation", () => chat.newConversation(), "new"));
    bar.replaceChildren(...s.attachments.map((a) => h("span", `chip ${a.status}`, `${a.label ?? "screenshot"} · ${a.status}`)));
    input.disabled = send.disabled = s.busy;
    pick.disabled = file.disabled = !s.canAttachMore || s.reported;
  }

  render(chat.getState());
  const unsubscribe = chat.subscribe(render);
  return () => { unsubscribe(); root.replaceChildren(); };
}
