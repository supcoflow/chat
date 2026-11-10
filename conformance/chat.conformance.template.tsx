// The adapter of YOUR chat interface for the Supcoflow conformance checks. Copy this file next to your tests, name it `chat.conformance.test.tsx`, and change the three
// things marked with «ADAPT» — nothing else. `checks.ts` goes next to it, unedited. Run it with vitest (the checks use `expect(value, message)`, which jest's `expect` does
// not accept). Your test environment needs a DOM (happy-dom or jsdom) and `@testing-library/react`, which your app probably has already.
//
// What the checks read: the requests your interface makes to a FAKE backend, the text it shows and the accessible roles and names of its controls. Never its classes,
// its `data-*` attributes, its layout or its styling. Docs: docs/conformance.md.

// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { defineConformance, type Adapter } from "./checks";
// ADAPT 1: your chat component. It takes the options of `useSupportChat` (`tenantId`, `projectId`, `backendUrl`, `fetch`, `storage`, `locale`, `user`…) as props; if yours
// reads them from somewhere else (a provider, a config module), put them there inside `mount`. Here: the unstyled example the package ships.
import { SupportChat } from "../examples/react/SupportChat";

const adapter: Adapter = {
  name: "the React example",
  // ADAPT 3b: set `true` once `mount` puts `options.person.name` where your app reads who is signed in. Until then the P11 check (the name never reaches the backend) is
  // SKIPPED and says so: with nothing to find, it would pass on its own. The example has no session, so it stays off.
  personWired: false,

  // ADAPT 2: your words — what your interface calls its controls and what it says, in the language of your app. These are the English words of the example.
  words: {
    trigger: /^help$/i, // the control that opens the chat; `null` if the chat is always on screen
    messageField: /^message$/i, // the accessible name of the field the person writes in
    send: /^send$/i,
    retry: /^retry$/i,
    newConversation: /^new conversation$/i,
    automatedAssistant: /automated assistant/i, // P2
    working: /working|reading the guide/i, // P5: what it shows while the assistant works
    reportSent: /report sent/i, // P8
    reportNotSent: /report was not sent/i, // P6: when the confirmation was out of date
    somethingWrong: /something went wrong/i, // P9: the failure for an error code it does not know
    emptyConversation: /how can i help/i, // P14: the greeting of an empty conversation, if it has one
    // Only if the interface offers them (P10). Leave them out and those checks are SKIPPED (the report says so): a skipped check is not a pass.
    pickElement: /^pick an element$/i,
    removeAttachment: /^remove$/i,
    retryAttachment: /^try again$/i,
  },

  // ADAPT 3: render your chat the way your app does, with the options you are given, and say where to look (`root`) and how to take it down.
  // `options.person.name` is the name of the signed-in person of this test. PUT IT WHERE YOUR APP READS WHO IS SIGNED IN (the mock of your auth provider, the
  // value `useUser()` returns, the session your app reads…): the P11 check looks for that name in everything the interface sends, and if the name never reaches your app
  // it has nothing to find and passes by itself. The example below has no session at all, so there is nowhere to put it.
  async mount(options) {
    const { person: _person, ...chatOptions } = options;
    const view = render(<SupportChat {...chatOptions} />);
    return { root: view.container, unmount: () => view.unmount() };
  },
};

defineConformance(adapter);
