import { describe, expect, it } from "vitest";
import {
  BACKEND_POR_DEFECTO,
  MAX_ATRIBUTO_VALOR,
  MAX_USUARIO_ID,
  MAX_USUARIO_ROL,
  normalizarOpciones,
  normalizarUsuario,
  opcionesDesdeDataset,
  TEMA_POR_DEFECTO,
} from "./opciones";

describe("normalizarOpciones", () => {
  it("completa los defaults del §1.4 y §2.1 del diseño", () => {
    expect(normalizarOpciones({ tenantId: "tnt_a", projectId: "proj_b" })).toEqual({
      tenantId: "tnt_a", projectId: "proj_b", backendUrl: BACKEND_POR_DEFECTO, modo: "burbuja", posicion: "derecha",
      titulo: "Help", saludo: undefined, abierto: false, tema: TEMA_POR_DEFECTO, contexto: {}, contextoAutomatico: true,
      onDiagnostico: undefined, usuario: {}, previewToken: null, onEvento: undefined,
    });
  });
  it("quita la barra final del backendUrl (el 308 sin CORS del motor)", () => {
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", backendUrl: "https://x.com/" }).backendUrl).toBe("https://x.com");
  });
  it("mezcla el tema parcial sobre el default sin perder las otras variables", () => {
    const r = normalizarOpciones({ tenantId: "t", projectId: "p", tema: { acento: "#f00" } });
    expect(r.tema.acento).toBe("#f00");
    expect(r.tema.fondo).toBe(TEMA_POR_DEFECTO.fondo);
  });
  it("lanza si falta el inquilino o el proyecto: sin ellos no hay a quién preguntarle nada", () => {
    expect(() => normalizarOpciones({ tenantId: "", projectId: "p" })).toThrow(/tenantId/);
    expect(() => normalizarOpciones({ tenantId: "t", projectId: "  " })).toThrow(/projectId/);
  });
});

describe("normalizarUsuario", () => {
  it("conserva id, rol y atributos con las cotas del §4.1 (recortando, no lanzando: es contexto opcional dentro del sitio de un tercero)", () => {
    expect(normalizarUsuario({ id: "u_123", rol: " admin ", atributos: { plan: "pro", region: "ar" } })).toEqual({ id: "u_123", rol: "admin", atributos: { plan: "pro", region: "ar" } });
    const r = normalizarUsuario({ id: "i".repeat(150), rol: "r".repeat(80), atributos: { ["k".repeat(50)]: "v", plan: "p".repeat(300) } });
    expect(r.id).toHaveLength(MAX_USUARIO_ID);
    expect(r.rol).toHaveLength(MAX_USUARIO_ROL);
    expect(r.atributos).toEqual({ plan: "p".repeat(MAX_ATRIBUTO_VALOR) }); // la clave de 50 se descarta
  });
  it("descarta cualquier clave que no sea id, nombre, rol o atributos — en particular `email`, que no está en la whitelist", () => {
    expect(normalizarUsuario({ id: "u", nombre: "Ana", email: "g@x" } as unknown)).toEqual({ id: "u", nombre: "Ana" });
  });
  it("hasta 8 atributos en orden de inserción; `id` y `rol` no valen como atributo (colisionarían con las claves planas del contexto); valores vacíos o no-string se ignoran", () => {
    const muchos = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, "v"]));
    expect(Object.keys(normalizarUsuario({ atributos: muchos }).atributos!)).toEqual(["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
    expect(normalizarUsuario({ atributos: { id: "x", rol: "y", plan: "pro", vacio: "  ", numero: 3 as unknown as string } })).toEqual({ atributos: { plan: "pro" } });
  });
  it("lo que no es un objeto es un usuario vacío", () => {
    expect(normalizarUsuario(undefined)).toEqual({});
    expect(normalizarUsuario("u_1")).toEqual({});
    expect(normalizarUsuario(null)).toEqual({});
  });
});

describe("previewToken", () => {
  it("es interna: vacía o ausente es null; con valor viaja tal cual", () => {
    expect(normalizarOpciones({ tenantId: "t", projectId: "p" }).previewToken).toBeNull();
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", previewToken: "" }).previewToken).toBeNull();
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", previewToken: "v1.t.p.9.f" }).previewToken).toBe("v1.t.p.9.f");
  });
  it("no tiene data-* en el IIFE: un dataset con previewToken se ignora", () => {
    expect(opcionesDesdeDataset({ tenant: "t", project: "p", previewToken: "v1" })).toEqual({ tenantId: "t", projectId: "p" });
  });
});

