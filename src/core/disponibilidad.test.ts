import { describe, expect, it, vi } from "vitest";
import { normalizarOpciones } from "../opciones";
import { consultarDisponibilidad } from "./disponibilidad";

const opciones = normalizarOpciones({ tenantId: "tnt a", projectId: "proj_b", backendUrl: "https://chat.test/" });
function fetchQue(r: Response | Error) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
}

describe("consultarDisponibilidad (GET /api/chat/estado)", () => {
  it("pregunta por los ids escapados y SIN headers de más: el GET sigue siendo un pedido simple, sin preflight", async () => {
    const f = fetchQue(Response.json({ ok: true, motivo: null, marca: { titulo: "Ayuda" } }));
    const r = await consultarDisponibilidad(opciones, f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("https://chat.test/api/chat/estado?tenant_id=tnt%20a&project_id=proj_b");
    expect(init).toBeUndefined();
    expect(r).toEqual({ status: 200, cuerpo: { ok: true, motivo: null, marca: { titulo: "Ayuda" } }, huboError: false });
  });
  it("con token de preview lo manda en x-supcoflow-preview (es lo que hace que el motor conteste ok desde la consola)", async () => {
    const f = fetchQue(Response.json({ ok: true }));
    await consultarDisponibilidad({ ...opciones, previewToken: "v1.t.p.9.f" }, f);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ "x-supcoflow-preview": "v1.t.p.9.f" });
  });
  it("un 403 con motivo llega entero; un cuerpo ilegible es null; un fallo de red es huboError", async () => {
    expect(await consultarDisponibilidad(opciones, fetchQue(Response.json({ ok: false, motivo: "origen_no_admitido" }, { status: 403 })))).toEqual({ status: 403, cuerpo: { ok: false, motivo: "origen_no_admitido" }, huboError: false });
    expect(await consultarDisponibilidad(opciones, fetchQue(new Response("<html>", { status: 502 })))).toEqual({ status: 502, cuerpo: null, huboError: false });
    expect(await consultarDisponibilidad(opciones, fetchQue(new TypeError("Failed to fetch")))).toEqual({ status: 0, cuerpo: null, huboError: true });
  });
});
