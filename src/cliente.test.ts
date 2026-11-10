import { describe, expect, it, vi } from "vitest";
import { crearCliente, leerNdjson, parsearLinea } from "./cliente";
import { normalizarOpciones } from "./opciones";
import type { EventoDelWidget } from "./protocolo";

function streamDe(...trozos: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const t of trozos) c.enqueue(enc.encode(t));
      c.close();
    },
  });
}
async function todos<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
const opciones = normalizarOpciones({ tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test/" });

describe("parsearLinea", () => {
  it("una línea v1 con t es un evento; lo demás es null y no lanza", () => {
    expect(parsearLinea('{"v":1,"t":"fin"}')).toEqual({ v: 1, t: "fin" });
    expect(parsearLinea("")).toBeNull();
    expect(parsearLinea("{no es json")).toBeNull();
    expect(parsearLinea('{"v":2,"t":"fin"}')).toBeNull();
    expect(parsearLinea('{"v":1}')).toBeNull();
  });
});

describe("leerNdjson", () => {
  it("junta trozos partidos a mitad de línea y emite en orden", async () => {
    const s = streamDe('{"v":1,"t":"tex', 'to","delta":"Ho"}\n{"v":1,"t":"texto","del', 'ta":"la"}\n{"v":1,"t":"espera","indice":4}\n');
    expect(await todos(leerNdjson(s))).toEqual([
      { v: 1, t: "texto", delta: "Ho" },
      { v: 1, t: "texto", delta: "la" },
      { v: 1, t: "espera", indice: 4 },
    ]);
  });
  it("una última línea sin salto final también cuenta", async () => {
    expect(await todos(leerNdjson(streamDe('{"v":1,"t":"fin"}')))).toEqual([{ v: 1, t: "fin" }]);
  });
});

describe("leerNdjson: el cuerpo se cancela si el consumidor abandona la lectura antes del final (revisión 2, P2-1)", () => {
  function cuerpoAbierto() {
    const estado = { cancelado: false };
    const enc = new TextEncoder();
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode('{"v":1,"t":"texto","delta":"a"}\n{"v":1,"t":"espera","indice":2}\n')); }, // y NO se cierra
      cancel() { estado.cancelado = true; },
    });
    return { cuerpo, estado };
  }
  it("salir del `for await` a mitad de camino cancela el cuerpo (no sólo suelta el lock)", async () => {
    const { cuerpo, estado } = cuerpoAbierto();
    for await (const e of leerNdjson(cuerpo)) if (e.t === "espera") break;
    expect(estado.cancelado).toBe(true);
    expect(cuerpo.locked).toBe(false);
  });
  it("leer hasta el final NO cancela nada", async () => {
    const estado = { cancelado: false };
    const cuerpo = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"v":1,"t":"fin"}\n')); c.close(); }, cancel() { estado.cancelado = true; } });
    expect(await todos(leerNdjson(cuerpo))).toEqual([{ v: 1, t: "fin" }]);
    expect(estado.cancelado).toBe(false);
  });
});

