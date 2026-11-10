// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESTADO_OK, fetchGuionado, nd, tick } from "../../test-support/fetch-guionado-react";
import { createSupportChat, type Availability, type ChatState, type SupportChat } from "../core";
import { EMPTY_CHAT_STATE, useSupportChat, type UseSupportChat, type UseSupportChatOptions } from "./use-support-chat";

// El hook `useSupportChat` (`@supcoflow/chat/react`): envuelve el núcleo público para React. Lo que se prueba es lo que un componente copiado en el repo de un
// developer da por hecho: que nada se crea al renderizar (Next lo renderiza en el servidor), que el chat vive mientras el componente viva, que la
// disponibilidad se sondea una vez y que el estado que se dibuja es siempre el último que el núcleo tiene.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "https://chat.test";
const TODO_PERMITIDO = { screenshots: true, elements: true, pageAndBrowser: true };
let raiz: Root | null = null;
let contenedor: HTMLElement;

beforeEach(() => {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
});
afterEach(async () => {
  if (raiz !== null) await act(async () => raiz!.unmount());
  raiz = null;
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

/** Monta un componente que sólo guarda lo que el hook devuelve en cada render. */
function montar(opciones: Partial<UseSupportChatOptions>, fetchFn: typeof fetch, estricto = false) {
  const vistos: UseSupportChat[] = [];
  function Sonda(props: { opciones: UseSupportChatOptions }): ReactElement {
    vistos.push(useSupportChat(props.opciones));
    return createElement("span", { "data-chat": "" });
  }
  const completas: UseSupportChatOptions = { tenantId: "t", projectId: "p", backendUrl: BASE, autoContext: false, storage: "none", fetch: fetchFn, ...opciones };
  const arbol = (o: UseSupportChatOptions): ReactElement => {
    const sonda = createElement(Sonda, { opciones: o });
    return estricto ? createElement(StrictMode, null, sonda) : sonda;
  };
  raiz = createRoot(contenedor);
  const r = raiz;
  return {
    vistos,
    ultimo: () => vistos[vistos.length - 1]!,
    pintar: (o: UseSupportChatOptions = completas) => act(async () => r.render(arbol(o))),
    completas,
    arbol,
  };
}

describe("EMPTY_CHAT_STATE", () => {
  it("está congelado también por dentro: nadie puede ensuciar el estado que comparten el render del servidor y el primero del navegador", () => {
    expect(() => (EMPTY_CHAT_STATE.messages as unknown[]).push(1)).toThrow(TypeError);
    expect(() => (EMPTY_CHAT_STATE.attachments as unknown[]).push(1)).toThrow(TypeError);
    expect(() => { (EMPTY_CHAT_STATE.allows as { elements: boolean }).elements = false; }).toThrow(TypeError);
  });

  it("es exactamente el estado de un chat recién creado (si el núcleo suma un campo al estado, este test avisa)", () => {
    const { fn } = fetchGuionado({});
    const chat = createSupportChat({ tenantId: "t", projectId: "p", backendUrl: BASE, storage: "none", autoContext: false, fetch: fn });
    expect(EMPTY_CHAT_STATE).toEqual(chat.getState());
    chat.destroy();
  });
});

describe("useSupportChat", () => {
  it("no crea nada al renderizar: en el servidor (Next) no hay chat, ni pedidos, y el estado es el vacío", () => {
    const { fn, llamadas } = fetchGuionado({});
    const m = montar({}, fn);
    function Sonda(): ReactElement {
      const h = useSupportChat(m.completas);
      return createElement("p", null, `${h.chat === null ? "sin chat" : "con chat"} · ${h.state.messages.length} mensajes · ${h.availability === null ? "sin sondeo" : "sondeado"} · ${h.available ? "disponible" : "no disponible"}`);
    }
    expect(renderToString(createElement(Sonda))).toContain("sin chat · 0 mensajes · sin sondeo · no disponible");
    expect(llamadas).toEqual([]);
  });

  it("al montar crea el chat, sondea la disponibilidad UNA vez y la entrega; el estado inicial está vacío", async () => {
    const { fn, llamadas } = fetchGuionado({ "/api/chat/estado": [ESTADO_OK] });
    const m = montar({}, fn);
    await m.pintar();
    await act(async () => tick());
    const h = m.ultimo();
    expect(h.chat).not.toBeNull();
    expect(h.available).toBe(true);
    expect(h.availability).toEqual<Availability>({ available: true, status: 200, reason: null, allows: TODO_PERMITIDO });
    expect(h.state.messages).toEqual([]);
    expect(llamadas.filter((l) => l.ruta.startsWith("/api/chat/estado"))).toHaveLength(1);
  });

  it("antes de la respuesta del sondeo no hay disponibilidad: quien dibuja no muestra nada todavía", async () => {
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(ESTADO_OK)));
    const { fn } = fetchGuionado({ "/api/chat/estado": [() => lenta] });
    const m = montar({}, fn);
    await m.pintar();
    expect(m.ultimo().availability).toBeNull();
    expect(m.ultimo().available).toBe(false);
    await act(async () => { soltar(); await tick(); });
    expect(m.ultimo().available).toBe(true);
  });

  it("si el chat no está activo para este origen: available=false con el motivo, onAvailability lo recibe y en localhost se dice en la consola", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("http://localhost:3000/");
    const { fn } = fetchGuionado({ "/api/chat/estado": [new Response(JSON.stringify({ ok: false, motivo: "origen_no_admitido" }), { status: 403 })] });
    const onAvailability = vi.fn();
    const m = montar({ onAvailability }, fn);
    await m.pintar({ ...m.completas, onAvailability });
    await act(async () => tick());
    expect(m.ultimo().available).toBe(false);
    expect(m.ultimo().availability).toEqual<Availability>({ available: false, status: 403, reason: "origen_no_admitido", allows: TODO_PERMITIDO });
    expect(onAvailability).toHaveBeenCalledTimes(1);
    expect(onAvailability).toHaveBeenCalledWith({ available: false, status: 403, reason: "origen_no_admitido", allows: TODO_PERMITIDO });
    expect(aviso).toHaveBeenCalledWith("[supcoflow/chat]", expect.objectContaining({ reason: "origen_no_admitido" }));
  });

  it("fuera de localhost un chat no disponible NO escribe en la consola del sitio del cliente", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("https://app.cliente.com/");
    const { fn } = fetchGuionado({ "/api/chat/estado": [new Response(JSON.stringify({ ok: false, motivo: "tope_de_mensajes" }), { status: 429 })] });
    const m = montar({}, fn);
    await m.pintar();
    await act(async () => tick());
    expect(m.ultimo().availability?.reason).toBe("tope_de_mensajes");
    expect(aviso).not.toHaveBeenCalled();
  });

  it("el estado que devuelve es el del núcleo en cada cambio: el texto del usuario aparece, el del asistente llega por fragmentos y la pregunta queda a la vista", async () => {
    const { fn } = fetchGuionado({
      "/api/chat/estado": [ESTADO_OK],
      "/api/chat/sesion": [
        nd({ t: "sesion", indice: 0 }, { t: "usuario", texto: "no guarda" }, { t: "texto", delta: "Entend" }, { t: "texto", delta: "í" }, { t: "asistente", texto: "Entendí. ¿Lo mando?" }, { t: "pregunta", requestId: "q1", kind: "tool-approval", prompt: "Título\n\nCuerpo", opciones: [{ id: "approve", label: "Yes, report it", style: "primary" }, { id: "cancel", label: "No, I want to fix something", style: "default" }], libre: false }, { t: "espera", indice: 5 }),
      ],
    });
    const m = montar({}, fn);
    await m.pintar();
    await act(async () => tick());
    const estados: ChatState[] = [];
    await act(async () => { await m.ultimo().chat!.send("no guarda"); });
    estados.push(m.ultimo().state);
    expect(estados[0]!.messages.map((x) => x.role)).toEqual(["user", "assistant", "assistant"]);
    expect(estados[0]!.pendingQuestion).toMatchObject({ id: "q1", kind: "report_confirmation" });
    expect(estados[0]!.busy).toBe(false);
  });

  it("un cambio ya hecho antes de suscribirse no se pierde: el primer estado después del montaje es el actual", async () => {
    const guardado = JSON.stringify({ id: "s1", indice: 3 });
    sessionStorage.setItem("supcoflow-chat/t/p", guardado);
    const { fn } = fetchGuionado({
      "/api/chat/estado": [ESTADO_OK],
      "/api/chat/sesion/s1/eventos": [nd({ t: "usuario", texto: "hola" }, { t: "asistente", texto: "¿en qué te ayudo?" }, { t: "espera", indice: 3 })],
    });
    const m = montar({ storage: "session" }, fn);
    await m.pintar({ ...m.completas, storage: "session" });
    await act(async () => tick(10));
    expect(m.ultimo().state.messages.map((x) => (x.role === "outcome" ? "outcome" : x.text))).toEqual(["hola", "¿en qué te ayudo?"]);
    expect(m.ultimo().state.hasSession).toBe(true);
  });

  it("`ready` (P14): es false hasta que la charla guardada terminó de rebobinarse, y recién ahí hay mensajes; sin charla guardada es true en cuanto existe el chat", async () => {
    sessionStorage.setItem("supcoflow-chat/t/p", JSON.stringify({ id: "s1", indice: 1 }));
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(nd({ t: "usuario", texto: "hola" }, { t: "asistente", texto: "buen día" }, { t: "espera", indice: 1 }))));
    const { fn } = fetchGuionado({ "/api/chat/estado": [ESTADO_OK], "/api/chat/sesion/s1/eventos": [() => lenta] });
    const m = montar({ storage: "session" }, fn);
    await m.pintar({ ...m.completas, storage: "session" });
    await act(async () => tick());
    expect(m.ultimo().available).toBe(true);
    expect(m.ultimo().ready).toBe(false);
    expect(m.ultimo().state.messages).toEqual([]);
    await act(async () => { soltar(); await tick(); });
    expect(m.ultimo().ready).toBe(true);
    expect(m.ultimo().state.messages).toHaveLength(2);
  });

  it("`ready` sin charla guardada, y en el servidor / antes de crear el chat, es false", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": [ESTADO_OK] });
    const m = montar({}, fn);
    function Sonda(): ReactElement {
      return createElement("p", null, String(useSupportChat(m.completas).ready));
    }
    expect(renderToString(createElement(Sonda))).toContain("false");
    await m.pintar();
    await act(async () => tick());
    expect(m.ultimo().ready).toBe(true);
  });

  it("`ready` en StrictMode: mientras el rebobinado del chat que quedó vivo no termina sigue en false, aunque el del chat destruido ya haya llegado", async () => {
    sessionStorage.setItem("supcoflow-chat/t/p", JSON.stringify({ id: "s1", indice: 1 }));
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(nd({ t: "usuario", texto: "hola" }, { t: "espera", indice: 1 }))));
    const { fn } = fetchGuionado({
      "/api/chat/estado": [ESTADO_OK, ESTADO_OK],
      // El primer chat (el que StrictMode destruye) se rebobina enseguida; el segundo, el que queda, tarda.
      "/api/chat/sesion/s1/eventos": [nd({ t: "usuario", texto: "hola" }, { t: "espera", indice: 1 }), () => lenta],
    });
    const m = montar({ storage: "session" }, fn, true);
    await m.pintar({ ...m.completas, storage: "session" });
    await act(async () => tick(10));
    expect(m.ultimo().available).toBe(true);
    expect(m.ultimo().ready).toBe(false);
    await act(async () => { soltar(); await tick(10); });
    expect(m.ultimo().ready).toBe(true);
  });

  it("`ready` al cambiar de proyecto: vuelve a false mientras el chat nuevo se rebobina (sólo se miran los renders POSTERIORES al cambio) y es true cuando termina", async () => {
    sessionStorage.setItem("supcoflow-chat/t/otro", JSON.stringify({ id: "s2", indice: 1 }));
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(nd({ t: "usuario", texto: "hola" }, { t: "espera", indice: 1 }))));
    const { fn } = fetchGuionado({ "/api/chat/estado": [ESTADO_OK, ESTADO_OK], "/api/chat/sesion/s2/eventos": [() => lenta] });
    const m = montar({ storage: "session" }, fn);
    await m.pintar({ ...m.completas, storage: "session" });
    await act(async () => tick(10));
    expect(m.ultimo().ready).toBe(true);
    const antes = m.vistos.length;
    await m.pintar({ ...m.completas, storage: "session", projectId: "otro" });
    await act(async () => tick(10));
    const despues = m.vistos.slice(antes);
    expect(despues.length).toBeGreaterThan(0);
    expect(despues.every((v) => !v.ready)).toBe(true);
    expect(m.ultimo().available).toBe(true);
    await act(async () => { soltar(); await tick(10); });
    expect(m.ultimo().ready).toBe(true);
  });

  it("un `onAvailability` que lanza no tumba el chat: el error se reporta y el chat sigue disponible", async () => {
    const reportado = vi.fn();
    vi.stubGlobal("reportError", reportado);
    const { fn } = fetchGuionado({ "/api/chat/estado": [ESTADO_OK] });
    const onAvailability = vi.fn(() => { throw new Error("del developer"); });
    const m = montar({ onAvailability }, fn);
    await m.pintar({ ...m.completas, onAvailability });
    await act(async () => tick());
    expect(onAvailability).toHaveBeenCalledTimes(1);
    expect(reportado).toHaveBeenCalledWith(expect.objectContaining({ message: "del developer" }));
    expect(m.ultimo().available).toBe(true);
    vi.unstubAllGlobals();
  });

  it("`onAvailability` es el último que se pasó, no el del primer render (las opciones se leen al llegar el sondeo)", async () => {
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(ESTADO_OK)));
    const { fn } = fetchGuionado({ "/api/chat/estado": [() => lenta] });
    const primero = vi.fn();
    const segundo = vi.fn();
    const m = montar({ onAvailability: primero }, fn);
    await m.pintar({ ...m.completas, onAvailability: primero });
    await m.pintar({ ...m.completas, onAvailability: segundo });
    await act(async () => { soltar(); await tick(); });
    expect(primero).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledTimes(1);
  });

  it("al desmontar destruye el chat: lo que estaba en vuelo se corta (la señal del pedido queda abortada)", async () => {
    const { fn, llamadas } = fetchGuionado({
      "/api/chat/estado": [ESTADO_OK],
      "/api/chat/sesion": [() => new Promise<Response>(() => {})],
    });
    const m = montar({}, fn);
    await m.pintar();
    await act(async () => tick());
    void m.ultimo().chat!.send("hola");
    await act(async () => tick());
    const pedido = llamadas.find((l) => l.ruta === "/api/chat/sesion")!;
    expect(pedido.signal?.aborted).toBe(false);
    await act(async () => raiz!.unmount());
    raiz = null;
    expect(pedido.signal?.aborted).toBe(true);
  });

  it("en StrictMode (monta, desmonta y vuelve a montar) queda UN chat vivo y funcionando; el primero está destruido", async () => {
    sessionStorage.setItem("supcoflow-chat/t/p", JSON.stringify({ id: "s1", indice: 1 }));
    const { fn, llamadas } = fetchGuionado({
      "/api/chat/estado": [ESTADO_OK, ESTADO_OK],
      "/api/chat/sesion/s1/eventos": [nd({ t: "usuario", texto: "hola" }, { t: "asistente", texto: "buen día" }, { t: "espera", indice: 1 }), nd({ t: "usuario", texto: "hola" }, { t: "asistente", texto: "buen día" }, { t: "espera", indice: 1 })],
    });
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = montar({ storage: "session" }, fn, true);
    await m.pintar({ ...m.completas, storage: "session" });
    await act(async () => tick(10));
    const h = m.ultimo();
    expect(h.available).toBe(true);
    expect(h.state.messages.map((x) => (x.role === "outcome" ? "" : x.text))).toEqual(["hola", "buen día"]);
    // StrictMode crea dos chats (el efecto corre, se limpia y corre otra vez), pero React sólo llega a dibujar el segundo, y el primero quedó destruido:
    // su recarga se abortó y la del segundo no.
    const distintos = new Set(m.vistos.map((v) => v.chat).filter((c): c is SupportChat => c !== null));
    expect(distintos.size).toBe(1);
    const recargas = llamadas.filter((l) => l.ruta.includes("/eventos"));
    expect(recargas).toHaveLength(2);
    expect(recargas[0]!.signal?.aborted).toBe(true);
    expect(recargas[1]!.signal?.aborted).toBe(false);
    expect(errores).not.toHaveBeenCalled();
  });

  it("en StrictMode onAvailability se entrega UNA vez (la del chat que quedó vivo) y un mensaje sale UNA vez", async () => {
    const { fn, llamadas } = fetchGuionado({
      "/api/chat/estado": [ESTADO_OK, ESTADO_OK],
      "/api/chat/sesion": [nd({ t: "sesion", indice: 0 }, { t: "usuario", texto: "hola" }, { t: "asistente", texto: "buen día" }, { t: "espera", indice: 2 })],
    });
    const onAvailability = vi.fn();
    const m = montar({ onAvailability }, fn, true);
    await m.pintar({ ...m.completas, onAvailability });
    await act(async () => tick(10));
    expect(onAvailability).toHaveBeenCalledTimes(1);
    await act(async () => { await m.ultimo().chat!.send("hola"); });
    expect(llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/api/chat/sesion")).toHaveLength(1);
    expect(m.ultimo().state.messages.map((x) => (x.role === "outcome" ? "" : x.text))).toEqual(["hola", "buen día"]);
  });

  it("en StrictMode se sondea una vez por chat (dos chats, el primero destruido) y lo que se dibuja es sólo el segundo", async () => {
    const { fn, llamadas } = fetchGuionado({ "/api/chat/estado": [ESTADO_OK, ESTADO_OK] });
    const m = montar({}, fn, true);
    await m.pintar();
    await act(async () => tick(10));
    const vivo = m.ultimo().chat!;
    const todos = [...new Set(m.vistos.map((v) => v.chat).filter((c): c is SupportChat => c !== null))];
    expect(todos).toEqual([vivo]);
    const sondeos = llamadas.filter((l) => l.ruta.startsWith("/api/chat/estado"));
    expect(sondeos).toHaveLength(2);
    expect(m.ultimo().available).toBe(true);
  });

  it("cambiar de proyecto crea otro chat y destruye el anterior; cambiar el usuario o la versión de la app NO recrea el chat (se leen al crearlo)", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": [ESTADO_OK, ESTADO_OK, ESTADO_OK] });
    const m = montar({}, fn);
    await m.pintar();
    await act(async () => tick());
    const primero = m.ultimo().chat!;
    await m.pintar({ ...m.completas, user: { id: "u2" }, appVersion: "9.9.9" });
    await act(async () => tick());
    expect(m.ultimo().chat).toBe(primero);
    await m.pintar({ ...m.completas, projectId: "otro" });
    await act(async () => tick());
    const segundo = m.ultimo().chat!;
    expect(segundo).not.toBe(primero);
    // Al cambiar de proyecto el estado y la disponibilidad del anterior no se arrastran: se vuelve a sondear.
    expect(m.vistos.some((v) => v.chat === segundo && v.availability === null)).toBe(true);
    expect(m.ultimo().available).toBe(true);
  });

  it("un sondeo que llega después de desmontar no toca nada (sin avisos de React ni onAvailability tardío)", async () => {
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(ESTADO_OK)));
    const { fn } = fetchGuionado({ "/api/chat/estado": [() => lenta] });
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const onAvailability = vi.fn();
    const m = montar({ onAvailability }, fn);
    await m.pintar({ ...m.completas, onAvailability });
    await act(async () => raiz!.unmount());
    raiz = null;
    soltar();
    await tick();
    expect(onAvailability).not.toHaveBeenCalled();
    expect(errores).not.toHaveBeenCalled();
  });

  it("el hook no deja pasar nada que el núcleo no admite: sin tenantId el error es el del núcleo, no un chat a medias", async () => {
    const { fn } = fetchGuionado({});
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = montar({ tenantId: "" }, fn);
    await expect(m.pintar()).rejects.toThrow(/tenantId/);
    errores.mockRestore();
  });
});
