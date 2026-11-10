import { describe, expect, it } from "vitest";
import { createSupportChat } from "../core/soporte";
import { createFakeBackend } from "./backend-falso";
import { storageWithSavedConversation } from "./almacen";
import { getScenario } from "./catalogo";
import type { Scenario } from "./escenario";

// El BACKEND FALSO (T4 del plan «ui-agnóstico»): un `fetch` que contesta con una charla guionada y anota qué le pidió la interfaz y en qué orden.
// Estas pruebas miran el fake solo (con escenarios mínimos armados acá) y, al final, andando con el núcleo de verdad. Que los escenarios
// publicados dan lo que dicen se prueba en `core/contrato.test.ts`, que los repite todos a través de este mismo fake.

const BASE = "https://chat.fake.test";
const ABRIR = { v: 1, t: "sesion", id: "ses_X", indice: 0 };
const mini = (parcial: Partial<Scenario> & Pick<Scenario, "responses">): Scenario => ({ name: "mini", description: "a tiny scenario", covers: [], script: [], ...parcial });
const post = (f: typeof fetch, ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
  f(`${BASE}${ruta}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(cuerpo) });
const leer = async (r: Response) => (await r.text()).split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);

describe("createFakeBackend: qué contesta", () => {
  it("la disponibilidad contesta sin gastar una respuesta guionada, y por defecto es «activo», con el `permite` que el backend de hoy siempre manda", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR] }] }), { backendUrl: BASE });
    const r = await b.fetch(`${BASE}/api/chat/estado?tenant_id=t&project_id=p`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, motivo: null, marca: null, permite: { capturas: true, elementos: true, pagina_y_navegador: true } });
    expect(b.remaining).toBe(1);
  });

  it("la disponibilidad puede estar guionada (chat apagado: 403 con su motivo)", async () => {
    const b = createFakeBackend(mini({ responses: [], availability: { status: 403, body: { ok: false, motivo: "chat_deshabilitado", marca: null } } }), { backendUrl: BASE });
    const r = await b.fetch(`${BASE}/api/chat/estado?tenant_id=t&project_id=p`);
    expect([r.status, await r.json()]).toEqual([403, { ok: false, motivo: "chat_deshabilitado", marca: null }]);
  });

  it("cada pedido a la sesión consume UNA respuesta, en orden, sea abrir, seguir o recuperar", async () => {
    const b = createFakeBackend(
      mini({ responses: [{ stream: [ABRIR, { v: 1, t: "espera", indice: 3 }] }, { stream: [{ v: 1, t: "texto", delta: "hi" }, { v: 1, t: "espera", indice: 5 }] }, { stream: [{ v: 1, t: "fin" }] }] }),
      { backendUrl: BASE },
    );
    expect(await leer(await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" }))).toEqual([ABRIR, { v: 1, t: "espera", indice: 3 }]);
    expect(await leer(await post(b.fetch, "/api/chat/sesion/ses_X", { indice: 3, mensaje: "more" }))).toEqual([{ v: 1, t: "texto", delta: "hi" }, { v: 1, t: "espera", indice: 5 }]);
    expect(await leer(await b.fetch(`${BASE}/api/chat/sesion/ses_X/eventos?desde=0`))).toEqual([{ v: 1, t: "fin" }]);
    expect(b.remaining).toBe(0);
  });

  it("las respuestas son NDJSON con su content-type, y una línea que es texto (no v1) viaja tal cual", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: ["this is not json", ABRIR] }] }), { backendUrl: BASE });
    const r = await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" });
    expect(r.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await r.text()).split("\n")).toEqual(["this is not json", JSON.stringify(ABRIR), ""]);
  });

  it("una respuesta HTTP guionada sale con su status y su cuerpo", async () => {
    const b = createFakeBackend(mini({ responses: [{ http: 429, body: { ok: false, motivo: "tope_de_mensajes" } }] }), { backendUrl: BASE });
    const r = await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" });
    expect([r.status, await r.json()]).toEqual([429, { ok: false, motivo: "tope_de_mensajes" }]);
  });

  it("sin respuestas guionadas que dar contesta 409 `escenario_agotado`: se ve en la pantalla en vez de colgarse", async () => {
    const b = createFakeBackend(mini({ responses: [] }), { backendUrl: BASE });
    const r = await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" });
    expect([r.status, await r.json()]).toEqual([409, { ok: false, motivo: "escenario_agotado" }]);
  });

  it("una ruta que el protocolo no tiene contesta 404 `ruta_desconocida`", async () => {
    const b = createFakeBackend(mini({ responses: [] }), { backendUrl: BASE });
    const r = await post(b.fetch, "/api/chat", { mensaje: "hello" });
    expect([r.status, await r.json()]).toEqual([404, { ok: false, motivo: "ruta_desconocida" }]);
  });

  it("`{{origin}}` en el texto guionado se vuelve el origen de la página, también dentro de objetos anidados", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [{ v: 1, t: "asistente", texto: "see [your account]({{origin}}/account)" }] }] }), { backendUrl: BASE, origin: "http://localhost:5173" });
    expect(await leer(await post(b.fetch, "/api/chat/sesion", { mensaje: "x" }))).toEqual([{ v: 1, t: "asistente", texto: "see [your account](http://localhost:5173/account)" }]);
  });

  it("las evidencias contestan 201 con un id propio por defecto, y las guionadas salen en orden", async () => {
    const b = createFakeBackend(mini({ responses: [], evidence: [{ http: 429, body: { ok: false, motivo: "tope_de_evidencias" } }] }), { backendUrl: BASE });
    const cuerpo = { session_id: "ses_X", evidencia: { tipo: "elemento", contenido: { etiqueta: "button" } } };
    const primera = await post(b.fetch, "/api/evidencias", cuerpo);
    expect([primera.status, await primera.json()]).toEqual([429, { ok: false, motivo: "tope_de_evidencias" }]);
    const segunda = await post(b.fetch, "/api/evidencias", cuerpo);
    const tercera = await post(b.fetch, "/api/evidencias", cuerpo);
    expect(segunda.status).toBe(201);
    expect(await segunda.json()).toEqual({ ok: true, evidencia_id: "evd_1" });
    expect(await tercera.json()).toEqual({ ok: true, evidencia_id: "evd_2" });
  });
});

describe("createFakeBackend: qué anota de lo que le pidió la interfaz", () => {
  it("cada pedido queda con su orden, su clase, su método, su ruta, sus headers (en minúsculas) y su cuerpo ya leído", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR] }, { stream: [] }, { stream: [] }] }), { backendUrl: BASE });
    await b.fetch(`${BASE}/api/chat/estado?tenant_id=t&project_id=p`);
    await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" }, { "X-Supcoflow-Tenant": "t", "x-supcoflow-locale": "es" });
    await post(b.fetch, "/api/chat/sesion/ses_X", { indice: 3, mensaje: "more" });
    await b.fetch(`${BASE}/api/chat/sesion/ses_X/eventos?desde=0`);
    await post(b.fetch, "/api/evidencias", { session_id: "ses_X", evidencia: { tipo: "elemento", contenido: {} } });
    expect(b.requests.map((p) => [p.seq, p.kind, p.method, p.path])).toEqual([
      [1, "availability", "GET", "/api/chat/estado?tenant_id=t&project_id=p"],
      [2, "open", "POST", "/api/chat/sesion"],
      [3, "follow", "POST", "/api/chat/sesion/ses_X"],
      [4, "recover", "GET", "/api/chat/sesion/ses_X/eventos?desde=0"],
      [5, "evidence", "POST", "/api/evidencias"],
    ]);
    expect(b.requests[1]!.body).toEqual({ mensaje: "hello" });
    expect(b.requests[1]!.headers).toMatchObject({ "x-supcoflow-tenant": "t", "x-supcoflow-locale": "es", "content-type": "application/json" });
    expect(b.requests[0]!.body).toBeUndefined();
    expect(b.requestsOfKind("follow")).toHaveLength(1);
  });

  it("un pedido que no llegó a ninguna ruta del protocolo también queda anotado (de clase `unknown`)", async () => {
    const b = createFakeBackend(mini({ responses: [] }), { backendUrl: BASE });
    await post(b.fetch, "/api/otra-cosa", {});
    expect(b.requests.map((p) => p.kind)).toEqual(["unknown"]);
  });

  it("`answers()` lista lo que la interfaz CONTESTÓ a una pregunta: el id de la pregunta, la opción o el texto, y el orden del pedido", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [] }, { stream: [] }, { stream: [] }] }), { backendUrl: BASE });
    await post(b.fetch, "/api/chat/sesion/ses_X", { indice: 3, mensaje: "just a message" });
    await post(b.fetch, "/api/chat/sesion/ses_X", { indice: 6, respuesta: { requestId: "req_1", optionId: "approve" } });
    await post(b.fetch, "/api/chat/sesion/ses_X", { indice: 9, respuesta: { requestId: "req_2", text: "Chrome" } });
    expect(b.answers()).toEqual([
      { seq: 2, requestId: "req_1", optionId: "approve" },
      { seq: 3, requestId: "req_2", text: "Chrome" },
    ]);
  });

  it("un cuerpo que no es JSON no rompe el fake: queda sin leer", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [] }] }), { backendUrl: BASE });
    await b.fetch(`${BASE}/api/chat/sesion`, { method: "POST", body: "not json" });
    expect(b.requests[0]!.body).toBe("not json");
  });
});

describe("createFakeBackend: control del tiempo y del escenario", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("hold() deja el próximo pedido a la sesión sin contestar hasta soltarlo: así la interfaz está «trabajando» el tiempo que haga falta", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR] }] }), { backendUrl: BASE });
    const soltar = b.hold();
    let contesto = false;
    const pedido = post(b.fetch, "/api/chat/sesion", { mensaje: "hello" }).then((r) => { contesto = true; return r; });
    await tick();
    expect(contesto).toBe(false);
    expect(b.requests).toHaveLength(1); // el pedido ya llegó y quedó anotado: lo que falta es la respuesta
    soltar();
    expect(await leer(await pedido)).toEqual([ABRIR]);
  });

  it("T6 (revisión 1, P2-2): un pedido que la interfaz cortó (su `AbortSignal`) queda anotado con `aborted: true`; los demás no lo llevan", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR] }] }), { backendUrl: BASE });
    b.hold();
    const control = new AbortController();
    const cortado = b.fetch(`${BASE}/api/chat/sesion`, { method: "POST", body: JSON.stringify({ mensaje: "hello" }), signal: control.signal }).catch((e: Error) => e.name);
    await tick();
    expect(b.requests[0]).not.toHaveProperty("aborted");
    control.abort();
    expect(await cortado).toBe("AbortError");
    expect(b.requests[0]).toMatchObject({ kind: "open", aborted: true });
    await b.fetch(`${BASE}/api/chat/estado`);
    expect(b.requests[1]).not.toHaveProperty("aborted");
  });

  it("hold() sólo retiene UN pedido: el siguiente contesta de una", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR] }, { stream: [ABRIR] }] }), { backendUrl: BASE });
    const soltar = b.hold();
    const primero = post(b.fetch, "/api/chat/sesion", { mensaje: "one" });
    await tick();
    const segundo = await post(b.fetch, "/api/chat/sesion/ses_X", { indice: 0, mensaje: "two" });
    expect(await leer(segundo)).toEqual([ABRIR]);
    soltar();
    await primero;
  });

  it("hold({ afterLines }) entrega esas líneas y retiene el resto: la interfaz ve el texto a medias", async () => {
    const lineas = [ABRIR, { v: 1, t: "texto", delta: "Hel" }, { v: 1, t: "texto", delta: "lo" }, { v: 1, t: "espera", indice: 4 }];
    const b = createFakeBackend(mini({ responses: [{ stream: lineas }] }), { backendUrl: BASE });
    const soltar = b.hold({ afterLines: 2 });
    const r = await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" });
    const lector = r.body!.getReader();
    const dec = new TextDecoder();
    let visto = "";
    while (visto.split("\n").filter((l) => l !== "").length < 2) visto += dec.decode((await lector.read()).value);
    expect(visto.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l))).toEqual(lineas.slice(0, 2));
    const resto = lector.read();
    await tick();
    let llego = false;
    void resto.then(() => { llego = true; });
    await tick();
    expect(llego).toBe(false);
    soltar();
    let todo = visto;
    for (let c = await resto; !c.done; c = await lector.read()) todo += dec.decode(c.value);
    expect(todo.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l))).toEqual(lineas);
  });

  it("una señal de cancelación corta un pedido retenido con AbortError (el núcleo la usa al destruirse)", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR] }] }), { backendUrl: BASE });
    b.hold();
    const control = new AbortController();
    const pedido = b.fetch(`${BASE}/api/chat/sesion`, { method: "POST", body: "{}", signal: control.signal });
    await tick();
    control.abort();
    await expect(pedido).rejects.toMatchObject({ name: "AbortError" });
  });

  it("lineDelayMs separa las líneas en el tiempo (para ver el streaming en pantalla)", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR, { v: 1, t: "espera", indice: 1 }] }] }), { backendUrl: BASE, lineDelayMs: 40 });
    const t0 = Date.now();
    await leer(await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" }));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  it("reset() vuelve al principio: respuestas sin consumir y pedidos en cero", async () => {
    const b = createFakeBackend(mini({ responses: [{ stream: [ABRIR] }] }), { backendUrl: BASE });
    await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" });
    expect([b.remaining, b.requests.length]).toEqual([0, 1]);
    b.reset();
    expect([b.remaining, b.requests.length]).toEqual([1, 0]);
    expect(await leer(await post(b.fetch, "/api/chat/sesion", { mensaje: "hello" }))).toEqual([ABRIR]);
  });

  it("use() cambia de escenario y arranca de cero; el nombre del escenario vigente se lee en `scenario`", () => {
    const b = createFakeBackend(mini({ responses: [] }), { backendUrl: BASE });
    b.use("report-confirmed");
    expect(b.scenario.name).toBe("report-confirmed");
    expect(b.remaining).toBe(3);
  });

  it("el escenario se puede pedir por nombre, y uno que no existe lista los que hay", () => {
    expect(createFakeBackend("report-confirmed", { backendUrl: BASE }).scenario.name).toBe("report-confirmed");
    expect(() => createFakeBackend("no-such-scenario", { backendUrl: BASE })).toThrow(/no-such-scenario.*report-confirmed/s);
  });

  it("`url` es el backendUrl que se le da al núcleo, sin barra final", () => {
    expect(createFakeBackend(mini({ responses: [] }), { backendUrl: `${BASE}/` }).url).toBe(BASE);
    expect(createFakeBackend(mini({ responses: [] })).url).toMatch(/^https:\/\/[^/]+$/);
  });
});

describe("createFakeBackend con el núcleo de verdad", () => {
  it("el camino del reporte: ningún `approve` sale antes del gesto, y el que sale lleva el id de ESA confirmación", async () => {
    const b = createFakeBackend("report-confirmed");
    const chat = createSupportChat({ tenantId: "t", projectId: "p", backendUrl: b.url, fetch: b.fetch, storage: "none", autoContext: false });
    await chat.send("The save button does nothing");
    await chat.send("On Settings > Profile");
    const q = chat.getState().pendingQuestion;
    expect(q?.kind).toBe("report_confirmation");
    expect(b.answers()).toEqual([]); // antes del clic: nada contestado
    await chat.confirmReport(q!.id);
    expect(b.answers()).toEqual([{ seq: expect.any(Number), requestId: q!.id, optionId: "approve" }]);
    expect(chat.getState().reported).toBe(true);
    expect(b.remaining).toBe(0);
    chat.destroy();
  });
});

describe("createFakeBackend con el núcleo: lo que las pruebas de una interfaz necesitan", () => {
  const ids = { tenantId: "tnt_a", projectId: "proj_b" };
  const crear = (b: ReturnType<typeof createFakeBackend>, extra: Partial<Parameters<typeof createSupportChat>[0]> = {}) =>
    createSupportChat({ ...ids, backendUrl: b.url, fetch: b.fetch, storage: "none", autoContext: false, ...extra });

  it("la recarga: con la conversación guardada, la confirmación vuelve pendiente y sólo el gesto la aprueba", async () => {
    const b = createFakeBackend("reload-with-pending-confirmation");
    const chat = crear(b, { storage: storageWithSavedConversation(b.scenario, ids) });
    await chat.ready;
    expect(b.requests.map((p) => [p.kind, p.path])).toContainEqual(["recover", "/api/chat/sesion/ses_A/eventos?desde=0"]);
    const q = chat.getState().pendingQuestion;
    expect(q?.kind).toBe("report_confirmation");
    expect(b.answers()).toEqual([]);
    await chat.confirmReport(q!.id);
    expect(b.answers()).toHaveLength(1);
    chat.destroy();
  });

  it("storageWithSavedConversation lanza si el escenario no es de recarga", () => {
    expect(() => storageWithSavedConversation(getScenario("report-confirmed"), ids)).toThrow(/no saved conversation/);
  });

  it("con hold() la interfaz queda «trabajando» —`busy`, sin texto— hasta que se suelta, y no se pierde lo que escribió la persona", async () => {
    const b = createFakeBackend("question-answered");
    const chat = crear(b);
    const soltar = b.hold();
    const turno = chat.send("How do I export my data?");
    await new Promise((r) => setTimeout(r, 0));
    const durante = chat.getState();
    expect(durante.busy).toBe(true);
    expect(durante.messages).toMatchObject([{ role: "user", text: "How do I export my data?", pending: true }]);
    soltar();
    await turno;
    expect(chat.getState().busy).toBe(false);
    expect(chat.getState().messages.map((m) => m.role)).toContain("assistant");
    chat.destroy();
  });

  it("el locale que la app declara llega como header, y se lee en el pedido anotado", async () => {
    const b = createFakeBackend("report-confirmed");
    const chat = crear(b, { locale: "es-AR" });
    await chat.send("hola");
    expect(b.requestsOfKind("open")[0]!.headers["x-supcoflow-locale"]).toBe("es-AR");
    expect(b.requestsOfKind("open")[0]!.headers["x-supcoflow-tenant"]).toBe("tnt_a");
    chat.destroy();
  });

  it("destroy() corta el pedido retenido: el núcleo no deja un stream abierto", async () => {
    const b = createFakeBackend("question-answered");
    const chat = crear(b);
    b.hold();
    void chat.send("hi");
    await new Promise((r) => setTimeout(r, 0));
    chat.destroy(); // la señal aborta el fetch retenido; no queda nada colgado ni lanza
    await new Promise((r) => setTimeout(r, 0));
    expect(b.requests).toHaveLength(2); // el sondeo del acuerdo y el pedido
  });

  it("un escenario armado a mano, con otra forma de fallo, anda igual (los escenarios son datos)", async () => {
    const propio: Scenario = {
      name: "my-own-failure", description: "A server failure of my own, to see how my interface looks when the engine is down.", covers: ["P9"],
      script: [{ send: "hello" }], responses: [{ http: 502, body: { ok: false, motivo: "motor_inalcanzable" } }],
    };
    const b = createFakeBackend(propio);
    const chat = crear(b);
    await chat.send("hello");
    expect(chat.getState().error).toMatchObject({ code: "motor_inalcanzable", terminal: false });
    chat.destroy();
  });
});
