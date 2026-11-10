// @vitest-environment happy-dom
import { afterEach } from "vitest";
import { montarChat } from "../src/montar";
import { claveDeSesion } from "../src/sesion-guardada";
import { defineConformance, type Adapter, type Mounted } from "./checks";

// The official widget (`@supcoflow/chat/widget.js`, `montarChat`) against the same checks as any interface built on the core: it is the REFERENCE implementation of the
// contract, and the plan (T6) asks that it passes. Its interface lives in a shadow root, so `root` is the element inside it; the fake backend is installed as the global `fetch` (the widget
// takes no `fetch` option) and the saved conversation of a reload scenario is copied to the tab's `sessionStorage`, where the widget keeps its own.

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; sessionStorage.clear(); document.body.innerHTML = ""; });

const adapter: Adapter = {
  name: "the official widget",
  personWired: true, // `usuario.nombre` of the widget is where it reads the signed-in person's name (for its greeting), and it must not leave the browser
  words: {
    trigger: /open the help chat/i,
    close: /^minimize$/i,
    messageField: /ask or tell us what happened/i,
    send: /send the message/i,
    retry: /^retry$/i,
    newConversation: /new conversation/i,
    automatedAssistant: /automated assistant/i,
    working: /thinking|reading the support guide/i,
    reportSent: /report sent/i,
    reportNotSent: /confirmation is out of date/i,
    somethingWrong: /couldn't send/i,
    emptyConversation: /how can we help/i,
    freeText: { field: /type your answer/i, send: /^reply$/i },
    pickElement: /^pick an element$/i,
    removeAttachment: /^remove$/i,
    retryAttachment: /^retry$/i,
  },
  async mount(o): Promise<Mounted> {
    globalThis.fetch = o.fetch;
    if (o.storage === "none") sessionStorage.clear(); // a new tab: the widget always keeps its conversation in the tab's sessionStorage
    else {
      const key = claveDeSesion(o.tenantId, o.projectId);
      const saved = o.storage.getItem(key);
      if (saved !== null) sessionStorage.setItem(key, saved);
    }
    const contenedor = document.body.appendChild(document.createElement("div"));
    const montado = montarChat(contenedor, {
      tenantId: o.tenantId,
      projectId: o.projectId,
      backendUrl: o.backendUrl,
      contextoAutomatico: o.autoContext,
      ...(o.user === undefined ? { usuario: { nombre: o.person.name } } : { usuario: { id: o.user.id ?? "", rol: o.user.role ?? "", atributos: o.user.attributes ?? {}, nombre: o.person.name } }),
    });
    // The widget draws inside a shadow root, in a `div` after its `<style>`: that div is where to look (testing-library queries take an element).
    const shadow = (contenedor.querySelector("[data-supcoflow-chat]") as HTMLElement).shadowRoot!;
    return { root: shadow.lastElementChild as HTMLElement, unmount: () => montado.desmontar() };
  },
};

defineConformance(adapter);
