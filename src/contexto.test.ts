import { afterEach, describe, expect, it, vi } from "vitest";
import { resumenDeContexto } from "./contexto";
import { normalizarOpciones } from "./opciones";

afterEach(() => vi.restoreAllMocks());

describe("resumenDeContexto", () => {
  it("por defecto manda url (sin query ni hash) y navegador, y la versión si la declararon", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contexto: { versionApp: "1.4.2" } });
    expect(resumenDeContexto(o, { location: { href: "https://app.cliente.com/cuenta?x=1#s" }, navigator: { userAgent: "UA" } })).toEqual({
      url: "https://app.cliente.com/cuenta", agente_usuario: "UA", version_app: "1.4.2",
    });
  });
  it("con contextoAutomatico:false sólo viaja lo declarado", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, contexto: { versionApp: "2" } });
    expect(resumenDeContexto(o, { location: { href: "https://x" }, navigator: { userAgent: "UA" } })).toEqual({ version_app: "2" });
  });
  it("sin nada que decir devuelve undefined, para no mandar un objeto vacío", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false });
    expect(resumenDeContexto(o, {})).toBeUndefined();
  });
  it("trunca url y agente_usuario a 500 chars, el mismo tope que valida el backend", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p" });
    const largo = "a".repeat(600);
    const r = resumenDeContexto(o, {
      location: { href: `https://app.cliente.com/${largo}` },
      navigator: { userAgent: largo },
    });
    expect(r?.url.length).toBe(500);
    expect(r?.agente_usuario.length).toBe(500);
  });
  it("2.3.0 (T0.6, N5): el usuario declarado viaja PLANO con claves sin ambigüedad: usr_id, usr_rol y una usr_attr_<clave> por atributo", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, usuario: { id: "u_123", rol: "admin", atributos: { plan: "pro", region: "ar" } } });
    expect(resumenDeContexto(o, {})).toEqual({ usr_id: "u_123", usr_rol: "admin", usr_attr_plan: "pro", usr_attr_region: "ar" });
  });
  it("2.3.0: ya no escribe ninguna clave usuario_* (las viejas son ambiguas y el backend las trata conservador)", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, usuario: { id: "u", rol: "r", atributos: { plan: "pro" } } });
    expect(Object.keys(resumenDeContexto(o, {})!).filter((k) => k.startsWith("usuario_"))).toEqual([]);
  });
  it("2.3.0: un atributo llamado id, rol o nombre no se manda y avisa en la consola; el usuario y el atributo no se pisan", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, usuario: { id: "123", rol: "admin", atributos: { id: "dato", rol: "otro", nombre: "Ana", plan: "pro" } } });
    const r = resumenDeContexto(o, {})!;
    expect(r).toEqual({ usr_id: "123", usr_rol: "admin", usr_attr_plan: "pro" });
    expect(JSON.stringify(r)).not.toContain("dato");
    expect(JSON.stringify(r)).not.toContain("Ana");
    expect(aviso).toHaveBeenCalledTimes(3);
    for (const [msg] of aviso.mock.calls) expect(String(msg)).toMatch(/^\[supcoflow\/chat\] /);
  });
  it("2.3.0: una clave de atributo que con el prefijo usr_attr_ pasaría las 48 del backend no se manda (avisa): con ella el backend rechazaría el turno entero", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, usuario: { atributos: { ["k".repeat(39)]: "si", ["l".repeat(40)]: "no" } } });
    const r = resumenDeContexto(o, {})!;
    expect(r).toEqual({ [`usr_attr_${"k".repeat(39)}`]: "si" });
    for (const k of Object.keys(r)) expect(k.length).toBeLessThanOrEqual(48);
    expect(aviso).toHaveBeenCalledTimes(1);
  });
  it("el nombre NUNCA sale del navegador, ni aunque el código del cliente lo pase: no hay clave que lo lleve", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", usuario: { id: "u_1", nombre: "Ana" } as unknown as { id: string } });
    const r = resumenDeContexto(o, { location: { href: "https://app.cliente.com/" }, navigator: { userAgent: "UA" } })!;
    expect(Object.keys(r)).toEqual(["url", "agente_usuario", "usr_id"]);
    expect(JSON.stringify(r)).not.toContain("Ana");
  });
  it("con todo declarado, el primer turno tiene 3 + 2 + 8 = 13 claves — con las tres de evidencia (2.3.0) llega justo al tope de 16 del backend", () => {
    const atributos = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`a${i}`, "v"]));
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contexto: { versionApp: "1" }, usuario: { id: "u", rol: "r", atributos } });
    expect(Object.keys(resumenDeContexto(o, { location: { href: "https://x" }, navigator: { userAgent: "UA" } })!)).toHaveLength(13);
  });
  it("2.2.0: el nombre EXISTE en las opciones y sigue sin salir del navegador — ninguna clave lo lleva", () => {
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, usuario: { nombre: "Ana", rol: "admin" } });
    const r = resumenDeContexto(o, {});
    expect(r).toEqual({ usr_rol: "admin" });
    expect(JSON.stringify(r)).not.toContain("Ana");
  });
  it("revisión de F0 (4): versionApp se recorta a 100 (una larga hacía rechazar el turno entero) y una vacía no viaja", () => {
    const larga = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, contexto: { versionApp: "x".repeat(1501) } });
    expect(resumenDeContexto(larga, {})!.version_app).toHaveLength(100);
    const vacia = normalizarOpciones({ tenantId: "t", projectId: "p", contextoAutomatico: false, contexto: { versionApp: "  " } });
    expect(resumenDeContexto(vacia, {})).toBeUndefined();
  });
  it("revisión de F0 (4): con todo al máximo, el contexto más la evidencia cumplen el contrato del backend (≤ 16 claves, clave ≤ 48, valor ≤ 1500)", () => {
    const atributos = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${"a".repeat(38)}${i}`, "v".repeat(300)]));
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contexto: { versionApp: "9".repeat(3000) }, usuario: { id: "u".repeat(300), rol: "r".repeat(300), atributos } });
    const base = resumenDeContexto(o, { location: { href: `https://a.com/${"u".repeat(3000)}` }, navigator: { userAgent: "U".repeat(3000) } })!;
    const todo = { ...base, evidencia: "e".repeat(1500) };
    expect(Object.keys(todo).length).toBeLessThanOrEqual(16);
    for (const [k, v] of Object.entries(todo)) {
      expect(k.length).toBeLessThanOrEqual(48);
      expect(v.length).toBeLessThanOrEqual(1500);
    }
  });
  it("B3: ningún valor del contexto automático pasa los 600 del backend (MAX_LARGO_DE_VALOR), ni con una URL y un user-agent enormes y todo declarado", () => {
    const largo = "x".repeat(5_000);
    const atributos = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`a${i}`, largo]));
    const o = normalizarOpciones({ tenantId: "t", projectId: "p", contexto: { versionApp: largo }, usuario: { id: largo, rol: largo, atributos } });
    const r = resumenDeContexto(o, { location: { href: `https://x.test/${largo}` }, navigator: { userAgent: largo } })!;
    for (const [k, v] of Object.entries(r)) expect(v.length, k).toBeLessThanOrEqual(600);
  });
});
