// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrokenChat, type Fault } from "./broken-chat";
import { checks, type Adapter } from "./checks";

// The checks must have TEETH: an interface that breaks a point of the contract has to fail the check that guards it. `BrokenChat` is a small interface that is wrong in one way at
// a time; each case mounts it with a fault and expects that check to fail, and mounts it WITHOUT the fault and expects the same check to pass (so the failure is the fault's).

const adapter = (fault: Fault): Adapter => ({
  name: `a chat with the fault «${fault}»`,
  personWired: true,
  words: {
    trigger: /^help$/i, messageField: /^message$/i, send: /^send$/i, retry: /^retry$/i, newConversation: /^new conversation$/i,
    automatedAssistant: /automated assistant/i, working: /working/i, reportSent: /report sent/i, reportNotSent: /report was not sent/i, somethingWrong: /something went wrong/i,
  },
  async mount({ person, ...options }) {
    const view = render(<BrokenChat fault={fault} {...options} {...(fault === "name-leaks" ? { appVersion: `v1 for ${person.name}` } : {})} />);
    return { root: view.container, unmount: () => view.unmount() };
  },
});

// [the fault, the check that guards it, why]
const CASES: [Fault, string][] = [
  ["always-offered", "P1.not-offered-when-unavailable"],
  ["typed-yes-approves", "P6.two-actions-and-no-automatic-yes"],
  ["auto-approve", "P6.two-actions-and-no-automatic-yes"],
  ["markdown-report", "P6.shows-everything-as-plain-text"],
  ["truncated-report", "P6.shows-everything-as-plain-text"],
  ["links-as-html", "P4.links-only-to-your-site"],
  ["no-working-indicator", "P5.working-indicator"],
  ["no-new-conversation", "P8.after-a-report"],
  ["shows-server-message", "P9.unknown-code"],
  ["retry-after-terminal", "P9.terminal-error"],
  ["no-live-region", "P13.keyboard-focus-and-live-region"],
  ["silent-cut", "P15.too-long-is-not-cut-silently"],
  ["name-leaks", "P11.the-name-never-leaves"],
  // Revision 1 (P2-2): the three holes found by mutation. A paste cut in silence where the marker or a counter has numbers; the server's text for a code the interface DOES know; a core nobody destroys.
  ["message-on-known-code", "P9.daily-cap"],
  ["message-on-known-code", "P3.what-the-person-writes-stays"],
  ["never-destroys", "P12.one-chat"],
];

// Revision 1 (P2-3): interfaces that are different but right. The checks ask for what is shown and asked, never for how it is built.
const FINE: [Fault, string][] = [
  ["hidden-working-indicator", "P5.working-indicator"],
  ["report-in-blockquote", "P6.shows-everything-as-plain-text"],
  ["report-in-pre-code", "P6.shows-everything-as-plain-text"],
  ["more-button", "P9.session-limit-mid-conversation"],
  ["more-button", "P9.daily-cap"],
  // Round 2 (P2-1): the docs say a chat closed with `inert` counts as closed; the check that opens it must be able to.
  ["inert-closed-panel", "P2.automated-assistant"],
  ["inert-closed-panel", "P6.approve-carries-the-id"],
  ["inert-closed-panel", "P13.keyboard-focus-and-live-region"],
];

describe("the conformance checks fail an interface that breaks the contract", () => {
  it.each(CASES)("«%s» fails %s — and the same interface without the fault passes it", async (fault, id) => {
    const check = checks.find((c) => c.id === id)!;
    expect(check, `there is a check ${id}`).toBeDefined();
    await check.run(adapter("none"));
    await expect(check.run(adapter(fault))).rejects.toThrow();
  }, 40_000);

  it.each(FINE)("«%s» is not rejected by %s", async (variant, id) => {
    const check = checks.find((c) => c.id === id)!;
    expect(check, `there is a check ${id}`).toBeDefined();
    await check.run(adapter(variant));
  }, 40_000);
});
