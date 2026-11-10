// Conformance checks for a chat interface built on `@supcoflow/chat/core` — the presentation contract (docs/presentation-contract.md), as tests.
//
// COPY THIS FILE AS IT IS next to your tests and do not edit it: it is replaced when the contract version changes. What is yours is the adapter
// (`chat.conformance.template.tsx`): how your interface is mounted and what your words are. It runs with vitest (the checks use `expect(value, message)`, which jest's
// `expect` does not accept) and `@testing-library/dom`.
//
// The checks look at THREE things and never at the design — no class names, no `data-*`, no layout, no Tailwind:
//   1. what the interface asked the (fake) backend, and when      -> `backend.requests`, `backend.answers()`
//   2. the text it shows (hidden and collapsed text does not count) -> `visibleText(root)`
//   3. the accessible roles and names of its controls              -> `getByRole("button", { name })`
// What cannot be told from a test — that "automated assistant" is said in your app's language, that a screen reader reads a message, what a person understands from a
// sentence — is listed in `MANUAL` and left to a person.

import { fireEvent, waitFor, within } from "@testing-library/dom";
import { MESSAGE_MAX_LENGTH, isLongPaste, type ChatUser } from "@supcoflow/chat/core";
import { completeElementPick, createFakeBackend, getScenario, storageWithSavedConversation, type FakeBackend, type Scenario } from "@supcoflow/chat/testing";
import { describe, expect, it } from "vitest";

/** The version of the presentation contract these checks follow (`contract.json`). */
export const CONTRACT_VERSION = "1.1.0";

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// The adapter: the only part that is about YOUR interface.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** What the interface is mounted with: the options of `createSupportChat` / `useSupportChat`, plus the signed-in person of your test fixture. */
export interface MountOptions {
  tenantId: string;
  projectId: string;
  /** The fake backend. */
  backendUrl: string;
  /** The fake backend's `fetch`: give it to the chat. */
  fetch: typeof fetch;
  /** `"none"`, or the saved conversation of a reload scenario. */
  storage: "none" | Pick<Storage, "getItem" | "setItem" | "removeItem">;
  autoContext: false;
  locale: "en";
  user?: ChatUser;
  /** The name of the person your app has signed in during this test. It must never reach the chat (P11): if your app knows the name, it still does not send it. */
  person: { name: string };
}

/** A mounted interface. `root` is where the checks look: the element that contains the whole interface (`document.body`, a container, a shadow root). */
export interface Mounted {
  root: HTMLElement;
  unmount(): void | Promise<void>;
}

/** Your words: how your interface calls its controls and what it says, as regular expressions (or exact strings) in the language of your app. */
export interface Words {
  /** The control that opens the chat, or `null` if the chat is always on screen. */
  trigger: RegExp | null;
  /** The control that closes it, when it is not the trigger itself (default: the trigger). */
  close?: RegExp;
  /** The accessible name of the field where the person writes. */
  messageField: RegExp;
  send: RegExp;
  retry: RegExp;
  newConversation: RegExp;
  /** P2: the sentence that says it is an automated assistant. */
  automatedAssistant: RegExp;
  /** P5: what the interface says (text or accessible label) while the assistant works. */
  working: RegExp;
  /** P8: what it says when the report was sent. */
  reportSent: RegExp;
  /** P6: what it says when the report was NOT sent (the confirmation was out of date). */
  reportNotSent: RegExp;
  /** P9: the generic failure for a code it does not know. */
  somethingWrong: RegExp;
  /** P14: the greeting of an empty conversation, if there is one (it must not flash while a saved conversation is coming back). */
  emptyConversation?: RegExp;
  /** P7: the field and button where a free-text answer to a question goes (default: the message field and the send button). */
  freeText?: { field: RegExp; send: RegExp };
  /** P10: the control that points at an element, when the interface offers it. Without it the attachment checks are skipped. */
  pickElement?: RegExp;
  /** P10: the buttons that remove / retry an attachment. */
  removeAttachment?: RegExp;
  retryAttachment?: RegExp;
}

export interface Adapter {
  /** A name for the report: "My app", "the official widget". */
  name: string;
  words: Words;
  /** `true` once `mount` puts `options.person.name` where your app reads who is signed in (the mock of your auth provider…). Without it the P11 check has nothing to find, so it is SKIPPED instead of passing. */
  personWired?: boolean;
  /** Render your interface like your app would, with these options, and give back where to look. The checks call it once per scenario, and unmount at the end. */
  mount(options: MountOptions): Promise<Mounted>;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// The session of one check
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const IDS = { tenantId: "tenant_conformance", projectId: "project_conformance" };
const PERSON = { name: "Zorblax Quimby" };

type Ui = ReturnType<typeof within>;

interface Session {
  adapter: Adapter;
  words: Words;
  scenario: Scenario;
  backend: FakeBackend;
  mounted: Mounted;
  ui: Ui;
  origin: string;
  /** Everything the interface wrote to the console. */
  logs: string[];
  unmount(): Promise<void>;
}

interface StartOptions {
  /** Start from the conversation the scenario says the tab already had (the reload scenarios). */
  saved?: boolean;
  user?: ChatUser;
  /** Share this backend instead of making one (P12: mount again on the same backend). */
  backend?: FakeBackend;
}

const wait = (ms: number) => {
  const t0 = Date.now();
  return waitFor(() => { if (Date.now() - t0 < ms) throw new Error("settling"); }, { timeout: ms + 1000, interval: 5 });
};
/** Let the promises and timers of the chat and of your framework run. */
const settle = (ms = 30) => wait(ms);

async function start(adapter: Adapter, scenario: string | Scenario, options: StartOptions = {}): Promise<Session> {
  const origin = globalThis.location?.origin;
  if (origin === undefined || !/^https?:/.test(origin)) throw new Error("The test page has no http(s) origin: set the page URL in your test environment (happy-dom and jsdom default to http://localhost:3000).");
  const sc = typeof scenario === "string" ? getScenario(scenario) : scenario;
  const backend = options.backend ?? createFakeBackend(sc, { origin });
  const logs: string[] = [];
  const saved = console as unknown as Record<string, (...a: unknown[]) => void>;
  const originals: Record<string, (...a: unknown[]) => void> = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = saved[level]!;
    saved[level] = (...args: unknown[]) => { logs.push(args.map((a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); } }).join(" ")); };
  }
  const restore = () => { for (const level of Object.keys(originals)) saved[level] = originals[level]!; };
  try {
    const storage = options.saved ? storageWithSavedConversation(sc, IDS) : ("none" as const);
    const mounted = await adapter.mount({ ...IDS, backendUrl: backend.url, fetch: backend.fetch, storage, autoContext: false, locale: "en", person: PERSON, ...(options.user === undefined ? {} : { user: options.user }) });
    let closed = false;
    return {
      adapter, words: adapter.words, scenario: sc, backend, mounted, ui: within(mounted.root), origin, logs,
      async unmount() { if (closed) return; closed = true; try { await mounted.unmount(); } finally { restore(); } },
    };
  } catch (e) { restore(); throw e; }
}

