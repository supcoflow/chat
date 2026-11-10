// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { montarChat } from "./montar";

// El pegado largo con el widget MONTADO de verdad (pedido del dueño, 2026-10-30): en el compositor queda «[pasted text]», lo que viaja al backend es el texto COMPLETO,
// y el mensaje enviado se dibuja colapsado y se expande.
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; sessionStorage.clear(); });
const esperar = async (n = 6): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

const LOG = Array.from({ length: 40 }, (_, i) => `2026-10-30 10:00:${String(i).padStart(2, "0")} ERROR something failed (code ${i})`).join("\n"); // 40 líneas
const ENORME = "z".repeat(6000);

async function montar() {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    llamadas.push({ url, init });
    if (url.includes("/api/chat/estado")) return new Response(JSON.stringify({ ok: true, motivo: null }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response('{"v":1,"t":"sesion","id":"s1","indice":0}\n{"v":1,"t":"usuario","texto":"x"}\n{"v":1,"t":"asistente","texto":"Thanks."}\n{"v":1,"t":"espera","indice":4}\n', { status: 200, headers: { "content-type": "application/x-ndjson" } });
  }));
  const cont = document.createElement("div");
  document.body.appendChild(cont);
  montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline", contextoAutomatico: false });
  await esperar();
  const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
  const ta = sr.querySelector<HTMLTextAreaElement>("textarea.scf-textarea")!;
  const pegar = (texto: string) => {
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: (t: string) => (t === "text/plain" ? texto : "") } });
    ta.dispatchEvent(ev);
    return ev;
  };
  const enviar = async () => { sr.querySelector<HTMLFormElement>("form.scf-compositor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await esperar(); };
  const cuerpoDelEnvio = () => JSON.parse(llamadas.find((l) => l.url.endsWith("/api/chat/sesion"))!.init!.body as string) as { mensaje: string };
  return { sr, ta, pegar, enviar, cuerpoDelEnvio };
}

describe("el widget con un pegado largo", () => {
  it("el textarea muestra «[pasted text]» y no el log; la marca va donde estaba el cursor", async () => {
    const { ta, pegar } = await montar();
    ta.value = "Mirá este error: ";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const ev = pegar(LOG);
    await esperar();
    expect(ev.defaultPrevented).toBe(true);
    expect(ta.value).toBe("Mirá este error: [pasted text]");
  });

  it("se manda COMPLETO: la marca se reemplaza por el texto entero (y el mensaje enviado se dibuja colapsado y se expande)", async () => {
    const { sr, ta, pegar, enviar, cuerpoDelEnvio } = await montar();
    ta.value = "Mirá: ";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
    ta.setSelectionRange(6, 6);
    pegar(LOG);
    await esperar();
    await enviar();
    expect(cuerpoDelEnvio().mensaje).toBe(`Mirá: ${LOG}`);
    const burbuja = sr.querySelector(".scf-msg--usuario")!;
    expect(burbuja.textContent).toContain("[pasted text]");
    expect(burbuja.textContent).not.toContain("something failed (code 5)");
    expect(ta.value).toBe(""); // el compositor quedó vacío
    burbuja.querySelector<HTMLButtonElement>("button")!.click();
    await esperar();
    expect(sr.querySelector(".scf-pegado-texto")!.textContent).toBe(`Mirá: ${LOG}`);
  });

  it("un pegado corto entra al textarea como siempre (no se intercepta)", async () => {
    const { pegar } = await montar();
    expect(pegar("una frase corta").defaultPrevented).toBe(false);
  });

  it("si la persona borra la marca, el texto pegado no se manda", async () => {
    const { ta, pegar, enviar, cuerpoDelEnvio } = await montar();
    pegar(LOG);
    await esperar();
    ta.value = "mejor no";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
    await enviar();
    expect(cuerpoDelEnvio().mensaje).toBe("mejor no");
  });

  it("lo que no entra en el mensaje (4.000) se corta donde termina: nunca viaja algo que el servidor rechazaría", async () => {
    const { pegar, enviar, cuerpoDelEnvio } = await montar();
    pegar(ENORME);
    await esperar();
    await enviar();
    expect(cuerpoDelEnvio().mensaje).toHaveLength(4000);
  });

  it("revisión 2, N1: un pegado que no entra entero AVISA cuántos caracteres entraron, y lo que viaja es lo que se avisó", async () => {
    const { sr, pegar, enviar, cuerpoDelEnvio } = await montar();
    pegar(ENORME);
    await esperar();
    expect(sr.querySelector(".scf-pegados + .scf-aviso, .scf-caja .scf-aviso")!.textContent).toContain("Only the first 4,000 characters of the pasted text fit in one message.");
    await enviar();
    expect(cuerpoDelEnvio().mensaje).toHaveLength(4000);
  });

  it("revisión 2, N1: con el mensaje lleno no entra nada y se dice", async () => {
    const { sr, ta, pegar } = await montar();
    ta.value = "y".repeat(4000);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
    pegar(LOG);
    await esperar();
    expect(ta.value).toBe("y".repeat(4000));
    expect(sr.querySelector(".scf-caja .scf-aviso")!.textContent).toContain("doesn't fit");
  });

  it("revisión 2, N2: antes de mandar se ve la primera línea y el tamaño de lo pegado, y se puede abrir", async () => {
    const { sr, pegar } = await montar();
    pegar(LOG);
    await esperar();
    const li = sr.querySelector(".scf-pegados li")!;
    expect(li.textContent).toContain("40 lines");
    expect(li.textContent).toContain("2026-10-30 10:00:00 ERROR something failed (code 0)");
    li.querySelector<HTMLButtonElement>("button")!.click();
    await esperar();
    expect(sr.querySelector(".scf-pegados .scf-pegado-texto")!.textContent).toBe(LOG);
  });

  it("revisión 2, N4: un pegado que no entró no deja un cursor pendiente que salte en la próxima edición", async () => {
    const { ta, pegar } = await montar();
    ta.value = "y".repeat(4000);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
    ta.setSelectionRange(5, 5);
    pegar(LOG);
    await esperar();
    ta.value = "y".repeat(3999);
    ta.setSelectionRange(3999, 3999);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
    expect(ta.selectionStart).toBe(3999);
  });

  it("lo que se escribe después de un pegado respeta el tope del mensaje completo, no el de la marca", async () => {
    const { ta, pegar } = await montar();
    pegar("y".repeat(3500));
    await esperar();
    expect(Number(ta.getAttribute("maxlength"))).toBe(4000 - (3500 - "[pasted text]".length));
  });
});
