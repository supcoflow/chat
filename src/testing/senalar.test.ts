// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createSupportChat } from "../core/soporte";
import { createFakeBackend } from "./backend-falso";
import { completeElementPick } from "./senalar";

// `completeElementPick` es lo que un test de interfaz necesita para recorrer los escenarios con adjunto (`attachment-failed`, `report-with-attachment`) sin conocer el id del
// selector ni cómo se hace clic sobre él (revisión 1, P2-5).

afterEach(() => { document.body.innerHTML = ""; });
const crear = (nombre: string) => {
  const b = createFakeBackend(nombre);
  return { b, chat: createSupportChat({ tenantId: "t", projectId: "p", backendUrl: b.url, fetch: b.fetch, storage: "none", autoContext: false }) };
};

describe("completeElementPick", () => {
  it("elige el elemento que se le da: resuelve «picked» y queda en los adjuntos", async () => {
    const { chat } = crear("attachment-failed");
    const boton = document.createElement("button");
    boton.textContent = "Export";
    document.body.appendChild(boton);
    expect(await completeElementPick(chat, boton)).toBe("picked");
    expect(chat.getState().attachments).toMatchObject([{ kind: "element", label: "button «Export»", status: "pending" }]);
    chat.destroy();
  });

  it("T6: con una función en lugar del chat (el clic de TU botón), espera el selector, hace clic y dice si se abrió", async () => {
    const { chat } = crear("attachment-failed");
    const objetivo = document.body.appendChild(Object.assign(document.createElement("button"), { textContent: "Export" }));
    expect(await completeElementPick(() => void chat.pickElement(), objetivo)).toBe(true);
    expect(chat.getState().attachments).toMatchObject([{ kind: "element", label: "button «Export»" }]);
    chat.destroy();
  });

  it("T6: si la función no abre ningún selector, resuelve false en vez de colgarse", async () => {
    expect(await completeElementPick(() => undefined)).toBe(false);
  });

  it("sin elemento, crea uno suyo en la página", async () => {
    const { chat } = crear("attachment-failed");
    expect(await completeElementPick(chat)).toBe("picked");
    expect(chat.getState().attachments).toHaveLength(1);
    chat.destroy();
  });

  it("recorre el escenario del adjunto fallido de punta a punta, con el guion del escenario", async () => {
    const { b, chat } = crear("attachment-failed");
    for (const paso of b.scenario.script) {
      if ("pickElement" in paso) await completeElementPick(chat);
      else if ("send" in paso) await chat.send(paso.send);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(chat.getState().attachments).toMatchObject([{ status: "failed", failure: "tope_de_evidencias", retryable: false }]);
    expect(b.requestsOfKind("evidence")).toHaveLength(1);
    chat.destroy();
  });

  it("si el selector no se abre (el acuerdo de datos no deja señalar), devuelve lo que contestó el núcleo en vez de colgarse", async () => {
    const { chat } = crear("data-agreement-closed");
    expect(await completeElementPick(chat)).toBe("not_allowed");
    chat.destroy();
  });
});
