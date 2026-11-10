// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { montarChat } from "./montar";

// Revisión 2, P1-1, en el widget: recargar la pestaña con una charla de varios turnos tiene que dibujarlos TODOS, con la confirmación del último todavía pendiente.
const nd = (...evs: object[]) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; sessionStorage.clear(); });
const esperar = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("recarga de una charla de varios turnos", () => {
  it("dibuja los tres turnos, deja la confirmación vigente con sus botones y guarda el cursor del último borde", async () => {
    sessionStorage.setItem("supcoflow-chat/t/p", JSON.stringify({ id: "s1", indice: 9 }));
    vi.stubGlobal("fetch", vi.fn(async (entrada: string | URL | Request) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.includes("/api/chat/estado")) return Response.json({ ok: true, motivo: null });
      if (url.includes("/eventos?desde=0")) {
        return new Response(nd(
          { v: 1, t: "usuario", texto: "first" }, { v: 1, t: "asistente", texto: "First answer." }, { v: 1, t: "espera", indice: 3 },
          { v: 1, t: "usuario", texto: "second" }, { v: 1, t: "asistente", texto: "Second answer." }, { v: 1, t: "espera", indice: 6 },
          { v: 1, t: "usuario", texto: "third" }, { v: 1, t: "pregunta", requestId: "req_now", kind: "tool-approval", prompt: "Current report", opciones: [{ id: "approve", label: "Yes", style: "primary" }, { id: "cancel", label: "No", style: "default" }], libre: false },
          { v: 1, t: "espera", indice: 9 },
        ), { headers: { "content-type": "application/x-ndjson" } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test" });
    await esperar();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    expect([...sr.querySelectorAll(".scf-msg")].map((m) => m.textContent)).toEqual(["first", "First answer.", "second", "Second answer.", "third", "Current report"]);
    expect([...sr.querySelectorAll(".scf-opcion")].map((b) => b.textContent)).toEqual(["Yes", "No"]);
    expect(JSON.parse(sessionStorage.getItem("supcoflow-chat/t/p")!)).toEqual({ id: "s1", indice: 9 });
  });
});