describe("opcionesDesdeDataset", () => {
  it("traduce los data-* del <script> a opciones", () => {
    expect(opcionesDesdeDataset({ tenant: "tnt_a", project: "proj_b", backend: "https://x/", posicion: "izquierda", titulo: "Soporte", acento: "#0a0", versionApp: "3.1", contextoAutomatico: "false" })).toEqual({
      tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://x/", posicion: "izquierda", titulo: "Soporte",
      tema: { acento: "#0a0" }, contexto: { versionApp: "3.1" }, contextoAutomatico: false,
    });
  });
  it("sólo tenant y project: el resto queda para los defaults de normalizarOpciones", () => {
    expect(opcionesDesdeDataset({ tenant: "t", project: "p" })).toEqual({ tenantId: "t", projectId: "p" });
  });
  it("una posición desconocida se ignora en vez de romper el montaje", () => {
    expect(opcionesDesdeDataset({ tenant: "t", project: "p", posicion: "arriba" })).toEqual({ tenantId: "t", projectId: "p" });
  });
  it("data-usuario-id y data-usuario-rol arman `usuario` (sin atributos: un <script> no lleva objetos)", () => {
    expect(opcionesDesdeDataset({ tenant: "t", project: "p", usuarioId: "u_1", usuarioRol: "admin" })).toEqual({ tenantId: "t", projectId: "p", usuario: { id: "u_1", rol: "admin" } });
    expect(opcionesDesdeDataset({ tenant: "t", project: "p", usuarioRol: "admin" })).toEqual({ tenantId: "t", projectId: "p", usuario: { rol: "admin" } });
  });
});

describe("2.2.0: saludo, nombre, abierto y onEvento", () => {
  it("saludo viaja como opción pública y se recorta a 140, como el tope del motor", () => {
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", saludo: "  ¿En qué te ayudamos?  " }).saludo).toBe("¿En qué te ayudamos?");
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", saludo: "x".repeat(200) }).saludo).toHaveLength(140);
    expect(normalizarOpciones({ tenantId: "t", projectId: "p" }).saludo).toBeUndefined();
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", saludo: "   " }).saludo).toBeUndefined();
  });
  it("usuario.nombre se acepta y se recorta a 80; sólo lo usa el saludo", () => {
    expect(normalizarUsuario({ nombre: "  Ana  ", rol: "admin" })).toEqual({ nombre: "Ana", rol: "admin" });
    expect(normalizarUsuario({ nombre: "x".repeat(100) }).nombre).toHaveLength(80);
    expect(normalizarUsuario({ nombre: 7 })).toEqual({});
  });
  it("`nombre` no vale como atributo: colisionaría con el saludo y la promesa de que no viaja", () => {
    expect(normalizarUsuario({ atributos: { nombre: "Ana", plan: "pro" } })).toEqual({ atributos: { plan: "pro" } });
  });
  it("abierto: false por defecto; true sólo si es exactamente true", () => {
    expect(normalizarOpciones({ tenantId: "t", projectId: "p" }).abierto).toBe(false);
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", abierto: true }).abierto).toBe(true);
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", abierto: "sí" as unknown as boolean }).abierto).toBe(false);
  });
  it("onEvento es interna: se conserva si es función y no tiene data-*", () => {
    const f = () => {};
    expect(normalizarOpciones({ tenantId: "t", projectId: "p", onEvento: f }).onEvento).toBe(f);
    expect(normalizarOpciones({ tenantId: "t", projectId: "p" }).onEvento).toBeUndefined();
    expect(opcionesDesdeDataset({ tenant: "t", project: "p", onEvento: "x" } as Record<string, string>)).not.toHaveProperty("onEvento");
  });
  it("el dataset trae data-saludo, data-usuario-nombre y data-abierto", () => {
    expect(opcionesDesdeDataset({ tenant: "t", project: "p", saludo: "Hola", usuarioNombre: "Ana", abierto: "true" })).toEqual({
      tenantId: "t", projectId: "p", saludo: "Hola", usuario: { nombre: "Ana" }, abierto: true,
    });
    expect(opcionesDesdeDataset({ tenant: "t", project: "p", abierto: "false" })).not.toHaveProperty("abierto");
  });
});
