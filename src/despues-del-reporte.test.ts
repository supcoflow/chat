// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { montarChat } from "./montar";

// Revisión de las herramientas del chat, 2026-10-30, §4.2 y §7-2/5, con el reducer y los componentes REALES (sin modelo, sin red): lo que el control «Remove» dice
// es lo que hace, la confirmación del reporte lista lo que lo acompaña, y la tarjeta de después no promete nada del equipo ni deja la salida a la imaginación.
const ESTADO_OK = { ok: true, motivo: null };
const nd = (...evs: object[]) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";

function fetchGuionado(opts: { alSeguir: string[] }) {
  const seguir = [...opts.alSeguir];
  return vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    void init;
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const ndjson = { "content-type": "application/x-ndjson" };
    if (url.includes("/api/chat/estado")) return new Response(JSON.stringify(ESTADO_OK), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/evidencias")) return new Response(JSON.stringify({ ok: true, evidencia_id: "evd_1" }), { status: 201, headers: { "content-type": "application/json" } });
    if (/\/api\/chat\/sesion\/s1$/.test(url)) return new Response(seguir.shift() ?? nd({ v: 1, t: "espera", indice: 99 }), { status: 200, headers: ndjson });
    if (url.endsWith("/api/chat/sesion")) return new Response(nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "el botón guardar no hace nada" }, { v: 1, t: "asistente", texto: "Understood." }, { v: 1, t: "espera", indice: 3 }), { status: 200, headers: ndjson });
    throw new Error(`fetch inesperado: ${url}`);
  });
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; sessionStorage.clear(); document.getElementById("supcoflow-chat-selector")?.remove(); });
async function esperarRender(): Promise<void> { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); }

async function montarYSenalar(fetchMock: ReturnType<typeof fetchGuionado>) {
  vi.stubGlobal("fetch", fetchMock);
  const objetivo = document.createElement("button");
  objetivo.textContent = "Guardar";
  document.body.appendChild(objetivo);
  const cont = document.createElement("div");
  document.body.appendChild(cont);
  montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
  await esperarRender();
  const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
  (sr.querySelector('button[aria-label="Pick an element"]') as HTMLButtonElement).click();
  await esperarRender();
  document.elementFromPoint = () => objetivo;
  const overlay = document.getElementById("supcoflow-chat-selector")!;
  overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true }));
  overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await esperarRender();
  return sr;
}

async function enviar(sr: ShadowRoot, texto: string) {
  const textarea = sr.querySelector(".scf-textarea") as HTMLTextAreaElement;
  textarea.value = texto;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await esperarRender();
  (sr.querySelector(".scf-enviar") as HTMLButtonElement).click();
  await esperarRender();
  await esperarRender();
}

const quitar = (sr: ShadowRoot) => sr.querySelectorAll('.scf-adjuntos button[aria-label="Remove"]');

describe("«Remove» sólo donde tiene efecto real (§4.2)", () => {
  it("antes de que exista la sesión el adjunto NO subió: «Remove» sí lo saca de verdad", async () => {
    const sr = await montarYSenalar(fetchGuionado({ alSeguir: [] }));
    expect(sr.querySelectorAll(".scf-adjunto").length).toBe(1);
    expect(quitar(sr).length).toBe(1);
    (quitar(sr)[0] as HTMLButtonElement).click();
    await esperarRender();
    expect(sr.querySelectorAll(".scf-adjunto").length).toBe(0);
  });

  it("ya subido (se enlaza al reporte aunque se saque de la lista): NO hay «Remove», y a la vista dice qué pasa con él", async () => {
    const sr = await montarYSenalar(fetchGuionado({ alSeguir: [] }));
    await enviar(sr, "el botón guardar no hace nada");
    expect(sr.querySelectorAll(".scf-adjunto").length).toBe(1); // el adjunto sigue en la lista
    expect(quitar(sr).length).toBe(0); // y ya no ofrece un control que no cumple lo que dice
    expect(sr.querySelector(".scf-aviso")!.textContent).toBe("Attached. It goes with your report if you send one.");
  });
});

