import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatState } from "./tipos";
import { capacidadesOfrecidas, createSupportChat } from "./soporte";
import { SDK_VERSION } from "./version";

// El núcleo público de punta a punta contra un `fetch` guionado: lo que una interfaz propia ve de verdad. Ninguna prueba habla con un backend.
const nd = (...evs: object[]) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";
const NDJSON = { "content-type": "application/x-ndjson" };

interface Llamada { url: string; init: RequestInit | undefined }
function fetchGuionado(rutas: { [prefijo: string]: (string | Response)[] }) {
  const llamadas: Llamada[] = [];
  const restantes = Object.fromEntries(Object.entries(rutas).map(([k, v]) => [k, [...v]]));
  const fn = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const clave = Object.keys(restantes).filter((k) => url.includes(k)).sort((a, b) => b.length - a.length)[0];
    // El sondeo del acuerdo de datos (antes de la primera acción) contesta «ok, sin acuerdo» solo y no se cuenta entre las `llamadas` de la charla.
    if (clave === undefined && url.includes("/api/chat/estado")) return Response.json({ ok: true, motivo: null, marca: null });
    llamadas.push({ url, init });
    if (clave === undefined) throw new Error(`fetch inesperado: ${url}`);
    const r = restantes[clave]!.shift() ?? nd({ v: 1, t: "espera", indice: 99 });
    return r instanceof Response ? r : new Response(r, { status: 200, headers: NDJSON });
  }) as unknown as typeof fetch;
  return { fn, llamadas };
}
/** Un `fetch` propio al que el sondeo del acuerdo de datos (`/api/chat/estado`) no le llega: contesta «ok, sin acuerdo» solo. */
const sinSondeo = (fn: (u: string, init?: RequestInit) => Promise<Response>): typeof fetch =>
  (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    return url.includes("/api/chat/estado") ? Response.json({ ok: true, motivo: null, marca: null }) : fn(url, init);
  }) as typeof fetch;
