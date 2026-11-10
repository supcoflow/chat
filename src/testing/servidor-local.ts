/// <reference types="node" />
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createFakeBackend, type FakeBackend } from "./backend-falso";
import { getScenario, scenarios } from "./catalogo";
import type { Scenario } from "./escenario";
import { ENCABEZADOS_PERMITIDOS_EN_CORS } from "../contrato-del-chat";

// EL SERVIDOR LOCAL: el mismo backend falso detrás de HTTP real, con CORS abierto, para que la app de verdad apunte ahí su `backendUrl` en desarrollo y el
// developer VEA cada estado (la confirmación, el tope, el límite, un adjunto que falla) sin gastar y sin esperar al modelo. Sólo Node, y por eso tiene entrada
// propia (`@supcoflow/chat/testing/server`): el resto del banco (`@supcoflow/chat/testing`) no importa nada de Node y se puede empaquetar para un navegador.

export interface FakeServerOptions {
  /** El escenario con el que arranca (nombre u objeto). Default: `report-confirmed`. */
  scenario?: Scenario | string;
  /** Default 0: un puerto libre. */
  port?: number;
  /** Default `127.0.0.1`: sólo esta máquina. */
  host?: string;
  /** Milisegundos entre línea y línea del stream. Default 0. */
  lineDelayMs?: number;
}

export interface FakeServer {
  /** El `backendUrl` para la app, sin barra final. */
  url: string;
  port: number;
  /** El mismo backend falso: sus pedidos anotados, `hold()`, `use()`… */
  backend: FakeBackend;
  close(): Promise<void>;
}

const PERMITIDOS = ENCABEZADOS_PERMITIDOS_EN_CORS.join(", ");
// CORS abierto sólo en las cinco rutas del protocolo. Las de control (`/__fake/*`) NO lo llevan: `/__fake/state` devuelve lo que la app mandó (contexto, usuario, capturas) y
// ninguna página abierta en el navegador del developer tiene por qué poder leerlo (revisión 1, P3-4). `curl` y los tests en Node no lo necesitan.
const CORS: Record<string, string> = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-type" };
/** El mismo tope que la ruta real (`MAX_CUERPO_CHARS` de `/api/evidencias`): el fake también contesta 413 a un cuerpo más grande. */
const MAX_CUERPO_CHARS = 2_300_000;

/** El cuerpo entero, o `null` si pasa del tope (se deja de acumular apenas pasa). */
function leerCuerpo(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolver, rechazar) => {
    const partes: Buffer[] = [];
    let largo = 0;
    let demasiado = false;
    req.on("data", (c: Buffer) => {
      largo += c.length;
      if (largo > MAX_CUERPO_CHARS) demasiado = true;
      if (!demasiado) partes.push(c);
    });
    req.on("end", () => resolver(demasiado ? null : Buffer.concat(partes).toString("utf8")));
    req.on("error", rechazar);
  });
}

function responderJson(res: ServerResponse, status: number, cuerpo: object, cors = true): void {
  res.writeHead(status, { ...(cors ? CORS : {}), "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

export async function startFakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  // Falla acá, con la lista de los que hay, y no en el primer pedido.
  const inicial = typeof options.scenario === "string" ? getScenario(options.scenario) : (options.scenario ?? getScenario("report-confirmed"));
  let backend!: FakeBackend;

  async function controlar(req: IncomingMessage, res: ServerResponse, ruta: string): Promise<void> {
    if (req.method === "GET" && ruta === "/__fake/scenarios") {
      return responderJson(res, 200, { current: backend.scenario.name, scenarios: scenarios.map((s) => ({ name: s.name, description: s.description, covers: s.covers })) }, false);
    }
    if (req.method === "GET" && ruta === "/__fake/state") {
      return responderJson(res, 200, { scenario: backend.scenario.name, remaining: backend.remaining, requests: backend.requests }, false);
    }
    if (req.method === "POST" && ruta === "/__fake/reset") {
      backend.reset();
      return responderJson(res, 200, { ok: true }, false);
    }
    if (req.method === "POST" && ruta === "/__fake/scenario") {
      let nombre: unknown;
      try { nombre = (JSON.parse((await leerCuerpo(req)) ?? "") as { name?: unknown }).name; } catch { nombre = undefined; }
      const s = typeof nombre === "string" ? scenarios.find((x) => x.name === nombre) : undefined;
      if (s === undefined) return responderJson(res, 404, { ok: false, motivo: "escenario_desconocido", scenarios: scenarios.map((x) => x.name) }, false);
      backend.use(s);
      return responderJson(res, 200, { ok: true, scenario: s.name }, false);
    }
    responderJson(res, 404, { ok: false, motivo: "ruta_desconocida" }, false);
  }

  async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ruta = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...CORS, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": PERMITIDOS, "access-control-max-age": "600" });
      return void res.end();
    }
    if (ruta.startsWith("/__fake/")) return controlar(req, res, ruta);

    const cabeceras: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) cabeceras[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
    const origen = cabeceras["origin"];
    // Un cliente que corta (el núcleo al destruirse) cancela lo que queda del stream.
    const corte = new AbortController();
    res.on("close", () => { if (!res.writableEnded) corte.abort(); });

    const cuerpo = req.method === "GET" || req.method === "HEAD" ? undefined : await leerCuerpo(req);
    if (cuerpo === null) return responderJson(res, 413, { ok: false, motivo: "cuerpo_demasiado_grande" });
    const r = await backend.handle({ method: req.method ?? "GET", url: req.url ?? "/", headers: cabeceras, ...(cuerpo === undefined ? {} : { body: cuerpo }), signal: corte.signal, ...(origen === undefined || origen === "null" ? {} : { origin: origen }) });
    const salida: Record<string, string> = { ...CORS };
    r.headers.forEach((v, k) => { salida[k] = v; });
    res.writeHead(r.status, salida);
    if (r.body === null) return void res.end();
    const lector = r.body.getReader();
    res.on("close", () => void lector.cancel().catch(() => {}));
    try {
      for (let c = await lector.read(); !c.done; c = await lector.read()) res.write(c.value);
    } catch {
      // el cliente se fue en medio del stream
    }
    res.end();
  }

  const servidor: Server = createServer((req, res) => {
    atender(req, res).catch((e: unknown) => {
      if (res.headersSent) return void res.end();
      responderJson(res, 500, { ok: false, motivo: "fake_fallo", mensaje: e instanceof Error ? e.message : String(e) });
    });
  });
  await new Promise<void>((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolver);
  });
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === "string") throw new Error("The fake server could not read its own address.");
  const url = `http://${direccion.address.includes(":") ? `[${direccion.address}]` : direccion.address}:${direccion.port}`;
  backend = createFakeBackend(inicial, { backendUrl: url, ...(options.lineDelayMs === undefined ? {} : { lineDelayMs: options.lineDelayMs }) });

  return {
    url,
    port: direccion.port,
    backend,
    close: () => new Promise<void>((resolver) => {
      servidor.close(() => resolver());
      servidor.closeAllConnections();
    }),
  };
}
