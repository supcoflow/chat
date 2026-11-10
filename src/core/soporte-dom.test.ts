// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupportChat } from "./soporte";

// pickElement toca el DOM de la página: el overlay del selector se inyecta fuera de la interfaz del que usa el núcleo. Estas pruebas cierran los caminos
// en los que la promesa podía quedar colgada para siempre (el selector se cancela en silencio cuando otro lo reemplaza o cuando se destruye el chat).
afterEach(() => { document.body.innerHTML = ""; document.getElementById("supcoflow-chat-selector")?.remove(); vi.unstubAllGlobals(); });
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const ESTADO_OK = (async () => Response.json({ ok: true, motivo: null })) as typeof fetch;
const crear = () => createSupportChat({ tenantId: "t", projectId: "p", storage: "none", fetch: ESTADO_OK });
// El núcleo averigua el acuerdo de datos UNA vez antes de la primera acción (`pickElement` incluida); estas pruebas miran el selector, no el sondeo: lo dejan resuelto antes.
const crearListo = async () => {
  const chat = crear();
  await chat.checkAvailability();
  return chat;
};

describe("pickElement", () => {
  it("elegir un elemento resuelve «picked» y lo deja en la barra (pendiente: todavía no hay conversación)", async () => {
    const objetivo = document.createElement("button");
    objetivo.textContent = "Save";
    document.body.appendChild(objetivo);
    const chat = await crearListo();
    const r = chat.pickElement();
    await tick();
    document.elementFromPoint = () => objetivo;
    const overlay = document.getElementById("supcoflow-chat-selector")!;
    overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(await r).toBe("picked");
    expect(chat.getState().attachments).toMatchObject([{ kind: "element", label: "button «Save»", status: "pending" }]);
  });

  it("Esc resuelve «cancelled» y saca el overlay", async () => {
    const chat = await crearListo();
    const r = chat.pickElement();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await r).toBe("cancelled");
    expect(document.getElementById("supcoflow-chat-selector")).toBeNull();
  });

  it("si otro pickElement reemplaza al selector, el primero resuelve «cancelled» en vez de quedar colgado", async () => {
    const chat = await crearListo();
    const primero = chat.pickElement();
    const segundo = chat.pickElement();
    expect(await primero).toBe("cancelled");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await segundo).toBe("cancelled");
  });

  it("destroy mientras se está eligiendo resuelve «cancelled» y saca el overlay", async () => {
    const chat = await crearListo();
    const r = chat.pickElement();
    chat.destroy();
    expect(await r).toBe("cancelled");
    expect(document.getElementById("supcoflow-chat-selector")).toBeNull();
  });

  it("con la barra llena resuelve «limit» sin abrir ningún overlay", async () => {
    const chat = await crearListo();
    const objetivo = document.createElement("button");
    document.body.appendChild(objetivo);
    document.elementFromPoint = () => objetivo;
    for (let i = 0; i < 4; i++) {
      const r = chat.pickElement();
      const overlay = document.getElementById("supcoflow-chat-selector")!;
      overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 1, bubbles: true }));
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await r;
    }
    expect(chat.getState().canAttachMore).toBe(false);
    expect(await chat.pickElement()).toBe("limit");
    expect(document.getElementById("supcoflow-chat-selector")).toBeNull();
  });

  it("dos chats (de proyectos distintos) en la misma página: si el segundo abre su selector, el primero resuelve «cancelled» en vez de quedar colgado (revisión 1, P2-4)", async () => {
    const uno = await crearListo();
    const dos = createSupportChat({ tenantId: "t2", projectId: "p2", storage: "none", fetch: ESTADO_OK });
    await dos.checkAvailability();
    const primero = uno.pickElement();
    const segundo = dos.pickElement();
    expect(await primero).toBe("cancelled");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await segundo).toBe("cancelled");
    // y el primero puede volver a elegir después
    const otra = uno.pickElement();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await otra).toBe("cancelled");
  });

  it("el acuerdo de datos sin permiso para elementos: «not_allowed», sin overlay (T0.5)", async () => {
    const chat = createSupportChat({ tenantId: "t", projectId: "p", storage: "none", fetch: (async () => Response.json({ ok: true, permite: { capturas: true, elementos: false, pagina_y_navegador: true } })) as typeof fetch });
    expect(await chat.pickElement()).toBe("not_allowed"); // sondea solo, sin que nadie llame antes a checkAvailability()
    expect(document.getElementById("supcoflow-chat-selector")).toBeNull();
    expect(chat.getState().allows).toEqual({ screenshots: true, elements: false, pageAndBrowser: true });
  });
});