/** Run `body` on a started session and always unmount, so one check never leaves its interface behind for the next. */
async function using<T>(adapter: Adapter, scenario: string | Scenario, options: StartOptions, body: (s: Session) => Promise<T>): Promise<T> {
  const s = await start(adapter, scenario, options);
  try { return await body(s); } finally { await s.unmount(); }
}

// --- what is on screen ----------------------------------------------------------------------------------------------------------------------------------

const BLOCKS = "p, div, pre, li, ul, ol, section, article, header, footer, form, button, summary, label, h1, h2, h3, h4, h5, h6, blockquote, tr, td, th";

/** The text a person can read: no styles or scripts, no `hidden` / `aria-hidden` parts, no collapsed `<details>`, and a `<br>` is a line break. */
export function visibleText(root: HTMLElement): string {
  const holder = document.createElement("div");
  for (const n of Array.from(root.childNodes)) holder.appendChild(n.cloneNode(true));
  holder.querySelectorAll("style, script, template, [hidden], [inert], [aria-hidden='true']").forEach((e) => e.remove());
  holder.querySelectorAll("details:not([open])").forEach((d) => Array.from(d.children).forEach((c) => { if (c.tagName !== "SUMMARY") c.remove(); }));
  holder.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  // `textContent` glues the text of one block to the next («consecteturHow»): a block ends with a line break, as it does on screen.
  holder.querySelectorAll(BLOCKS).forEach((b) => b.after("\n"));
  return holder.textContent ?? "";
}
const text = (s: Session): string => visibleText(s.mounted.root);
/** The accessible controls of a role whose name matches. */
const find = (s: Session, role: "button" | "textbox", name: string | RegExp): HTMLElement | null => s.ui.queryByRole(role, { name });
/** Out of reach: not there, disabled, or inside something `hidden`, `inert` or `aria-hidden` (a test DOM does not load your CSS classes: a panel that only a class hides looks open here). */
const isDisabled = (el: HTMLElement | null): boolean => el === null || (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || el.closest("[hidden], [inert], [aria-hidden='true']") !== null;
const offered = (el: HTMLElement | null): boolean => el !== null && !isDisabled(el);
const isShown = (el: Element): boolean => el.closest("[hidden], [inert], [aria-hidden='true']") === null;
/** What the server said, raw, in a scenario: the `mensaje` of its error events and, for a request it refused, `HTTP <status>` (what `error.message` carries). It is not for the person (P9). The CODE is not here: the contract forbids `error.message`, not showing the code next to your own text. */
function rawErrors(sc: Scenario): string[] {
  const out: string[] = [];
  for (const r of sc.responses) {
    if ("http" in r) { out.push(`HTTP ${r.http}`); continue; }
    for (const line of r.stream) {
      const l = line as { t?: string; mensaje?: unknown };
      if (typeof line === "object" && l.t === "error" && typeof l.mensaje === "string") out.push(l.mensaje);
    }
  }
  return out.filter((x) => x.length >= 5);
}
const expectNoRawErrors = (s: Session): void => { for (const raw of rawErrors(s.scenario)) expect(text(s), `the server's «${raw}» is not for the person`).not.toContain(raw); };
const norm = (t: string) => t.replace(/\s+/g, " ").trim();

// --- what the person does -------------------------------------------------------------------------------------------------------------------------------

/** Open the chat like the person would: press the trigger — unless the chat is already open, as it is when a saved conversation comes back. */
async function open(s: Session): Promise<void> {
  if (s.words.trigger !== null) {
    const trigger = s.words.trigger;
    await waitFor(() => expect(find(s, "button", trigger) ?? find(s, "textbox", s.words.messageField), "neither the trigger nor the open chat is on screen").not.toBeNull());
    // Open means the field can be used: a field that is mounted but `inert` (or disabled) is a closed chat.
    if (!offered(find(s, "textbox", s.words.messageField))) fireEvent.click(find(s, "button", trigger)!);
  }
  await waitFor(() => expect(offered(find(s, "textbox", s.words.messageField)), `the field named ${s.words.messageField} is not on screen or cannot be used after opening the chat`).toBe(true));
}
/** The person can start another conversation: with a button for it, or just by writing — either way the next message opens a new conversation on the backend. */
async function startAnother(s: Session): Promise<void> {
  const opens = s.backend.requestsOfKind("open").length;
  const button = find(s, "button", s.words.newConversation);
  if (button !== null) { fireEvent.click(button); await settle(); }
  await say(s, "starting again");
  expect(s.backend.requestsOfKind("open").length, "the next message opens another conversation").toBe(opens + 1);
}
async function type(s: Session, value: string, field: RegExp = s.words.messageField): Promise<HTMLElement> {
  const el = await s.ui.findByRole("textbox", { name: field });
  fireEvent.input(el, { target: { value } });
  return el;
}
async function press(s: Session, name: string | RegExp): Promise<void> {
  const b = await s.ui.findByRole("button", { name });
  await waitFor(() => expect(isDisabled(b), `«${String(name)}» stays disabled or out of reach (disabled, hidden, inert or aria-hidden)`).toBe(false));
  fireEvent.click(b);
}
/** Write `value` in the message field and press send. Resolves when the request left. */
async function say(s: Session, value: string, field = s.words.messageField, send = s.words.send): Promise<void> {
  const before = s.backend.requests.length;
  await type(s, value, field);
  await press(s, send);
  await waitFor(() => expect(s.backend.requests.length).toBeGreaterThan(before));
  await settle();
}
/** A browser pastes by itself unless the page handles the paste event: dispatch it, and if nobody stopped it, insert the text like the browser would. */
async function paste(s: Session, value: string): Promise<void> {
  const el = (await s.ui.findByRole("textbox", { name: s.words.messageField })) as HTMLTextAreaElement;
  const data = { getData: (t: string) => (t === "text" || t === "text/plain" ? value : ""), types: ["text/plain"], items: [], files: [] };
  const evento = Object.assign(new Event("paste", { bubbles: true, cancelable: true }), { clipboardData: data });
  const prevented = !el.dispatchEvent(evento);
  if (!prevented) fireEvent.input(el, { target: { value: el.value + value } });
  await settle();
}

const LABELS = (sc: Scenario): Map<string, { id: string; label: string }[]> => {
  // The options of every question of the scenario, by question id: the words of the buttons come from the backend, not from the adapter.
  const out = new Map<string, { id: string; label: string }[]>();
  for (const r of sc.responses) for (const line of "stream" in r ? r.stream : []) {
    const l = line as { t?: string; requestId?: string; opciones?: { id: string; label: string }[] };
    if (typeof line === "object" && l.t === "pregunta" && l.requestId !== undefined && Array.isArray(l.opciones)) out.set(l.requestId, l.opciones);
  }
  return out;
};
const optionLabel = (sc: Scenario, optionId: string): string => {
  for (const options of LABELS(sc).values()) { const o = options.find((x) => x.id === optionId); if (o !== undefined) return o.label; }
  throw new Error(`The scenario "${sc.name}" has no option "${optionId}".`);
};

/** Do the first `steps` actions of the scenario's script like the person would, through the interface. */
async function play(s: Session, steps = s.scenario.script.length): Promise<void> {
  let opened = false;
  for (const step of s.scenario.script.slice(0, steps)) {
    if (!opened && !("checkAvailability" in step)) { await open(s); opened = true; }
    if ("send" in step) await say(s, step.send);
    else if ("confirmReport" in step) { await press(s, optionLabel(s.scenario, "approve")); await settle(); }
    else if ("reviseReport" in step) { await press(s, optionLabel(s.scenario, "cancel")); await settle(); }
    else if ("answer" in step && step.answer.optionId !== undefined) { await press(s, optionLabel(s.scenario, step.answer.optionId)); await settle(); }
    else if ("retry" in step) { await press(s, s.words.retry); await settle(); }
    else if ("newConversation" in step) { await press(s, s.words.newConversation); await settle(); }
    else if ("waitForRewind" in step) await settle(60);
    else if ("pickElement" in step) await pick(s);
  }
}
async function pick(s: Session): Promise<void> {
  const name = s.words.pickElement;
  if (name === undefined) throw new Error("This check needs `words.pickElement`.");
  const control = await s.ui.findByRole("button", { name });
  const opened = await completeElementPick(() => fireEvent.click(control));
  expect(opened, "pressing the control that points at an element did not open the selector of the core").toBe(true);
  await settle();
}

/** The confirmation of the report is on screen: wait for its two actions (their words are the ones the backend sent). */
async function confirmationShown(s: Session): Promise<void> {
  await s.ui.findByRole("button", { name: optionLabel(s.scenario, "approve") });
  await s.ui.findByRole("button", { name: optionLabel(s.scenario, "cancel") });
}
const report = (sc: Scenario): { title: string; body: string; prompt: string } | null => {
  for (const r of sc.responses) for (const line of "stream" in r ? r.stream : []) {
    const l = line as { t?: string; prompt?: string; reporte?: { titulo: string; cuerpo: string } };
    if (typeof line === "object" && l.t === "pregunta" && l.prompt !== undefined && l.reporte !== undefined) return { title: l.reporte.titulo, body: l.reporte.cuerpo, prompt: l.prompt };
  }
  return null;
};
const approvals = (b: FakeBackend) => b.answers().filter((a) => a.optionId === "approve");

/** `report-confirmed` with a body that Markdown would change if the interface drew it as Markdown. */
function plainReportScenario(origin: string): Scenario {
  const base = getScenario("report-confirmed");
  const title = "The Save button does nothing";
  const body = `Steps: **bold-marker**, _italic-marker_ and \`code-marker\` and [link-marker](${origin}/settings)\n- item-marker-a\n- item-marker-b\n\n1. first-marker\n2. second-marker`;
  const prompt = `This is what I'll send to the team:\n\n${title}\n\n${body}\n\nShall I send it?`;
  return {
    ...base,
    name: "report-confirmed-with-markdown-in-the-report",
    responses: base.responses.map((r) => ("stream" in r ? { stream: r.stream.map((line) => (typeof line === "object" && (line as { t?: string }).t === "pregunta" ? { ...(line as object), prompt, reporte: { titulo: title, cuerpo: body } } : line)) } : r)),
  };
}
const MARKERS = ["bold-marker", "italic-marker", "code-marker", "link-marker", "item-marker-a", "item-marker-b", "first-marker", "second-marker"];
const FORMATTING = "strong, b, em, i, li, ul, ol, a, code, img, h1, h2, h3, h4, h5, h6, blockquote, table";
/** Formatting that was applied to PART of the report: an element of Markdown output that holds a marker but not the whole body. One that wraps the whole body (a quote, a code block) is a plain-text frame. */
function formattedParts(s: Session, body: string): string[] {
  return Array.from(s.mounted.root.querySelectorAll(FORMATTING))
    .filter((el) => MARKERS.some((m) => (el.textContent ?? "").includes(m)) && !norm(visibleText(el as HTMLElement)).includes(norm(body)))
    .map((el) => el.tagName);
}

/** A scenario with a single error line, to see what the interface does with a code it was not written for. */
function errorScenario(name: string, error: { codigo: string; mensaje: string; terminal: boolean }): Scenario {
  const ok = { stream: [{ v: 1, t: "sesion", id: "ses_E", indice: 0 }, { v: 1, t: "usuario", texto: "hello" }, { v: 1, t: "asistente", texto: "Hi! How can I help?" }, { v: 1, t: "espera", indice: 4 }] };
  return {
    name, description: "An error the interface has no text for.", covers: ["P9"],
    script: [{ send: "hello" }, { retry: true }],
    responses: [{ stream: [{ v: 1, t: "sesion", id: "ses_E", indice: 0 }, { v: 1, t: "usuario", texto: "hello" }, { v: 1, t: "error", codigo: error.codigo, mensaje: error.mensaje, terminal: error.terminal }, ...(error.terminal ? [] : [{ v: 1, t: "espera", indice: 3 }])] }, ok],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

export interface Check {
  id: string;
  /** The points of the contract it checks. */
  points: readonly string[];
  title: string;
  /** Words the interface has to give for the check to apply (it offers attachments only if it gives `pickElement`). Without them the check is SKIPPED, and the report says so: a skipped check is not a pass. */
  needs?: readonly (keyof Words)[];
  /** The check looks for the signed-in person's name in what the interface sends: it only means something if the adapter put that name where the app reads who is signed in (`Adapter.personWired`). */
  needsPerson?: true;
  run(adapter: Adapter): Promise<void>;
}

const LONG_PASTE = "lorem ipsum dolor sit amet, consectetur\n".repeat(30);
const HUGE_PASTE = "lorem ipsum dolor sit amet, consectetur\n".repeat(150);

export const checks: readonly Check[] = [
  // P1 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P1.asks-before-offering", points: ["P1"], title: "asks whether the chat is available before offering it, and offers it when it is", async run(a) {
    await using(a, "question-answered", {}, async (s) => {
      await open(s);
      expect(s.backend.requests[0]?.kind, "the first thing asked of the backend is the availability check").toBe("availability");
      expect(s.backend.requestsOfKind("open"), "nothing is opened before the person writes").toHaveLength(0);
    });
  } },
  { id: "P1.not-offered-when-unavailable", points: ["P1"], title: "does not offer the chat (or shows it disabled) when it is not available", async run(a) {
    await using(a, "chat-unavailable", {}, async (s) => {
      await waitFor(() => expect(s.backend.requestsOfKind("availability").length).toBeGreaterThan(0));
      await settle(80);
      if (s.words.trigger !== null) expect(offered(find(s, "button", s.words.trigger)), "the trigger of an unavailable chat is not offered").toBe(false);
      expect(offered(find(s, "textbox", s.words.messageField)), "the message field of an unavailable chat is not offered").toBe(false);
      expect(s.backend.requestsOfKind("open")).toHaveLength(0);
    });
  } },

  // P2 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P2.automated-assistant", points: ["P2"], title: "says it is an automated assistant, before the first message and after it", async run(a) {
    await using(a, "question-answered", {}, async (s) => {
      await open(s);
      expect(text(s), "visible when the chat opens, before any message").toMatch(s.words.automatedAssistant);
      await say(s, "How do I export my data?");
      await waitFor(() => expect(text(s)).toContain("You can export"));
      expect(text(s), "still visible after the first exchange").toMatch(s.words.automatedAssistant);
    });
  } },

  // P3 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P3.what-the-person-writes-stays", points: ["P3"], title: "shows what the person wrote as soon as it is sent, and keeps it when the turn fails", async run(a) {
    await using(a, "daily-cap-on-open", {}, async (s) => {
      await open(s);
      const release = s.backend.hold();
      await type(s, "hello there");
      await press(s, s.words.send);
      await waitFor(() => expect(s.backend.requestsOfKind("open")).toHaveLength(1));
      expect(text(s), "the message shows while the request is still in flight").toContain("hello there");
      release();
      await settle(80);
      expect(text(s), "and stays when the turn failed (the daily cap)").toContain("hello there");
      expectNoRawErrors(s);
    });
  } },

  // P4 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P4.complete-text", points: ["P4"], title: "shows the complete text of the assistant, unedited and in order", async run(a) {
    await using(a, "question-answered", {}, async (s) => {
      await play(s);
      await waitFor(() => expect(text(s)).toContain("You can export"));
      // Markdown-flavored: bold marks may become bold; nothing else of the sentence is lost.
      expect(norm(text(s).replace(/\*\*/g, ""))).toContain("You can export from Reports.");
    });
    await using(a, "conversation-ended", {}, async (s) => {
      await play(s);
      const t = norm(text(s));
      expect(t.indexOf("You're welcome!"), "first answer").toBeGreaterThanOrEqual(0);
      expect(t.indexOf("Sure, tell me."), "second answer, after the first").toBeGreaterThan(t.indexOf("You're welcome!"));
    });
  } },
  { id: "P4.links-only-to-your-site", points: ["P4"], title: "draws no link to another site, no bare URL as a link and no image", async run(a) {
    await using(a, "link-to-another-site", {}, async (s) => {
      await play(s);
      await waitFor(() => expect(text(s)).toContain("Billing guide"));
      for (const link of Array.from(s.mounted.root.querySelectorAll("a"))) {
        const href = link.getAttribute("href") ?? "";
        expect(new URL(href, s.origin).origin, `a link to ${href}: only your own origin (${s.origin}) is allowed`).toBe(s.origin);
      }
      expect(s.mounted.root.querySelectorAll("img").length, "no image comes from the assistant's text").toBe(0);
      expect(text(s), "the other site's address stays readable, as text").toContain("https://other-site.example/pricing");
      expect(text(s)).toContain("(https://other-site.example/billing)");
    });
  } },
  { id: "P4.no-images-from-text", points: ["P4"], title: "draws no image from the assistant's text", async run(a) {
    await using(a, "image-in-text", {}, async (s) => {
      await play(s);
      await waitFor(() => expect(text(s)).toContain("settings.png"));
      expect(s.mounted.root.querySelectorAll("img, picture, video, audio").length).toBe(0);
    });
  } },
  { id: "P4.never-html", points: ["P4"], title: "never inserts the assistant's text as HTML", async run(a) {
    await using(a, "html-in-text", {}, async (s) => {
      await play(s);
      await waitFor(() => expect(text(s)).toContain("reload the page"));
      expect(s.mounted.root.querySelectorAll("script, iframe, object, embed, img, style[data-from-assistant], form[action]").length, "elements the text asked for").toBe(0);
      expect(text(s), "the tags are shown as the text they arrived as").toContain("＜script>alert(1)＜/script>");
    });
  } },

  // P5 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P5.working-indicator", points: ["P5"], title: "shows that the assistant is working while there is no text yet, and stops when the text arrives", async run(a) {
    await using(a, "question-answered", {}, async (s) => {
      // Hidden does not count (an indicator that stays mounted and is hidden when idle is fine): the visible text, or a visible element labelled so.
      const shown = () => s.words.working.test(text(s)) || (s.ui.queryAllByLabelText(s.words.working) as HTMLElement[]).some(isShown);
      await open(s);
      expect(shown(), "nothing is working before the person writes").toBe(false);
      const release = s.backend.hold();
      await type(s, "How do I export my data?");
      await press(s, s.words.send);
      await waitFor(() => expect(s.backend.requestsOfKind("open")).toHaveLength(1));
      await waitFor(() => expect(shown(), "the request is in flight and no text came: something says it is working").toBe(true));
      release();
      await waitFor(() => expect(text(s)).toContain("You can export"));
      await waitFor(() => expect(shown(), "the answer arrived: the indicator is gone").toBe(false));
    });
  } },

  // P6 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P6.shows-everything-as-plain-text", points: ["P6"], title: "shows the whole report as plain text — wherever it appears, also after the person answered", async run(a) {
    const sc = plainReportScenario(globalThis.location.origin);
    const r = report(sc)!;
    await using(a, sc, {}, async (s) => {
      await play(s, 2);
      await confirmationShown(s);
      expect(text(s), "the title, complete").toContain(r.title);
      expect(text(s), "the body, complete, character by character: no Markdown was applied to it").toContain(r.body);
      expect(formattedParts(s, r.body), "no formatting element wraps a part of the report").toEqual([]);
      // After the person answers "fix something", the draft is still there to be read — and still plain text (it is the last assistant message).
      await press(s, optionLabel(sc, "cancel"));
      await settle();
      expect(text(s), "the report copy stays after the answer, whole").toContain(r.body);
      expect(formattedParts(s, r.body), "…and plain: no formatting element after the answer either").toEqual([]);
    });
  } },
  { id: "P6.older-backend-prompt", points: ["P6"], title: "with a backend that sends no structured report, shows the whole prompt", async run(a) {
    await using(a, "confirmation-from-older-backend", {}, async (s) => {
      await play(s, 2);
      await confirmationShown(s);
      const prompt = s.scenario.responses.flatMap((r) => ("stream" in r ? r.stream : [])).map((l) => (l as { prompt?: string }).prompt).find((p) => typeof p === "string")!;
      expect(norm(text(s)), "everything that will be sent, uncut").toContain(norm(prompt));
    });
  } },
  { id: "P6.two-actions-and-no-automatic-yes", points: ["P6"], title: "offers the two actions with the backend's own words, and never answers by itself, by time or by typed text", async run(a) {
    await using(a, "report-confirmed", {}, async (s) => {
      await play(s, 2);
      await confirmationShown(s);
      expect(s.backend.answers(), "the confirmation is on screen and nobody pressed anything").toEqual([]);
      await settle(300);
      expect(s.backend.answers(), "a timer or an effect answered").toEqual([]);
      await say(s, "yes");
      await say(s, "approve");
      expect(approvals(s.backend), "typing «yes» or «approve» is a message, not an approval").toEqual([]);
    });
  } },
  { id: "P6.approve-carries-the-id", points: ["P6"], title: "pressing «send it» answers approve with the id of the confirmation shown, once, and both actions are off while the turn runs", async run(a) {
    await using(a, "report-confirmed", {}, async (s) => {
      await play(s, 2);
      await confirmationShown(s);
      const label = optionLabel(s.scenario, "approve");
      const yes = await s.ui.findByRole("button", { name: label });
      const release = s.backend.hold();
      fireEvent.click(yes);
      await waitFor(() => expect(approvals(s.backend)).toHaveLength(1));
      // A second press while the first is in flight does nothing, and both actions are disabled (or gone) while the turn runs.
      fireEvent.click(yes);
      for (const id of ["approve", "cancel"]) expect(isDisabled(find(s, "button", optionLabel(s.scenario, id))), `«${optionLabel(s.scenario, id)}» is disabled while a turn is in flight`).toBe(true);
      release();
      await settle(80);
      expect(s.backend.answers().map(({ requestId, optionId }) => ({ requestId, optionId }))).toEqual([{ requestId: "req_1", optionId: "approve" }]);
    });
  } },
  { id: "P6.fix-something", points: ["P6"], title: "pressing «fix something» answers cancel and reports nothing", async run(a) {
    await using(a, "report-revised", {}, async (s) => {
      await play(s);
      expect(s.backend.answers().map(({ requestId, optionId }) => ({ requestId, optionId }))).toEqual([{ requestId: "req_1", optionId: "cancel" }]);
      await waitFor(() => expect(text(s)).toContain("what would you like to change"));
    });
  } },
  { id: "P6.not-current-says-not-sent", points: ["P6"], title: "when the server says the confirmation is no longer current, says the report was not sent", async run(a) {
    await using(a, "confirmation-no-longer-current", {}, async (s) => {
      await play(s);
      await waitFor(() => expect(text(s)).toMatch(s.words.reportNotSent));
      expect(text(s), "it must not claim the report went").not.toMatch(s.words.reportSent);
      expectNoRawErrors(s);
    });
  } },

  // P7 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P7.options-and-free-text", points: ["P7"], title: "shows a question's options and answers with the id of the question that was drawn", async run(a) {
    await using(a, "assistant-question", {}, async (s) => {
      await play(s, 1);
      for (const label of ["Chrome", "Safari", "Firefox"]) await s.ui.findByRole("button", { name: label });
      expect(s.backend.answers()).toEqual([]);
      await press(s, "Chrome");
      await waitFor(() => expect(s.backend.answers()).toHaveLength(1));
      expect(s.backend.answers().map(({ requestId, optionId }) => ({ requestId, optionId }))).toEqual([{ requestId: "req_q1", optionId: "chrome" }]);
    });
    await using(a, "assistant-question", {}, async (s) => {
      await play(s, 1);
      await s.ui.findByRole("button", { name: "Chrome" });
      const free = s.words.freeText ?? { field: s.words.messageField, send: s.words.send };
      await say(s, "my own browser", free.field, free.send);
      await waitFor(() => expect(s.backend.answers()).toHaveLength(1));
      expect(s.backend.answers().map(({ requestId, text: t }) => ({ requestId, text: t }))).toEqual([{ requestId: "req_q1", text: "my own browser" }]);
    });
  } },

  // P8 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P8.after-a-report", points: ["P8"], title: "says the report was sent with its number, offers no attachments, and offers another conversation", async run(a) {
    await using(a, "report-confirmed", {}, async (s) => {
      await play(s);
      await waitFor(() => expect(text(s)).toMatch(s.words.reportSent));
      expect(text(s), "the report number is shown when the server sent one").toContain("rep_3f9a1c2b7d4e5a60");
      if (s.words.pickElement !== undefined) expect(offered(find(s, "button", s.words.pickElement)), "no attachments after the report").toBe(false);
      const another = await s.ui.findByRole("button", { name: s.words.newConversation });
      const opens = s.backend.requestsOfKind("open").length;
      fireEvent.click(another);
      await settle();
      await say(s, "one more thing");
      expect(s.backend.requestsOfKind("open").length, "after «new conversation» the next message opens another conversation").toBe(opens + 1);
    });
  } },

  // P9 -------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P9.unknown-code", points: ["P9"], title: "shows its own text for a code it does not know — never the server's message — and offers a retry", async run(a) {
    const sc = errorScenario("unknown-code", { codigo: "algo_nuevo_del_futuro", mensaje: "ZZZ-server-message-ZZZ", terminal: false });
    await using(a, sc, {}, async (s) => {
      await play(s, 1);
      await waitFor(() => expect(text(s)).toMatch(s.words.somethingWrong));
      expect(text(s), "error.message is not for the person").not.toContain("ZZZ-server-message-ZZZ");
      expectNoRawErrors(s);
      const retry = await s.ui.findByRole("button", { name: s.words.retry });
      const before = s.backend.requests.length;
      fireEvent.click(retry);
      await waitFor(() => expect(s.backend.requests.length, "retry() asks the backend again").toBeGreaterThan(before));
    });
  } },
  { id: "P9.terminal-error", points: ["P9"], title: "for a terminal error offers no retry, lets the person start another conversation, and never shows the server's message", async run(a) {
    await using(a, "terminal-error", {}, async (s) => {
      await play(s);
      await settle(80);
      expect(find(s, "button", s.words.retry), "a terminal error has nothing to retry").toBeNull();
      expectNoRawErrors(s);
      expect(text(s), "what the person wrote stays").toContain("hello");
      await startAnother(s);
    });
  } },
  { id: "P9.session-limit-mid-conversation", points: ["P9"], title: "at the conversation limit offers no retry and shows no server text; another conversation can start", async run(a) {
    await using(a, "session-limit-mid-conversation", {}, async (s) => {
      await play(s);
      await settle(80);
      expect(find(s, "button", s.words.retry), "a terminal error has nothing to retry").toBeNull();
      expectNoRawErrors(s);
      await startAnother(s);
    });
  } },
  { id: "P9.daily-cap", points: ["P9"], title: "at the daily cap shows no server text and keeps what was written", async run(a) {
    await using(a, "daily-cap-mid-conversation", {}, async (s) => {
      await play(s, 2);
      await settle(80);
      expectNoRawErrors(s);
      for (const wrote of s.scenario.script.flatMap((x) => ("send" in x ? [x.send] : []))) expect(text(s), "what the person wrote stays").toContain(wrote);
      // The error is not terminal: Retry sends the message again (the cap has room by then) and the answer arrives.
      await press(s, s.words.retry);
      await waitFor(() => expect(text(s)).toContain("open Schedules and pick a time"));
    });
  } },

  // P10 ------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P10.uploaded-attachment", points: ["P10"], needs: ["pickElement"], title: "does not offer to remove an attachment that already uploaded, nor to attach after the report", async run(a) {
    if (a.words.pickElement === undefined) return;
    await using(a, "report-with-attachment", {}, async (s) => {
      await open(s);
      await pick(s);
      await say(s, "The save button does nothing");
      await waitFor(() => expect(s.backend.requestsOfKind("evidence").length, "the pointed element is uploaded once the conversation opens").toBeGreaterThan(0));
      await settle(80);
      if (s.words.removeAttachment !== undefined) expect(find(s, "button", s.words.removeAttachment), "an uploaded attachment goes with the report even if it leaves the list: no «remove»").toBeNull();
      await say(s, "On Settings > Profile");
      await confirmationShown(s);
      await press(s, optionLabel(s.scenario, "approve"));
      await waitFor(() => expect(text(s)).toMatch(s.words.reportSent));
      expect(offered(find(s, "button", s.words.pickElement!)), "attachments are not offered once the report is sent").toBe(false);
    });
  } },
  // Revisión 1 de T7, P3-4: el contrato 1.1.0 pide DECLARAR en `capabilities` lo que se ofrece; sin esto la regla sería una promesa que nadie comprueba. Sólo se puede mirar lo que el adaptador dice ofrecer (`pickElement`).
  { id: "P10.declares-what-it-offers", points: ["P10"], needs: ["pickElement"], title: "declares in `capabilities` the evidence control it offers, so the assistant invites the person to use it", async run(a) {
    if (a.words.pickElement === undefined) return;
    await using(a, "report-with-attachment", {}, async (s) => {
      await open(s);
      await say(s, "The save button does nothing");
      await waitFor(() => expect(s.backend.requestsOfKind("open").length).toBeGreaterThan(0));
      const declared = s.backend.requestsOfKind("open")[0]!.headers["x-supcoflow-capabilities"] ?? "";
      expect(declared.split(",").map((x) => x.trim()), "the interface offers pointing at an element but does not declare `pickElement` in the `capabilities` option: the assistant will never invite the person to use it").toContain("pickElement");
    });
  } },
  { id: "P10.failed-attachment", points: ["P10"], needs: ["pickElement"], title: "does not offer to retry an attachment that cannot be fixed", async run(a) {
    if (a.words.pickElement === undefined) return;
    await using(a, "attachment-failed", {}, async (s) => {
      await open(s);
      await pick(s);
      await say(s, "The export button fails");
      await waitFor(() => expect(s.backend.requestsOfKind("evidence").length).toBeGreaterThan(0));
      await settle(120);
      if (s.words.retryAttachment !== undefined) expect(find(s, "button", s.words.retryAttachment), "the cap on attachments (HTTP 429) is not retryable").toBeNull();
      expect(text(s), "the conversation goes on").toContain("Which page are you on?");
    });
  } },

  // P11 ------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P11.the-name-never-leaves", points: ["P11"], needsPerson: true, title: "never sends the person's name, and writes no session credential to the console", async run(a) {
    await using(a, "report-confirmed", { user: { id: "user-42", role: "admin", attributes: { plan: "pro" } } }, async (s) => {
      await play(s);
      await settle();
      const everything = JSON.stringify(s.backend.requests);
      for (const piece of PERSON.name.split(" ")) expect(everything, `the name of the person («${PERSON.name}») reached the backend`).not.toContain(piece);
      expect(everything, "…and a declared user does arrive").toContain("user-42");
      expect(s.logs.join("\n"), "the session id is a credential").not.toContain("ses_A");
    });
  } },

  // P12 ------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P12.one-chat", points: ["P12"], title: "destroys its chat when it goes away: a turn in flight is cut, and mounting again does not duplicate the conversation", async run(a) {
    // A turn in flight when the interface goes away is cut (destroy()): the chat of a page that is gone must not go on talking to the backend.
    const flying = await start(a, "question-answered");
    try {
      await open(flying);
      flying.backend.hold();
      await say(flying, "How do I export my data?");
      await flying.unmount();
      await waitFor(() => expect(flying.backend.requestsOfKind("open")[0]?.aborted, "the request in flight was cut when the interface went away").toBe(true));
    } finally { await flying.unmount(); }
    // Mounting again after going away starts from nothing: one message, one conversation.
    const first = await start(a, "question-answered");
    const backend = first.backend;
    await first.unmount();
    const count = backend.requests.length;
    await settle(80);
    expect(backend.requests.length, "nothing is asked after the interface went away").toBe(count);
    await using(a, "question-answered", { backend }, async (s) => {
      await play(s, 1);
      await waitFor(() => expect(text(s)).toContain("You can export"));
      expect(backend.requestsOfKind("open"), "one message, one conversation").toHaveLength(1);
    });
  } },

  // P13 ------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P13.keyboard-focus-and-live-region", points: ["P13"], title: "opens with a real button, moves the focus to the field, closes, and announces new messages", async run(a) {
    await using(a, "question-answered", {}, async (s) => {
      const trigger = s.words.trigger === null ? null : await s.ui.findByRole("button", { name: s.words.trigger });
      if (trigger !== null) expect(trigger.tabIndex, "the trigger can be reached with the keyboard").toBeGreaterThanOrEqual(0);
      await open(s);
      const field = await s.ui.findByRole("textbox", { name: s.words.messageField });
      await waitFor(() => {
        const where = s.mounted.root.getRootNode() as Document | ShadowRoot; // inside a shadow root the focused element is the shadow root's
        const active = where.activeElement;
        expect(active, "the focus goes to the message field when the chat opens").toBe(field);
      });
      await say(s, "How do I export my data?");
      const answer = await s.ui.findByText(/You can export from/);
      expect(answer.closest("[role='log'], [role='status'], [role='alert'], [role='feed'], [aria-live='polite'], [aria-live='assertive']"), "the new assistant messages are inside a live region").not.toBeNull();
      const closer = s.words.close ?? s.words.trigger;
      if (closer !== null && closer !== undefined) {
        fireEvent.click(await s.ui.findByRole("button", { name: closer }));
        await waitFor(() => expect(offered(find(s, "textbox", s.words.messageField)), "the chat can be closed with a button").toBe(false));
      }
    });
  } },

  // P14 ------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P14.reload-with-a-pending-confirmation", points: ["P14", "P6"], title: "brings the conversation back after a reload, including the pending confirmation, without opening another", async run(a) {
    await using(a, "reload-with-pending-confirmation", { saved: true }, async (s) => {
      const release = s.backend.hold();
      await open(s);
      await waitFor(() => expect(s.backend.requestsOfKind("recover")).toHaveLength(1));
      if (s.words.emptyConversation !== undefined) expect(text(s), "an empty conversation must not show while the saved one is coming back").not.toMatch(s.words.emptyConversation);
      release();
      await confirmationShown(s);
      expect(text(s)).toContain("The Save button on Settings > Profile does nothing");
      expect(s.backend.requestsOfKind("open"), "coming back is not starting a new conversation").toHaveLength(0);
      expect(s.backend.answers()).toEqual([]);
      await press(s, optionLabel(s.scenario, "approve"));
      await waitFor(() => expect(s.backend.answers()).toHaveLength(1));
      expect(s.backend.answers().map(({ requestId, optionId }) => ({ requestId, optionId }))).toEqual([{ requestId: "req_1", optionId: "approve" }]);
    });
  } },
  { id: "P14.expired-conversation", points: ["P14", "P9"], title: "when the saved conversation expired, offers no retry and opens a new one only when the person writes", async run(a) {
    await using(a, "reload-of-expired-conversation", { saved: true }, async (s) => {
      await open(s);
      await settle(100);
      expect(find(s, "button", s.words.retry), "a terminal error has nothing to retry").toBeNull();
      expect(s.backend.requestsOfKind("open"), "nothing opens by itself").toHaveLength(0);
      expectNoRawErrors(s);
      await say(s, "Hello again");
      await waitFor(() => expect(text(s)).toContain("Hi! How can I help?"));
      expect(s.backend.requestsOfKind("open")).toHaveLength(1);
    });
  } },

  // P15 ------------------------------------------------------------------------------------------------------------------------------------------------
  { id: "P15.long-paste", points: ["P15"], title: "draws a long paste collapsed, lets the person open it, and sends it whole", async run(a) {
    expect(isLongPaste(LONG_PASTE)).toBe(true);
    const last = "consectetur";
    await using(a, "question-answered", {}, async (s) => {
      await open(s);
      await paste(s, LONG_PASTE);
      const size = norm(text(s)).split(" ").filter((w) => w === last).length;
      expect(size, "while the person writes, the paste is collapsed: the whole text is not on screen").toBeLessThan(30);
      await press(s, s.words.send);
      await waitFor(() => expect(s.backend.requestsOfKind("open")).toHaveLength(1));
      expect((s.backend.requestsOfKind("open")[0]!.body as { mensaje: string }).mensaje.trim(), "the paste is sent whole").toBe(LONG_PASTE.trim());
      await settle();
      expect(norm(text(s)).split(" ").filter((w) => w === last).length, "the sent message is collapsed too").toBeLessThan(30);
      const expander = s.mounted.root.querySelector("summary, [aria-expanded='false']");
      expect(expander, "a way to open the collapsed text").not.toBeNull();
      fireEvent.click(expander!);
      await waitFor(() => expect(norm(text(s)).split(" ").filter((w) => w === last).length, "opened, the whole text can be read").toBeGreaterThanOrEqual(30));
    });
  } },
  { id: "P15.too-long-is-not-cut-silently", points: ["P15"], title: "never sends more than a message holds, and tells the person that the paste did not fit", async run(a) {
    // What is on screen when a paste fits exactly: marks and counters (sizes, «4,000 / 4,000») are the same when the paste is cut, so a number alone proves nothing.
    const fits = await using(a, "question-answered", {}, async (s) => { await open(s); await paste(s, HUGE_PASTE.slice(0, MESSAGE_MAX_LENGTH)); return norm(text(s)); });
    // How many times the size that was kept (4000, 4,000, 4.000, 4 000…) is on screen: the notice adds one to what a paste that fit already shows.
    const kept = new RegExp(String(MESSAGE_MAX_LENGTH).replace(/(?!^)(?=(\d{3})+$)/g, "[.,\\s\\u00a0']?"), "g");
    const timesKept = (t: string) => (t.match(kept) ?? []).length;
    await using(a, "question-answered", {}, async (s) => {
      await open(s);
      await paste(s, HUGE_PASTE);
      expect(timesKept(norm(text(s))), `a paste that did not fit says how much was kept (${MESSAGE_MAX_LENGTH}), one more time than the paste that fit shows it (the size of its marker or counter)`).toBeGreaterThan(timesKept(fits));
      await press(s, s.words.send);
      await waitFor(() => expect(s.backend.requestsOfKind("open")).toHaveLength(1));
      const sent = (s.backend.requestsOfKind("open")[0]!.body as { mensaje: string }).mensaje;
      expect(sent.length, `a message holds at most ${MESSAGE_MAX_LENGTH} characters`).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
      expect(sent.length, "…and what fits was kept").toBeGreaterThan(MESSAGE_MAX_LENGTH - 200);
    });
  } },
];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// What a person has to look at
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** Points (or parts of them) no test can tell. The agent that builds the interface confirms each one — with a screenshot of the running app — and says so. */
export const MANUAL: readonly { points: readonly string[]; what: string }[] = [
  { points: ["P2"], what: "The sentence that says it is an automated assistant is in the language of the app and is easy to see (the check only finds the words you gave in `words.automatedAssistant`)." },
  { points: ["P4"], what: "Streaming looks right and the typography is the app's own. If the app draws Markdown with its own library: it renders no raw HTML, no image, and a link only when its `href` has the app's origin (the checks cover the cases of the bench)." },
  { points: ["P6"], what: "The report confirmation says which attachments go with the report (the ones already uploaded) and which do not. `locale` is the app's real language. The two actions look like what they do. The id each button sends is that of the confirmation it was drawn for, never «whatever is pending now» (the core refuses an old id, but a test cannot tell the two apart while there is a single confirmation)." },
  { points: ["P8"], what: "After a report the screen promises nothing the chat does not know (who will read it, when)." },
  { points: ["P9"], what: "The text for the daily cap says the chat is not available for now, and the one for the conversation limit says another can be started. No button asks for more messages or more budget (the protocol has no way to ask)." },
  { points: ["P10"], what: "While the screen is captured the interface hides itself (`hideUi` / `showUi`), and pointing at an element cannot pick the interface (`ignore`). Each attachment shows its status (uploading, uploaded, failed)." },
  { points: ["P11"], what: "The `user` declared to the chat holds only the fields the developer chose to share. Nothing reads, parses or builds the saved conversation record (`storage`)." },
  { points: ["P13"], what: "A screen reader reads the new messages, and the whole chat is usable with the keyboard alone (Tab, Enter, Esc)." },
  { points: ["P14"], what: "`resume` is left at `true` and `storage` is not `\"none\"` (the checks mount with `\"none\"` or a saved conversation, so they cannot see it)." },
  { points: ["P15"], what: "The marker of a collapsed paste says its size, and the notice about a paste that did not fit says how much was kept, in the app's words." },
  { points: ["P16"], what: "Does not apply yet: the server does not support past conversations." },
];

