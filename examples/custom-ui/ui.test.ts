// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { createSupportChat } from "@supcoflow/chat/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountCustomChat } from "./ui";

// El ejemplo de interfaz propia, probado como un navegador lo usaría: contra un `fetch` guionado, sin ningún backend. Lo que se mira es el DOM.
const nd = (...evs: object[]) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";
const NDJSON = { "content-type": "application/x-ndjson" };
afterEach(() => { document.body.innerHTML = ""; sessionStorage.clear(); document.getElementById("supcoflow-chat-selector")?.remove(); vi.unstubAllGlobals(); });
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function fetchPorUrl(rutas: Record<string, (string | Response)[]>) {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const clave = Object.keys(rutas).filter((k) => url.includes(k)).sort((a, b) => b.length - a.length)[0];
    // El sondeo del acuerdo de datos (antes de la primera acción) contesta «ok, sin acuerdo» solo y no cuenta entre las llamadas de la charla.
    if (clave === undefined && url.includes("/api/chat/estado")) return Response.json({ ok: true, motivo: null, marca: null });
    llamadas.push({ url, init });
    if (clave === undefined) throw new Error(`fetch inesperado: ${url}`);
    const r = rutas[clave]!.shift() ?? nd({ v: 1, t: "espera", indice: 99 });
    return r instanceof Response ? r : new Response(r, { status: 200, headers: NDJSON });
  }) as unknown as typeof fetch;
  return { fn, llamadas };
}
function montar(fetchFn: typeof fetch, opciones: { storage?: "session" | "none" } = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const chat = createSupportChat({ tenantId: "t", projectId: "p", backendUrl: "https://chat.test", storage: opciones.storage ?? "none", fetch: fetchFn });
  const desmontar = mountCustomChat(root, chat);
  return { root, chat, desmontar };
}
async function escribir(root: HTMLElement, texto: string) {
  const input = root.querySelector("form input:not([type])") as HTMLInputElement;
  input.value = texto;
  (root.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await tick();
}
const textos = (root: HTMLElement, sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent);

const PREGUNTA = { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "This is what I'll send:\n\nTitle\n\nBody\n\nShall I send it?", opciones: [{ id: "approve", label: "Yes (server label)", style: "primary" }, { id: "cancel", label: "No (server label)", style: "default" }], libre: false };

describe("la interfaz propia de ejemplo", () => {
  it("streaming: el texto se dibuja a medida que llega, con sus pasos, y se cierra al final", async () => {
    let empujar!: (s: string) => void;
    let cerrar!: () => void;
    const cuerpo = new ReadableStream<Uint8Array>({ start(c) { const e = new TextEncoder(); empujar = (s) => c.enqueue(e.encode(s)); cerrar = () => c.close(); } });
    const { fn } = fetchPorUrl({ "/api/chat/sesion": [new Response(cuerpo, { status: 200, headers: NDJSON })] });
    const { root } = montar(fn);
    void escribir(root, "How do I export?");
    empujar(nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "How do I export?" }, { v: 1, t: "actividad", que: "leyendo_la_guia" }));
    await tick();
    expect(root.querySelector(".busy")?.textContent).toBe("Reading the guide…");
    expect((root.querySelector("form input:not([type])") as HTMLInputElement).disabled).toBe(true); // un turno a la vez
    empujar(nd({ v: 1, t: "paso", que: "guia_leida", seccion: "Exports" }, { v: 1, t: "texto", delta: "From Rep" }));
    await tick();
    expect(root.querySelector(".assistant.streaming p")?.textContent).toBe("From Rep");
    empujar(nd({ v: 1, t: "texto", delta: "orts." }, { v: 1, t: "asistente", texto: "From Reports." }, { v: 1, t: "espera", indice: 5 }));
    cerrar();
    await tick();
    expect(textos(root, ".user")).toEqual(["How do I export?"]);
    expect(textos(root, ".assistant .step")).toEqual(["Read the guide · Exports"]);
    expect(textos(root, ".assistant p")).toEqual(["From Reports."]);
    expect(root.querySelector(".streaming")).toBeNull();
    expect(root.querySelector(".busy")).toBeNull();
  });

  it("el texto del modelo se dibuja como TEXTO, nunca como HTML", async () => {
    const { fn } = fetchPorUrl({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "asistente", texto: "<img src=x onerror=alert(1)><b>hola</b>" }, { v: 1, t: "espera", indice: 2 })] });
    const { root } = montar(fn);
    await escribir(root, "hi");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".assistant b")).toBeNull();
    expect(root.querySelector(".assistant p")?.textContent).toBe("<img src=x onerror=alert(1)><b>hola</b>");
  });

  it("la confirmación del reporte: los botones son los del SERVIDOR; «approve» manda el reporte y aparece la tarjeta con el número", async () => {
    const { fn, llamadas } = fetchPorUrl({
      "/api/chat/sesion/s1": [nd({ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "approved", optionId: "approve" }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_42" }, { v: 1, t: "espera", indice: 9 })],
      "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "it is broken" }, { v: 1, t: "paso", que: "resumen_preparado" }, PREGUNTA, { v: 1, t: "espera", indice: 4 })],
    });
    const { root } = montar(fn);
    await escribir(root, "it is broken");
    expect(textos(root, ".assistant p")).toEqual(["This is what I'll send:\n\nTitle\n\nBody\n\nShall I send it?"]); // todo lo que se manda, entero
    expect(textos(root, ".question button")).toEqual(["Yes (server label)", "No (server label)"]);
    expect(llamadas).toHaveLength(1); // nada se mandó todavía
    (root.querySelector(".option.primary") as HTMLButtonElement).click();
    await tick();
    expect(JSON.parse(llamadas[1]!.init!.body as string)).toEqual({ indice: 4, respuesta: { requestId: "r1", optionId: "approve" } });
    expect(root.querySelector(".question")).toBeNull();
    expect(root.querySelector(".outcome.reported")?.textContent).toBe("Report sent · rep_42");
    expect((root.querySelector(".pick") as HTMLButtonElement).disabled).toBe(true); // reportado: no se ofrece adjuntar más
  });

  it("el segundo botón corrige: contesta «cancel» y el reporte no se manda", async () => {
    const { fn, llamadas } = fetchPorUrl({
      "/api/chat/sesion/s1": [nd({ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "cancelled", optionId: "cancel" }, { v: 1, t: "asistente", texto: "What should I change?" }, { v: 1, t: "espera", indice: 8 })],
      "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, PREGUNTA, { v: 1, t: "espera", indice: 4 })],
    });
    const { root } = montar(fn);
    await escribir(root, "it is broken");
    ([...root.querySelectorAll(".option")][1] as HTMLButtonElement).click();
    await tick();
    expect(JSON.parse(llamadas[1]!.init!.body as string).respuesta.optionId).toBe("cancel");
    expect(root.querySelector(".outcome")).toBeNull();
  });

  it("un botón viejo (de la confirmación que se rechazó) no aprueba la nueva", async () => {
    const preg = (id: string) => ({ ...PREGUNTA, requestId: id, prompt: `Draft ${id}` });
    const { fn, llamadas } = fetchPorUrl({
      "/api/chat/sesion/s1": [nd({ v: 1, t: "pregunta_resuelta", requestId: "A", outcome: "cancelled", optionId: "cancel" }, { v: 1, t: "espera", indice: 5 }), nd(preg("B"), { v: 1, t: "espera", indice: 8 })],
      "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, preg("A"), { v: 1, t: "espera", indice: 3 })],
    });
    const { root } = montar(fn);
    await escribir(root, "it is broken");
    const botonViejo = root.querySelector(".option.primary") as HTMLButtonElement; // la tarjeta de A
    ([...root.querySelectorAll(".option")][1] as HTMLButtonElement).click(); // se rechaza A
    await tick();
    await escribir(root, "corrected"); // llega B
    expect(textos(root, ".assistant p").at(-1)).toBe("Draft B");
    const pedidos = llamadas.length;
    botonViejo.click(); // el botón de A, que quedó en una variable
    await tick();
    expect(llamadas).toHaveLength(pedidos);
    expect(root.querySelector(".outcome")).toBeNull();
  });

  it("recarga: otra instancia con el mismo almacén rebobina la charla y la confirmación sigue pendiente", async () => {
    const abrir = fetchPorUrl({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "it is broken" }, PREGUNTA, { v: 1, t: "espera", indice: 4 })] });
    const primera = montar(abrir.fn, { storage: "session" });
    await escribir(primera.root, "it is broken");
    primera.desmontar();
    primera.chat.destroy();
    // «recargar la pestaña»: todo el JavaScript se pierde, queda el sessionStorage
    const recargar = fetchPorUrl({ "/api/chat/sesion/s1/eventos": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "it is broken" }, PREGUNTA, { v: 1, t: "espera", indice: 4 })] });
    const segunda = montar(recargar.fn, { storage: "session" });
    await segunda.chat.ready;
    await tick();
    expect(recargar.llamadas[0]!.url).toBe("https://chat.test/api/chat/sesion/s1/eventos?desde=0");
    expect(textos(segunda.root, ".user")).toEqual(["it is broken"]);
    expect(textos(segunda.root, ".question button")).toEqual(["Yes (server label)", "No (server label)"]);
  });

  it("adjuntos: señalar un elemento lo muestra en la barra y lo sube al servidor cuando hay conversación; el modelo no recibe ni su id", async () => {
    const { fn, llamadas } = fetchPorUrl({
      "/api/evidencias": [Response.json({ ok: true, evidencia_id: "evd_SECRETO" }, { status: 201 })],
      "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })],
    });
    const objetivo = document.createElement("button");
    objetivo.textContent = "Save";
    document.body.appendChild(objetivo);
    const { root } = montar(fn);
    await escribir(root, "hi");
    (root.querySelector(".pick") as HTMLButtonElement).click();
    await tick();
    document.elementFromPoint = () => objetivo;
    const overlay = document.getElementById("supcoflow-chat-selector")!;
    overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick(10);
    expect(textos(root, ".chip")).toEqual(["button «Save» · uploaded"]);
    const subida = llamadas.find((l) => l.url.endsWith("/api/evidencias"))!;
    expect(JSON.parse(subida.init!.body as string)).toMatchObject({ session_id: "s1", evidencia: { tipo: "elemento" } });
    expect(new Headers(subida.init!.headers).get("x-supcoflow-sdk")).toMatch(/^core\//);
    expect(root.textContent).not.toContain("evd_SECRETO");
  });

  it("errores: un fallo no terminal ofrece «Retry» y reintenta; uno terminal no", async () => {
    const { fn, llamadas } = fetchPorUrl({ "/api/chat/sesion": [Response.json({ ok: false, motivo: "tope_de_mensajes" }, { status: 429 }), nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "asistente", texto: "Back." }, { v: 1, t: "espera", indice: 2 })] });
    const { root } = montar(fn);
    await escribir(root, "hi");
    expect(root.querySelector(".error")?.textContent).toBe("Something failed (tope_de_mensajes).");
    (root.querySelector(".retry") as HTMLButtonElement).click();
    await tick();
    expect(llamadas).toHaveLength(2);
    expect(root.querySelector(".error")).toBeNull();
    expect(textos(root, ".assistant p")).toEqual(["Back."]);

    const terminal = fetchPorUrl({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s2", indice: 0 }, { v: 1, t: "error", codigo: "limite_de_sesion", mensaje: "x", terminal: true })] });
    document.body.innerHTML = "";
    const otra = montar(terminal.fn);
    await escribir(otra.root, "hi");
    expect(otra.root.querySelector(".error")?.textContent).toBe("This conversation ended (limite_de_sesion).");
    expect(otra.root.querySelector(".retry")).toBeNull();
  });

  it("«New conversation» después del reporte vuelve a dejar escribir en una conversación nueva", async () => {
    const { fn, llamadas } = fetchPorUrl({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" }, { v: 1, t: "espera", indice: 2 }), nd({ v: 1, t: "sesion", id: "s2", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
    const { root } = montar(fn);
    await escribir(root, "bug");
    (root.querySelector(".new") as HTMLButtonElement).click();
    await tick();
    expect(root.querySelector(".new")).toBeNull();
    await escribir(root, "another");
    expect(llamadas.map((l) => l.url)).toEqual(["https://chat.test/api/chat/sesion", "https://chat.test/api/chat/sesion"]);
  });

  it("desmontar saca la interfaz y deja de escuchar", async () => {
    const { fn } = fetchPorUrl({});
    const { root, desmontar } = montar(fn);
    expect(root.children.length).toBeGreaterThan(0);
    desmontar();
    expect(root.children.length).toBe(0);
  });
});

describe("lo que el ejemplo promete", () => {
  const dir = `${import.meta.dirname}/`;
  const fuentes = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("usa SÓLO la entrada pública: ningún import de `src/`, de `dist/` ni de otro módulo del paquete", () => {
    expect(fuentes.sort()).toEqual(["main.ts", "ui.ts"]);
    for (const f of fuentes) {
      const imports = [...readFileSync(`${dir}${f}`, "utf8").matchAll(/^import .*? from "([^"]+)"/gm)].map((m) => m[1]);
      for (const i of imports) expect(["@supcoflow/chat/core", "./ui"], `${f} importa «${i}»`).toContain(i);
    }
  });

  it("sigue siendo una interfaz de menos de cien líneas: si crece, es otro ejemplo", () => {
    expect(readFileSync(`${dir}ui.ts`, "utf8").split("\n").length).toBeLessThan(100);
  });
});
