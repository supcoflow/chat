import { describe, expect, it } from "vitest";
import { createFakeBackend } from "../testing/backend-falso";
import type { Scenario } from "../testing/escenario";
import { createSupportChat } from "./soporte";

// P2-6 de la revisión del banco de pruebas: reintentar después de que el servidor RECHAZÓ el mensaje (HTTP con su `motivo`, antes de tocar al
// agente) tiene que MANDAR el mensaje otra vez. Antes recuperaba (`GET …/eventos`): el turno nunca había corrido, el rebobinado no traía nada
// y el mensaje quedaba como entregado sin que nadie lo hubiera visto. Recuperar sigue siendo lo que se hace cuando el pedido pudo llegar (corte de red, 5xx sin motivo).

const BASE = "https://chat.test";
const ABRIR = [
  { v: 1, t: "sesion", id: "ses_D", indice: 0 },
  { v: 1, t: "usuario", texto: "How do I export my data?" },
  { v: 1, t: "asistente", texto: "Open Settings > Data and press Export." },
  { v: 1, t: "espera", indice: 5 },
];
const SEGUIR_OK = [
  { v: 1, t: "usuario", texto: "And can I schedule it?" },
  { v: 1, t: "asistente", texto: "Yes, under Schedules." },
  { v: 1, t: "espera", indice: 9 },
];
const escenario = (responses: Scenario["responses"]): Scenario => ({ name: "retry-after-refusal", description: "test", covers: [], script: [], responses });

function armar(responses: Scenario["responses"], fetchPorEncima?: (f: typeof fetch) => typeof fetch) {
  const falso = createFakeBackend(escenario(responses), { backendUrl: BASE });
  const chat = createSupportChat({
    tenantId: "tnt_a",
    projectId: "proj_b",
    backendUrl: BASE,
    autoContext: false,
    storage: "none",
    fetch: fetchPorEncima === undefined ? falso.fetch : fetchPorEncima(falso.fetch),
  });
  return { falso, chat };
}
const pedidos = (f: ReturnType<typeof armar>["falso"]) => f.requests.map((r) => `${r.method} ${r.path}`);
const usuarios = (chat: ReturnType<typeof armar>["chat"]) => chat.getState().messages.filter((m) => m.role === "user").map((m) => m.text);

