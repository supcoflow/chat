import { afterEach, describe, expect, it } from "vitest";
import { createSupportChat } from "../core/soporte";
import { startFakeServer, type FakeServer } from "./servidor-local";

// EL SERVIDOR LOCAL: el mismo backend falso, detrás de HTTP real en 127.0.0.1 y con CORS abierto, para que la app de verdad apunte ahí su `backendUrl`
// en desarrollo. Se prueba con el `fetch` de Node y con el núcleo, sin pasar por ningún navegador.

let servidor: FakeServer | undefined;
afterEach(async () => { await servidor?.close(); servidor = undefined; });
const iniciar = async (o: Parameters<typeof startFakeServer>[0] = {}) => (servidor = await startFakeServer({ port: 0, ...o }));

describe("startFakeServer", () => {
  it("escucha en 127.0.0.1 en el puerto pedido (0 = uno libre) y dice su url", async () => {
    const s = await iniciar();
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(s.port).toBeGreaterThan(0);
  });

  it("el preflight de CORS contesta 204 y nombra los headers del protocolo, también el de idioma", async () => {
    const s = await iniciar();
    const r = await fetch(`${s.url}/api/chat/sesion`, { method: "OPTIONS", headers: { origin: "http://localhost:3000", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-supcoflow-tenant" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const permitidos = r.headers.get("access-control-allow-headers")!.toLowerCase();
    for (const h of ["content-type", "x-supcoflow-tenant", "x-supcoflow-project", "x-supcoflow-sdk", "x-supcoflow-locale", "x-supcoflow-capabilities", "x-supcoflow-preview"]) expect(permitidos).toContain(h);
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("todas las respuestas llevan el origen abierto, también las de error", async () => {
    const s = await iniciar();
    const r = await fetch(`${s.url}/api/otra-cosa`, { method: "POST", body: "{}" });
    expect(r.status).toBe(404);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("anda con el núcleo de verdad por HTTP: la charla del reporte llega a «reportado» y el servidor anota lo que pidió", async () => {
    const s = await iniciar({ scenario: "report-confirmed" });
    const chat = createSupportChat({ tenantId: "t", projectId: "p", backendUrl: s.url, storage: "none", autoContext: false });
    expect((await chat.checkAvailability()).available).toBe(true);
    await chat.send("The save button does nothing");
    await chat.send("On Settings > Profile");
    await chat.confirmReport(chat.getState().pendingQuestion!.id);
    expect(chat.getState().reported).toBe(true);
    expect(s.backend.requests.map((p) => p.kind)).toEqual(["availability", "open", "follow", "follow"]);
    expect(s.backend.answers().map((a) => a.optionId)).toEqual(["approve"]);
    chat.destroy();
  });

  it("el `{{origin}}` sale del header Origin del pedido (así el enlace al propio sitio es el de la app que lo pide)", async () => {
    const s = await iniciar({ scenario: "link-to-another-site" });
    const r = await fetch(`${s.url}/api/chat/sesion`, { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ mensaje: "hi" }) });
    const texto = await r.text();
    expect(texto).toContain("http://localhost:5173/");
    expect(texto).not.toContain("{{origin}}");
  });

  it("lineDelayMs hace que el streaming se vea: las líneas llegan separadas", async () => {
    const s = await iniciar({ scenario: "question-answered", lineDelayMs: 30 });
    const t0 = Date.now();
    const r = await fetch(`${s.url}/api/chat/sesion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mensaje: "hi" }) });
    await r.text();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150); // 9 líneas a 30 ms
  });

  it("las rutas de control: lista los escenarios, cambia de uno y vuelve a empezar", async () => {
    const s = await iniciar({ scenario: "report-confirmed" });
    const lista = (await (await fetch(`${s.url}/__fake/scenarios`)).json()) as { current: string; scenarios: { name: string; description: string }[] };
    expect(lista.current).toBe("report-confirmed");
    expect(lista.scenarios.map((x) => x.name)).toContain("session-limit-mid-conversation");

    const cambio = await fetch(`${s.url}/__fake/scenario`, { method: "POST", body: JSON.stringify({ name: "terminal-error" }) });
    expect(cambio.status).toBe(200);
    expect(s.backend.scenario.name).toBe("terminal-error");
    expect((await fetch(`${s.url}/__fake/scenario`, { method: "POST", body: JSON.stringify({ name: "nope" }) })).status).toBe(404);

    await fetch(`${s.url}/api/chat/sesion`, { method: "POST", body: JSON.stringify({ mensaje: "hi" }) });
    const estado = (await (await fetch(`${s.url}/__fake/state`)).json()) as { scenario: string; remaining: number; requests: unknown[] };
    expect([estado.scenario, estado.remaining, estado.requests.length]).toEqual(["terminal-error", 0, 1]);
    expect((await fetch(`${s.url}/__fake/reset`, { method: "POST" })).status).toBe(200);
    expect(s.backend.remaining).toBe(1);
    expect(s.backend.requests).toEqual([]);
  });

  it("close() suelta el puerto", async () => {
    const s = await iniciar();
    const url = s.url;
    await s.close();
    servidor = undefined;
    await expect(fetch(`${url}/api/chat/estado`)).rejects.toThrow();
  });

  it("un escenario que no existe falla al arrancar, con la lista de los que hay", async () => {
    await expect(startFakeServer({ port: 0, scenario: "nope" })).rejects.toThrow(/nope.*report-confirmed/s);
  });

  it("las rutas de control NO llevan CORS abierto: `/__fake/state` tiene lo que la app mandó y ninguna página ajena debe poder leerlo (revisión 1, P3-4)", async () => {
    const s = await iniciar();
    for (const ruta of ["/__fake/state", "/__fake/scenarios"]) {
      const r = await fetch(`${s.url}${ruta}`, { headers: { origin: "http://evil.example" } });
      expect(r.status, ruta).toBe(200);
      expect(r.headers.get("access-control-allow-origin"), ruta).toBeNull();
    }
    const cambio = await fetch(`${s.url}/__fake/scenario`, { method: "POST", body: JSON.stringify({ name: "nope" }) });
    expect([cambio.status, cambio.headers.get("access-control-allow-origin")]).toEqual([404, null]);
  });

  it("un cuerpo más grande que el de la ruta real se rechaza con 413 `cuerpo_demasiado_grande`, como el backend", async () => {
    const s = await iniciar();
    const r = await fetch(`${s.url}/api/evidencias`, { method: "POST", body: "x".repeat(2_300_001) });
    expect([r.status, await r.json()]).toEqual([413, { ok: false, motivo: "cuerpo_demasiado_grande" }]);
    expect(s.backend.requests).toEqual([]); // no llegó al fake
  });
});