const cuerpo = (l: Llamada) => JSON.parse(l.init!.body as string) as Record<string, unknown>;
const memoria = () => {
  const d = new Map<string, string>();
  return { d, almacen: { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k) } };
};
const BASE = { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", storage: "none" as const };
const CONFIRMACION = nd(
  { v: 1, t: "sesion", id: "s1", indice: 0 },
  { v: 1, t: "usuario", texto: "no anda el botón" },
  { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "This is what I'll send:\n\nTítulo\n\nCuerpo\n\nShall I send it?", opciones: [{ id: "approve", label: "Yes", style: "primary" }, { id: "cancel", label: "No", style: "default" }], libre: false },
  { v: 1, t: "espera", indice: 4 },
);

describe("createSupportChat", () => {
  it("pide los ids: sin tenantId o projectId lanza antes de tocar la red", () => {
    expect(() => createSupportChat({ ...BASE, tenantId: "" })).toThrow(/tenantId/);
    expect(() => createSupportChat({ ...BASE, projectId: " " })).toThrow(/projectId/);
  });

  it("send: abre la sesión, el estado se ve en cada paso y los eventos llegan en inglés y en orden", async () => {
    const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "hola" }, { v: 1, t: "texto", delta: "Ho" }, { v: 1, t: "texto", delta: "la" }, { v: 1, t: "asistente", texto: "Hola." }, { v: 1, t: "espera", indice: 5 })] });
    const chat = createSupportChat({ ...BASE, fetch: fn, appVersion: "3.1", user: { id: "u1", role: "admin", attributes: { plan: "pro" } } });
    const estados: ChatState[] = [];
    const eventos: ChatEvent[] = [];
    chat.subscribe((s) => estados.push(s));
    chat.onEvent((e) => eventos.push(e));
    const termino = chat.send("hola");
    expect(chat.getState()).toMatchObject({ busy: true, messages: [{ role: "user", text: "hola", pending: true }] });
    await termino;
    expect(eventos.map((e) => e.type)).toEqual(["session", "user_message", "text_delta", "text_delta", "assistant_message", "turn_end"]);
    expect(chat.getState()).toMatchObject({ busy: false, hasSession: true, messages: [{ role: "user", pending: false }, { role: "assistant", text: "Hola.", streaming: false }] });
    expect(estados.length).toBeGreaterThan(3);
    // el pedido: ids, versión del cliente, contexto declarado
    expect(llamadas[0].url).toBe("https://chat.test/api/chat/sesion");
    const h = new Headers(llamadas[0].init!.headers);
    expect(h.get("x-supcoflow-tenant")).toBe("tnt_a");
    expect(h.get("x-supcoflow-sdk")).toBe(`core/${SDK_VERSION}`);
    expect(cuerpo(llamadas[0])).toMatchObject({ mensaje: "hola", contexto: { version_app: "3.1", usr_id: "u1", usr_rol: "admin", usr_attr_plan: "pro" } });
  });

  it("T3: `locale` viaja en `x-supcoflow-locale` en los tres pedidos de sesión (abrir, seguir y recuperar) y en ninguno más; sin `locale` el encabezado no existe", async () => {
    const { fn, llamadas } = fetchGuionado({
      "/api/chat/sesion/s1/eventos": [nd({ v: 1, t: "espera", indice: 3 })],
      "/api/chat/sesion/s1": [nd({ v: 1, t: "espera", indice: 3 })],
      "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })],
    });
    const chat = createSupportChat({ ...BASE, locale: "es-AR", fetch: fn });
    await chat.send("hola");
    await chat.send("otra");
    expect(llamadas.map((l) => l.url.replace("https://chat.test", ""))).toEqual(["/api/chat/sesion", "/api/chat/sesion/s1"]);
    expect(llamadas.map((l) => new Headers(l.init!.headers).get("x-supcoflow-locale"))).toEqual(["es-AR", "es-AR"]);

    const { fn: fn2, llamadas: ll2 } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
    await createSupportChat({ ...BASE, fetch: fn2 }).send("hola");
    expect(new Headers(ll2[0]!.init!.headers).has("x-supcoflow-locale")).toBe(false);
  });
  it("T3: el rebobinado de una recarga también lleva `locale`", async () => {
    const { d, almacen } = memoria();
    d.set("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 1 }));
    const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion/s1/eventos": [nd({ v: 1, t: "espera", indice: 3 })] });
    const chat = createSupportChat({ ...BASE, locale: "pt-BR", storage: almacen, fetch: fn });
    await chat.ready;
    expect(llamadas[0]!.url).toContain("/eventos");
    expect(new Headers(llamadas[0]!.init!.headers).get("x-supcoflow-locale")).toBe("pt-BR");
  });
  it("T3: un `locale` que no es un texto razonable no viaja (el servidor igual lo trataría como inglés)", async () => {
    for (const locale of ["", "   ", "x".repeat(200), 3 as unknown as string]) {
      const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
      await createSupportChat({ ...BASE, locale, fetch: fn }).send("hola");
      expect(new Headers(llamadas[0]!.init!.headers).has("x-supcoflow-locale"), JSON.stringify(locale)).toBe(false);
    }
  });

  // T7: la interfaz DECLARA lo que ofrece; el servidor se lo cuenta al modelo en palabras. Sin esto el asistente invitaba a apretar botones que una interfaz propia no tiene.
  describe("T7: `capabilities` viaja en `x-supcoflow-capabilities`", () => {
    const abrirYSeguir = async (opciones: Partial<Parameters<typeof createSupportChat>[0]>) => {
      const { fn, llamadas } = fetchGuionado({
        "/api/chat/sesion/s1": [nd({ v: 1, t: "espera", indice: 3 })],
        "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })],
      });
      const chat = createSupportChat({ ...BASE, ...opciones, fetch: fn });
      await chat.send("hola");
      await chat.send("otra");
      return llamadas.map((l) => new Headers(l.init!.headers).get("x-supcoflow-capabilities"));
    };
    it("sin declarar nada viaja sólo `newConversation` (el contrato la exige tras un reporte, P8): una interfaz mínima no ofrece evidencia", async () => {
      expect(await abrirYSeguir({})).toEqual(["newConversation", "newConversation"]);
    });
    it("lo declarado viaja en el orden fijo, en los pedidos que llevan un mensaje (abrir y seguir)", async () => {
      expect(await abrirYSeguir({ capabilities: { attachImage: true, pickElement: true } })).toEqual(["pickElement,attachImage,newConversation", "pickElement,attachImage,newConversation"]);
    });
    it("`newConversation: false` y nada más declarado viaja como `none`", async () => {
      expect(await abrirYSeguir({ capabilities: { newConversation: false } })).toEqual(["none", "none"]);
    });
    it("la captura de pantalla sólo viaja si el navegador PUEDE capturar, aunque la app la declare (aquí, Node: no puede)", async () => {
      expect(await abrirYSeguir({ capabilities: { screenshot: true, attachImage: true } })).toEqual(["attachImage,newConversation", "attachImage,newConversation"]);
    });
    it("sólo cuenta lo que es exactamente `true`: un 1, un texto o un null no declaran nada", async () => {
      expect(await abrirYSeguir({ capabilities: { pickElement: 1, attachImage: "yes", screenshot: null } as never })).toEqual(["newConversation", "newConversation"]);
    });
    it("el rebobinado de una recarga también lo lleva", async () => {
      const { d, almacen } = memoria();
      d.set("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 1 }));
      const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion/s1/eventos": [nd({ v: 1, t: "espera", indice: 3 })] });
      const chat = createSupportChat({ ...BASE, capabilities: { attachImage: true }, storage: almacen, fetch: fn });
      await chat.ready;
      expect(new Headers(llamadas[0]!.init!.headers).get("x-supcoflow-capabilities")).toBe("attachImage,newConversation");
    });
    it("capacidadesOfrecidas: con un navegador que sí captura, la captura declarada viaja", () => {
      expect(capacidadesOfrecidas({ screenshot: true }, true)).toEqual({ pickElement: false, screenshot: true, attachImage: false, newConversation: true });
      expect(capacidadesOfrecidas({ screenshot: true }, false).screenshot).toBe(false);
      expect(capacidadesOfrecidas({ screenshot: false }, true).screenshot).toBe(false);
      expect(capacidadesOfrecidas(undefined, true)).toEqual({ pickElement: false, screenshot: false, attachImage: false, newConversation: true });
      expect(capacidadesOfrecidas(null as never, true).newConversation).toBe(true);
    });
  });

  it("el estado es un snapshot estable: el mismo objeto mientras nada cambia, uno nuevo (y el viejo intacto) cuando cambia", async () => {
    const { fn } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
    const chat = createSupportChat({ ...BASE, fetch: fn });
    const a = chat.getState();
    expect(chat.getState()).toBe(a);
    await chat.send("hola");
    const b = chat.getState();
    expect(b).not.toBe(a);
    expect(chat.getState()).toBe(b);
    expect(a.messages).toEqual([]);
  });

  it("el nombre del usuario NO viaja: ni declarado por error (`name`/`nombre` de un llamador en JS), ni en ningún pedido", async () => {
    const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
    const chat = createSupportChat({ ...BASE, fetch: fn, user: { id: "u1", name: "Ana Pérez", nombre: "Ana Pérez", attributes: { name: "Ana", nombre: "Ana" } } as never });
    await chat.send("hola");
    expect(JSON.stringify(llamadas)).not.toContain("Ana");
  });

  describe("la confirmación del reporte", () => {
    async function conConfirmacionPendiente() {
      const { fn, llamadas } = fetchGuionado({
        "/api/chat/sesion/s1": [nd({ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "approved", optionId: "approve" }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_9" }, { v: 1, t: "asistente", texto: "Sent." }, { v: 1, t: "espera", indice: 9 })],
        "/api/chat/sesion": [CONFIRMACION],
      });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      await chat.send("no anda el botón");
      return { chat, llamadas };
    }
    it("llega como pendingQuestion de tipo report_confirmation, con el texto exacto y los botones tal cual", async () => {
      const { chat } = await conConfirmacionPendiente();
      expect(chat.getState().pendingQuestion).toEqual({
        id: "r1",
        prompt: "This is what I'll send:\n\nTítulo\n\nCuerpo\n\nShall I send it?",
        kind: "report_confirmation",
        options: [{ id: "approve", label: "Yes", style: "primary" }, { id: "cancel", label: "No", style: "default" }],
        allowsText: false,
      });
    });
    it("confirmReport contesta `approve` con el id de la pregunta VIGENTE y el índice del cursor; el desenlace llega como outcome y el reporte queda cerrado", async () => {
      const { chat, llamadas } = await conConfirmacionPendiente();
      await chat.confirmReport("r1");
      expect(llamadas[1].url).toBe("https://chat.test/api/chat/sesion/s1");
      expect(cuerpo(llamadas[1])).toEqual({ indice: 4, respuesta: { requestId: "r1", optionId: "approve" } });
      expect(chat.getState()).toMatchObject({ pendingQuestion: null, reported: true });
      expect(chat.getState().messages.at(-2)).toMatchObject({ role: "outcome", outcome: { kind: "reported", reportId: "rep_9" } });
    });
    it("reviseReport contesta `cancel`", async () => {
      const { chat, llamadas } = await conConfirmacionPendiente();
      await chat.reviseReport("r1");
      expect(cuerpo(llamadas[1])).toEqual({ indice: 4, respuesta: { requestId: "r1", optionId: "cancel" } });
    });
    it("sin una confirmación pendiente confirmReport/reviseReport NO mandan nada: el reporte no se aprueba por su cuenta", async () => {
      const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      await chat.confirmReport("r1"); // sin sesión
      await chat.send("hola");
      await chat.confirmReport("r1"); // con sesión pero sin pregunta
      await chat.reviseReport("r1");
      expect(llamadas).toHaveLength(1);
    });
    it("una pregunta que NO es la confirmación no se aprueba con confirmReport, aunque tenga una opción llamada `approve`", async () => {
      const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "pregunta", requestId: "r2", kind: "question", prompt: "¿Cuál?", opciones: [{ id: "approve", label: "Esa", style: "default" }], libre: false }, { v: 1, t: "espera", indice: 3 })] });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      await chat.send("hola");
      await chat.confirmReport("r2");
      expect(llamadas).toHaveLength(1);
    });
    it("un botón de una pregunta ANTERIOR no aprueba la nueva: el clic viejo trae el id del borrador A y el pendiente es el B, así que no se manda nada (revisión 1, P1-1)", async () => {
      const preguntaDe = (id: string) => ({ v: 1, t: "pregunta", requestId: id, kind: "tool-approval", prompt: `Draft ${id}`, opciones: [{ id: "approve", label: "Yes", style: "primary" }, { id: "cancel", label: "No", style: "default" }], libre: false });
      const { fn, llamadas } = fetchGuionado({
        "/api/chat/sesion/s1": [
          nd({ v: 1, t: "pregunta_resuelta", requestId: "A", outcome: "cancelled", optionId: "cancel" }, { v: 1, t: "espera", indice: 5 }),
          nd(preguntaDe("B"), { v: 1, t: "espera", indice: 8 }),
          nd({ v: 1, t: "pregunta_resuelta", requestId: "B", outcome: "approved", optionId: "approve" }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_B" }, { v: 1, t: "espera", indice: 12 }),
        ],
        "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, preguntaDe("A"), { v: 1, t: "espera", indice: 3 })],
      });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      await chat.send("it is broken");
      const idA = chat.getState().pendingQuestion!.id;
      expect(idA).toBe("A");
      const clicDeA = () => chat.confirmReport(idA); // el manejador del botón de la tarjeta A, que quedó guardado
      await chat.reviseReport(idA);
      await chat.send("corrected");
      expect(chat.getState().pendingQuestion).toMatchObject({ id: "B", prompt: "Draft B" });
      const pedidos = llamadas.length;
      await clicDeA();
      expect(llamadas).toHaveLength(pedidos); // nada se mandó
      expect(chat.getState()).toMatchObject({ reported: false, pendingQuestion: { id: "B" } });
      await chat.confirmReport("B"); // el clic sobre la tarjeta que SÍ está a la vista funciona
      expect(cuerpo(llamadas.at(-1)!)).toEqual({ indice: 8, respuesta: { requestId: "B", optionId: "approve" } });
      expect(chat.getState().reported).toBe(true);
    });
    it("answer valida contra lo preguntado: una opción que no existe, o texto libre donde no se admite, no se manda", async () => {
      const { chat, llamadas } = await conConfirmacionPendiente();
      await chat.answer("r1", { optionId: "inventada" });
      await chat.answer("r1", { text: "sí, mandalo" }); // la confirmación NO se contesta escribiendo
      await chat.answer("r1", {});
      expect(llamadas).toHaveLength(1);
      await chat.answer("r1", { optionId: "approve" });
      expect(llamadas).toHaveLength(2);
    });
    it("answer con texto libre manda el texto a la pregunta que lo admite", async () => {
      const { fn, llamadas } = fetchGuionado({
        "/api/chat/sesion/s1": [nd({ v: 1, t: "espera", indice: 6 })],
        "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "pregunta", requestId: "r2", kind: "question", prompt: "¿Qué pantalla?", opciones: [], libre: true }, { v: 1, t: "espera", indice: 3 })],
      });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      await chat.send("hola");
      await chat.answer("r2", { text: "la de cuenta" });
      expect(cuerpo(llamadas[1])).toEqual({ indice: 3, respuesta: { requestId: "r2", text: "la de cuenta" } });
    });
  });

  describe("errores y reintento", () => {
    it("un 429 llega como error no terminal con su código; retry sin sesión reabre con el mismo texto", async () => {
      const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion": [Response.json({ ok: false, motivo: "tope_de_mensajes" }, { status: 429 }), nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      await chat.send("hola");
      expect(chat.getState().error).toEqual({ code: "tope_de_mensajes", message: "HTTP 429", terminal: false });
      await chat.retry();
      expect(cuerpo(llamadas[1]).mensaje).toBe("hola");
      expect(chat.getState()).toMatchObject({ error: null, hasSession: true });
    });
    it("un error terminal cierra la conversación: sin sesión y con el error a la vista", async () => {
      const { fn } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "error", codigo: "limite_de_sesion", mensaje: "x", terminal: true })] });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      await chat.send("hola");
      expect(chat.getState()).toMatchObject({ hasSession: false, busy: false, error: { code: "limite_de_sesion", terminal: true } });
    });
  });

  describe("reconexión", () => {
    it("con una conversación guardada la rebobina desde cero al crear el chat; `ready` avisa cuándo; el cursor se actualiza donde se le dijo", async () => {
      const { d, almacen } = memoria();
      d.set("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 6 }));
      const { fn, llamadas } = fetchGuionado({ "/api/chat/sesion/s1/eventos": [nd({ v: 1, t: "usuario", texto: "hola" }, { v: 1, t: "asistente", texto: "Hola." }, { v: 1, t: "espera", indice: 6 })] });
      const chat = createSupportChat({ ...BASE, storage: almacen, fetch: fn });
      expect(chat.getState().busy).toBe(true); // ya rebobinando
      await chat.ready;
      expect(llamadas[0].url).toBe("https://chat.test/api/chat/sesion/s1/eventos?desde=0");
      expect(chat.getState().messages.map((m) => (m.role === "outcome" ? m.role : m.text))).toEqual(["hola", "Hola."]);
      expect(JSON.parse(d.get("supcoflow-chat/tnt_a/proj_b")!)).toEqual({ id: "s1", indice: 6 });
    });
    it("resume: false deja la conversación guardada sin tocar; storage: 'none' no guarda nada", async () => {
      const { d, almacen } = memoria();
      d.set("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 6 }));
      const { fn, llamadas } = fetchGuionado({});
      const chat = createSupportChat({ ...BASE, storage: almacen, resume: false, fetch: fn });
      await chat.ready;
      expect(llamadas).toEqual([]);
      expect(chat.getState().hasSession).toBe(false);
      const { fn: fn2 } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s9", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
      const sin = createSupportChat({ ...BASE, storage: "none", fetch: fn2 });
      await sin.send("hola");
      expect(sin.getState().hasSession).toBe(true);
    });
    it("guarda SÓLO el cursor, nunca el historial; newConversation lo borra y deja los mensajes a la vista", async () => {
      const { d, almacen } = memoria();
      const { fn } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "asistente", texto: "Hola, SECRETO." }, { v: 1, t: "espera", indice: 3 })] });
      const chat = createSupportChat({ ...BASE, storage: almacen, fetch: fn });
      await chat.send("hola");
      expect([...d.values()].join("")).not.toContain("SECRETO");
      expect(JSON.parse(d.get("supcoflow-chat/tnt_a/proj_b")!)).toEqual({ id: "s1", indice: 3 });
      chat.newConversation();
      expect(d.size).toBe(0);
      expect(chat.getState()).toMatchObject({ hasSession: false });
      expect(chat.getState().messages).toHaveLength(2);
    });
  });

  describe("disponibilidad", () => {
    it("checkAvailability traduce /api/chat/estado: disponible, con motivo, o sin respuesta", async () => {
      const ok = createSupportChat({ ...BASE, fetch: fetchGuionado({ "/api/chat/estado": [Response.json({ ok: true, motivo: null })] }).fn });
      expect(await ok.checkAvailability()).toEqual({ available: true, status: 200, reason: null, allows: { screenshots: true, elements: true, pageAndBrowser: true } });
      const no = createSupportChat({ ...BASE, fetch: fetchGuionado({ "/api/chat/estado": [Response.json({ ok: false, motivo: "origen_no_admitido" }, { status: 403 })] }).fn });
      expect(await no.checkAvailability()).toEqual({ available: false, status: 403, reason: "origen_no_admitido", allows: { screenshots: true, elements: true, pageAndBrowser: true } });
      const caido = createSupportChat({ ...BASE, fetch: (async () => { throw new TypeError("x"); }) as unknown as typeof fetch });
      expect(await caido.checkAvailability()).toEqual({ available: false, status: 0, reason: "sin_respuesta", allows: { screenshots: true, elements: true, pageAndBrowser: true } });
    });
  });

  describe("adjuntos sin DOM", () => {
    it("en Node (sin navegador) señalar, capturar y adjuntar una imagen contestan «unavailable» en vez de lanzar", async () => {
      const chat = createSupportChat({ ...BASE, fetch: fetchGuionado({}).fn });
      expect(chat.canCaptureScreen()).toBe(false);
      expect(await chat.pickElement()).toBe("unavailable");
      expect(await chat.attachScreenshot()).toBe("unavailable");
      expect(await chat.attachImage({ type: "image/png" } as File)).toBe("unavailable");
    });
  });

  describe("oyentes", () => {
    it("un oyente que manda el mensaje siguiente apenas el chat queda libre no deja el estado desfasado: `busy` sigue verdadero mientras el segundo pedido está abierto (revisión 1, P2-1)", async () => {
      let cerrar!: () => void;
      let n = 0;
      const fn = sinSondeo(async () => {
        if (++n === 1) return new Response(nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 2 }), { headers: NDJSON });
        return new Response(new ReadableStream<Uint8Array>({ start(c) { cerrar = () => c.close(); } }), { headers: NDJSON });
      });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      let segundo: Promise<void> | null = null;
      chat.subscribe((s) => { if (!s.busy && s.hasSession && segundo === null) segundo = chat.send("second"); });
      await chat.send("first");
      await Promise.resolve();
      expect(chat.getState().busy).toBe(true);
      expect(chat.getState().messages.at(-1)).toMatchObject({ role: "user", text: "second", pending: true });
      cerrar();
      await segundo;
      expect(chat.getState().busy).toBe(false);
    });
    it("un oyente que lanza NO tumba el chat ni a los demás oyentes", async () => {
      const { fn } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "asistente", texto: "Hola." }, { v: 1, t: "espera", indice: 2 })] });
      const reportar = vi.fn();
      vi.stubGlobal("reportError", reportar);
      const chat = createSupportChat({ ...BASE, fetch: fn });
      const sano = vi.fn();
      chat.subscribe(() => { throw new Error("oyente roto"); });
      chat.onEvent(() => { throw new Error("oyente de eventos roto"); });
      chat.subscribe(sano);
      await chat.send("hola");
      vi.unstubAllGlobals();
      expect(sano).toHaveBeenCalled();
      expect(chat.getState()).toMatchObject({ busy: false, error: null });
      expect(reportar).toHaveBeenCalled();
    });
    it("la baja de subscribe y onEvent corta los avisos", async () => {
      const { fn } = fetchGuionado({ "/api/chat/sesion": [nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 })] });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      const a = vi.fn();
      const b = vi.fn();
      chat.subscribe(a)();
      chat.onEvent(b)();
      await chat.send("hola");
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    });
    it("destroy corta el pedido en vuelo y deja de avisar", async () => {
      let senal: AbortSignal | undefined;
      const fn = sinSondeo(async (_u, init) => { senal = init?.signal ?? undefined; return new Response(nd({ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "espera", indice: 1 }), { headers: NDJSON }); });
      const chat = createSupportChat({ ...BASE, fetch: fn });
      const oyente = vi.fn();
      chat.subscribe(oyente);
      await chat.checkAvailability(); // el acuerdo ya sabido: el pedido sale en el acto, y es ése el que `destroy` corta
      const termino = chat.send("hola");
      chat.destroy();
      const n = oyente.mock.calls.length;
      await termino;
      expect(senal?.aborted).toBe(true);
      expect(oyente).toHaveBeenCalledTimes(n);
    });
  });
});