describe("reintentar tras un rechazo HTTP a mitad de la charla", () => {
  it("el tope de mensajes: retry() REENVÍA el mismo mensaje (no recupera), sin duplicarlo en la lista", async () => {
    const { falso, chat } = armar([{ stream: ABRIR }, { http: 429, body: { ok: false, motivo: "tope_de_mensajes" } }, { stream: SEGUIR_OK }]);
    await chat.send("How do I export my data?");
    await chat.send("And can I schedule it?");
    expect(chat.getState().error).toMatchObject({ code: "tope_de_mensajes", terminal: false });
    await chat.retry();
    const seguir = falso.requests.filter((r) => r.kind === "follow");
    expect(seguir).toHaveLength(2);
    expect(seguir[1]!.body).toEqual(seguir[0]!.body);
    expect(seguir[1]!.body).toEqual({ indice: 5, mensaje: "And can I schedule it?" });
    expect(falso.requests.some((r) => r.kind === "recover")).toBe(false);
    const s = chat.getState();
    expect(s.error).toBeNull();
    expect(s.busy).toBe(false);
    expect(usuarios(chat)).toEqual(["How do I export my data?", "And can I schedule it?"]);
    expect(s.messages.at(-1)).toMatchObject({ role: "assistant", text: "Yes, under Schedules." });
    expect(s.messages.every((m) => m.role !== "user" || m.pending === false)).toBe(true);
  });

  it("si el reenvío vuelve a ser rechazado, el siguiente retry() lo vuelve a mandar", async () => {
    const tope = { http: 429, body: { ok: false, motivo: "tope_de_mensajes" } };
    const { falso, chat } = armar([{ stream: ABRIR }, tope, tope, { stream: SEGUIR_OK }]);
    await chat.send("How do I export my data?");
    await chat.send("And can I schedule it?");
    await chat.retry();
    expect(chat.getState().error).toMatchObject({ code: "tope_de_mensajes" });
    await chat.retry();
    expect(falso.requests.filter((r) => r.kind === "follow")).toHaveLength(3);
    expect(chat.getState().error).toBeNull();
    expect(usuarios(chat)).toEqual(["How do I export my data?", "And can I schedule it?"]);
  });

  it("una respuesta a una pregunta rechazada también se reenvía tal cual", async () => {
    const pregunta = [
      { v: 1, t: "sesion", id: "ses_D", indice: 0 },
      { v: 1, t: "usuario", texto: "help" },
      { v: 1, t: "pregunta", requestId: "rq1", kind: "question", prompt: "Which one?", opciones: [{ id: "a", label: "A", style: "default" }], libre: false },
      { v: 1, t: "espera", indice: 3 },
    ];
    const { falso, chat } = armar([{ stream: pregunta }, { http: 429, body: { ok: false, motivo: "tope_de_mensajes" } }, { stream: [{ v: 1, t: "asistente", texto: "ok" }, { v: 1, t: "espera", indice: 6 }] }]);
    await chat.send("help");
    const q = chat.getState().pendingQuestion!;
    await chat.answer(q.id, { optionId: "a" });
    expect(chat.getState().error).toMatchObject({ code: "tope_de_mensajes" });
    await chat.retry();
    const seguir = falso.requests.filter((r) => r.kind === "follow");
    expect(seguir).toHaveLength(2);
    expect(seguir[1]!.body).toEqual(seguir[0]!.body);
    expect(falso.requests.some((r) => r.kind === "recover")).toBe(false);
    expect(chat.getState().error).toBeNull();
  });

  it("un corte de red NO se reenvía: el pedido pudo llegar, así que retry() recupera", async () => {
    let n = 0;
    const { falso, chat } = armar([{ stream: ABRIR }, { stream: [{ v: 1, t: "usuario", texto: "And can I schedule it?" }, { v: 1, t: "asistente", texto: "Yes." }, { v: 1, t: "espera", indice: 9 }] }], (f) => (url, init) => {
      if (String(url).endsWith("/api/chat/sesion/ses_D") && init?.method === "POST" && ++n === 1) return Promise.reject(new TypeError("Failed to fetch"));
      return f(url, init);
    });
    await chat.send("How do I export my data?");
    await chat.send("And can I schedule it?");
    expect(chat.getState().error).toMatchObject({ code: "red" });
    await chat.retry();
    expect(falso.requests.map((r) => r.kind).filter((k) => k !== "availability")).toEqual(["open", "recover"]);
  });

  it("un 5xx sin `motivo` (una pasarela, que pudo ver el pedido) tampoco se reenvía: se recupera", async () => {
    const { falso, chat } = armar([{ stream: ABRIR }, { stream: [{ v: 1, t: "espera", indice: 9 }] }], (f) => async (url, init) => {
      if (String(url).endsWith("/api/chat/sesion/ses_D") && init?.method === "POST") return new Response("<html>Bad gateway</html>", { status: 502 });
      return f(url, init);
    });
    await chat.send("How do I export my data?");
    await chat.send("And can I schedule it?");
    expect(chat.getState().error).toMatchObject({ code: "http_502" });
    await chat.retry();
    expect(falso.requests.map((r) => r.kind).filter((k) => k !== "availability")).toEqual(["open", "recover"]);
  });

  it("una conversación nueva olvida el mensaje rechazado: retry() no lo resucita", async () => {
    const { falso, chat } = armar([{ stream: ABRIR }, { http: 429, body: { ok: false, motivo: "tope_de_mensajes" } }]);
    await chat.send("How do I export my data?");
    await chat.send("And can I schedule it?");
    chat.newConversation();
    await chat.retry();
    expect(falso.requests.filter((r) => r.kind === "follow")).toHaveLength(1);
  });
});