describe("la confirmación del reporte lista lo que acompaña al envío; la tarjeta de después no promete nada", () => {
  const pregunta = nd(
    { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "This is what I'll send to the team:\n\nSave fails\n\nNothing happens.\n\nShall I send it?", libre: false, opciones: [{ id: "approve", label: "Yes, report it", style: "primary" }, { id: "cancel", label: "No, I want to fix something", style: "default" }] },
    { v: 1, t: "espera", indice: 5 },
  );
  const enviado = nd({ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "approved", optionId: "approve" }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_0123456789abcdef" }, { v: 1, t: "asistente", texto: "Sent." }, { v: 1, t: "espera", indice: 9 });

  it("la pregunta del reporte trae «Your attachments that go with it: 1 pointed element.»; Approve → tarjeta «Report sent.» con el número, sin «The team will review it», sin promesa, con «New conversation»", async () => {
    const sr = await montarYSenalar(fetchGuionado({ alSeguir: [pregunta, enviado] }));
    await enviar(sr, "el botón guardar no hace nada"); // abre la sesión y sube el adjunto
    await enviar(sr, "that's all I know"); // el modelo (guionado) pide la confirmación
    const nota = sr.querySelector(".scf-pregunta .scf-pregunta-nota");
    expect(nota?.textContent).toBe("Your attachments that go with it: 1 pointed element.");

    (sr.querySelector(".scf-opcion--primary") as HTMLButtonElement).click();
    await esperarRender();
    await esperarRender();
    const tarjeta = sr.querySelector(".scf-desenlace--reportado")!;
    expect(tarjeta.textContent).toContain("Report sent.");
    expect(tarjeta.textContent).toContain("Report rep_0123456789abcdef");
    expect(tarjeta.textContent).toContain("Nothing written here from now on is added to it.");
    expect(tarjeta.textContent).not.toMatch(/will review|team will|follow|answer/i);
    expect([...tarjeta.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["New conversation"]);
  });

  it("sin adjuntos no se agrega ninguna línea a la pregunta", async () => {
    vi.stubGlobal("fetch", fetchGuionado({ alSeguir: [pregunta] }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    await enviar(sr, "hola");
    await enviar(sr, "otra cosa");
    expect(sr.querySelector(".scf-pregunta")).not.toBeNull();
    expect(sr.querySelector(".scf-pregunta-nota")).toBeNull();
  });
});

// Revisión 1, P2-5: el motor enlaza la evidencia UNA vez, al crear el reporte. Con el reporte ya enviado, adjuntar más no iría con ninguno.
describe("después del reporte no se ofrece adjuntar, y lo ya subido dice que FUE con el reporte", () => {
  const pregunta = nd(
    { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "This is what I'll send to the team:\n\nSave fails\n\nNothing happens.\n\nShall I send it?", libre: false, opciones: [{ id: "approve", label: "Yes, report it", style: "primary" }, { id: "cancel", label: "No, I want to fix something", style: "default" }] },
    { v: 1, t: "espera", indice: 5 },
  );
  const enviado = nd({ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "approved", optionId: "approve" }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_0123456789abcdef" }, { v: 1, t: "espera", indice: 9 });

  it("antes del reporte hay herramientas de evidencia; tras la tarjeta desaparecen, el aviso cambia, y «New conversation» las devuelve", async () => {
    const sr = await montarYSenalar(fetchGuionado({ alSeguir: [pregunta, enviado] }));
    await enviar(sr, "el botón guardar no hace nada");
    expect(sr.querySelector('button[aria-label="Pick an element"]')).not.toBeNull();
    await enviar(sr, "that's all I know");
    (sr.querySelector(".scf-opcion--primary") as HTMLButtonElement).click();
    await esperarRender();
    await esperarRender();
    expect(sr.querySelector(".scf-desenlace--reportado")).not.toBeNull();
    // sin herramientas para adjuntar más
    for (const nombre of ["Pick an element", "Take a screenshot", "Attach an image"]) expect(sr.querySelector(`button[aria-label="${nombre}"]`), nombre).toBeNull();
    expect(sr.querySelector(".scf-aviso")!.textContent).toBe("Attached. It was sent with your report.");
    expect(sr.textContent).not.toContain("if you send one");
    // y «New conversation» las devuelve
    ([...sr.querySelectorAll(".scf-desenlace--reportado button")].find((b) => b.textContent === "New conversation") as HTMLButtonElement).click();
    await esperarRender();
    expect(sr.querySelector('button[aria-label="Pick an element"]')).not.toBeNull();
  });
});