describe("crearCliente", () => {
  function fetchQueContesta(status: number, cuerpo: string, tipo = "application/x-ndjson") {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(cuerpo, { status, headers: { "content-type": tipo } })) as unknown as typeof fetch;
  }
  it("abrir: POST /api/chat/sesion con los headers de proyecto y el cuerpo {mensaje, contexto}", async () => {
    const f = fetchQueContesta(200, '{"v":1,"t":"sesion","id":"s1","indice":0}\n{"v":1,"t":"espera","indice":3}\n');
    const salida = await todos(crearCliente(opciones, f).abrir("hola", { url: "https://x" }));
    expect(salida.map((e) => e.t)).toEqual(["sesion", "espera"]);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chat.test/api/chat/sesion");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-supcoflow-tenant")).toBe("tnt_a");
    expect(new Headers(init.headers).get("x-supcoflow-project")).toBe("proj_b");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ mensaje: "hola", contexto: { url: "https://x" } });
  });
  it("seguir manda el índice y la unión estricta; recuperar es GET con ?desde", async () => {
    const f = fetchQueContesta(200, '{"v":1,"t":"espera","indice":9}\n');
    const c = crearCliente(opciones, f);
    await todos(c.seguir("s1", 3, { respuesta: { requestId: "r1", optionId: "si" } }));
    await todos(c.recuperar("s1", 3));
    const llamadas = (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(llamadas[0][0]).toBe("https://chat.test/api/chat/sesion/s1");
    expect(JSON.parse(llamadas[0][1].body as string)).toEqual({ indice: 3, respuesta: { requestId: "r1", optionId: "si" } });
    expect(llamadas[1][0]).toBe("https://chat.test/api/chat/sesion/s1/eventos?desde=3");
    expect(llamadas[1][1].method).toBe("GET");
  });
  it("el id de sesión es OPACO: el sellado que el backend entrega (ss1.<fecha>.<firma>.<id>) viaja tal cual en seguir y recuperar, y se guarda tal cual (A1: no hace falta otro campo)", async () => {
    const sellado = `ss1.mh3k2x1.${"A".repeat(43)}.wrun_01M674JG3TYJXKTXSYXXVWJYC3`;
    const f = fetchQueContesta(200, '{"v":1,"t":"espera","indice":9}\n');
    const c = crearCliente(opciones, f);
    await todos(c.seguir(sellado, 3, { mensaje: "sigo" }));
    await todos(c.recuperar(sellado, 3));
    const llamadas = (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(llamadas[0][0]).toBe(`https://chat.test/api/chat/sesion/${sellado}`);
    expect(llamadas[1][0]).toBe(`https://chat.test/api/chat/sesion/${sellado}/eventos?desde=3`);
  });
  it("seguir con contexto lo manda junto al mensaje; sin contexto la clave no aparece", async () => {
    const f = fetchQueContesta(200, '{"v":1,"t":"espera","indice":9}\n');
    const c = crearCliente(opciones, f);
    await todos(c.seguir("s1", 3, { mensaje: "sigue", contexto: { evidencia_capturas: "1" } }));
    await todos(c.seguir("s1", 3, { mensaje: "sigue", contexto: undefined }));
    const llamadas = (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(JSON.parse(llamadas[0][1].body as string)).toEqual({ indice: 3, mensaje: "sigue", contexto: { evidencia_capturas: "1" } });
    expect(JSON.parse(llamadas[1][1].body as string)).toEqual({ indice: 3, mensaje: "sigue" });
  });
  it("un status no-2xx se vuelve UN evento error con el motivo del cuerpo, no terminal, y nada más; lleva la marca `rechazado` porque el turno no corrió", async () => {
    const f = fetchQueContesta(429, '{"ok":false,"motivo":"tope_de_mensajes"}', "application/json");
    expect(await todos(crearCliente(opciones, f).abrir("hola", undefined))).toEqual([
      { v: 1, t: "error", codigo: "tope_de_mensajes", mensaje: "HTTP 429", terminal: false, rechazado: true },
    ]);
  });
  it("un status no-2xx SIN motivo (una pasarela: el pedido pudo llegar) no lleva la marca `rechazado`", async () => {
    const f = fetchQueContesta(502, "<html>Bad gateway</html>", "text/html");
    expect(await todos(crearCliente(opciones, f).seguir("s1", 1, { mensaje: "hola" }))).toEqual([
      { v: 1, t: "error", codigo: "http_502", mensaje: "HTTP 502", terminal: false },
    ]);
  });
  it("un fallo de red se vuelve error codigo red", async () => {
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const salida = await todos(crearCliente(opciones, f).recuperar("s1", 0));
    expect(salida).toEqual([{ v: 1, t: "error", codigo: "red", mensaje: "Failed to fetch", terminal: false }]);
  });
  it("con previewToken manda x-supcoflow-preview en abrir, seguir y recuperar; sin él el header no existe", async () => {
    const conToken = normalizarOpciones({ tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", previewToken: "v1.tnt_a.proj_b.9.f" });
    const f = fetchQueContesta(200, '{"v":1,"t":"espera","indice":1}\n');
    const c = crearCliente(conToken, f);
    await todos(c.abrir("hola", undefined));
    await todos(c.seguir("s1", 1, { mensaje: "sigo" }));
    await todos(c.recuperar("s1", 1));
    for (const [, init] of (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-supcoflow-preview")).toBe("v1.tnt_a.proj_b.9.f");
    }
    const f2 = fetchQueContesta(200, '{"v":1,"t":"espera","indice":1}\n');
    await todos(crearCliente(opciones, f2).abrir("hola", undefined));
    const [, init] = (f2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("x-supcoflow-preview")).toBe(false);
  });
  it("con `sdk` manda x-supcoflow-sdk en abrir, seguir y recuperar; sin él el header no existe (el tráfico de antes es byte por byte el mismo)", async () => {
    const f = fetchQueContesta(200, '{"v":1,"t":"espera","indice":1}\n');
    const c = crearCliente(opciones, f, { sdk: "core/9.9.9" });
    await todos(c.abrir("hola", undefined));
    await todos(c.seguir("s1", 1, { mensaje: "sigo" }));
    await todos(c.recuperar("s1", 1));
    for (const [, init] of (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-supcoflow-sdk")).toBe("core/9.9.9");
    }
    const f2 = fetchQueContesta(200, '{"v":1,"t":"espera","indice":1}\n');
    await todos(crearCliente(opciones, f2).abrir("hola", undefined));
    expect(new Headers(((f2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].headers).has("x-supcoflow-sdk")).toBe(false);
  });
  it("una señal de cancelación llega al fetch de abrir, seguir y recuperar", async () => {
    const f = fetchQueContesta(200, '{"v":1,"t":"espera","indice":1}\n');
    const c = crearCliente(opciones, f);
    const control = new AbortController();
    await todos(c.abrir("hola", undefined, control.signal));
    await todos(c.seguir("s1", 1, { mensaje: "sigo" }, control.signal));
    await todos(c.recuperar("s1", 1, control.signal));
    for (const [, init] of (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][]) expect(init.signal).toBe(control.signal);
  });
});