/** Which checks answer for each required point of the contract: the table that `docs/conformance.md` shows and a test ties to `contract.json`. */
export function coverage(): Record<string, { checks: string[]; manual: boolean }> {
  const out: Record<string, { checks: string[]; manual: boolean }> = {};
  const touch = (p: string) => (out[p] ??= { checks: [], manual: false });
  for (const c of checks) for (const p of c.points) touch(p).checks.push(c.id);
  for (const m of MANUAL) for (const p of m.points) touch(p).manual = true;
  return out;
}

/** Register the checks for one interface. Call it once in a test file. */
export function defineConformance(adapter: Adapter): void {
  describe(`${adapter.name} follows the Supcoflow presentation contract ${CONTRACT_VERSION}`, () => {
    for (const c of checks) {
      const missing = (c.needs ?? []).filter((w) => adapter.words[w] === undefined);
      const name = `${c.points.join(", ")} — ${c.title} [${c.id}]`;
      // A check the adapter cannot apply is SKIPPED and says why: «skipped» is not «keeps the contract».
      if (missing.length > 0) it.skip(`${name} — SKIPPED: the adapter gives no words.${missing.join(", words.")}`, () => {});
      else if (c.needsPerson === true && adapter.personWired !== true) it.skip(`${name} — SKIPPED: the adapter does not put person.name where the app reads who is signed in (personWired)`, () => {});
      else it(name, async () => { await c.run(adapter); }, 20_000);
    }
  });
}
