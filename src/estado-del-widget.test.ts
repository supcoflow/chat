import { describe, expect, it } from "vitest";
import { decidirVisibilidad, diagnosticoDesdeRespuesta, normalizarBackendUrl, permisosDesdeRespuesta } from "./estado-del-widget";

describe("decidirVisibilidad", () => {
  it("visible solo con un {ok:true} del estado", () => {
    expect(decidirVisibilidad({ respuesta: { ok: true }, huboError: false })).toBe("visible");
  });
  it("oculto ante rechazo, error de red, o respuesta ilegible — el widget no explica, desaparece", () => {
    expect(decidirVisibilidad({ respuesta: { ok: false }, huboError: false })).toBe("oculto");
    expect(decidirVisibilidad({ respuesta: null, huboError: true })).toBe("oculto");
    expect(decidirVisibilidad({ respuesta: null, huboError: false })).toBe("oculto");
  });
});

describe("normalizarBackendUrl", () => {
  it("saca la barra final para evitar // duplicado en las URLs armadas", () => {
    expect(normalizarBackendUrl("https://x.com/")).toBe("https://x.com");
  });
  it("no toca una URL que ya viene sin barra final", () => {
    expect(normalizarBackendUrl("https://x.com")).toBe("https://x.com");
  });
});

describe("diagnosticoDesdeRespuesta", () => {
  it("200 ok → visible, sin motivo", () => {
    expect(diagnosticoDesdeRespuesta({ status: 200, cuerpo: { ok: true, motivo: null }, huboError: false })).toEqual({ visible: true, status: 200, motivo: null });
  });
  it("403 con motivo → oculto y el motivo tal cual (el 403 dejó de significar dos cosas)", () => {
    expect(diagnosticoDesdeRespuesta({ status: 403, cuerpo: { ok: false, motivo: "origen_no_admitido" }, huboError: false })).toEqual({ visible: false, status: 403, motivo: "origen_no_admitido" });
  });
  it("un backend viejo sin motivo → oculto con motivo null, nunca inventado", () => {
    expect(diagnosticoDesdeRespuesta({ status: 403, cuerpo: { ok: false }, huboError: false }).motivo).toBeNull();
  });
  it("error de red → status 0 y motivo sin_respuesta", () => {
    expect(diagnosticoDesdeRespuesta({ status: 0, cuerpo: null, huboError: true })).toEqual({ visible: false, status: 0, motivo: "sin_respuesta" });
  });
});

describe("permisosDesdeRespuesta (T0.5): lo que el widget ofrece según el acuerdo de datos", () => {
  const TODO = { capturas: true, elementos: true, paginaYNavegador: true };
  it("sin `permite` (backend viejo, o sin acuerdo fijado) es como hoy: todo", () => {
    expect(permisosDesdeRespuesta({ ok: true })).toEqual(TODO);
    expect(permisosDesdeRespuesta(null)).toEqual(TODO);
    expect(permisosDesdeRespuesta({ ok: true, permite: null })).toEqual(TODO);
  });
  it("cada permiso en false apaga sólo lo suyo", () => {
    expect(permisosDesdeRespuesta({ permite: { capturas: false, elementos: true, pagina_y_navegador: true } })).toEqual({ ...TODO, capturas: false });
    expect(permisosDesdeRespuesta({ permite: { capturas: true, elementos: false, pagina_y_navegador: true } })).toEqual({ ...TODO, elementos: false });
    expect(permisosDesdeRespuesta({ permite: { capturas: true, elementos: true, pagina_y_navegador: false } })).toEqual({ ...TODO, paginaYNavegador: false });
    expect(permisosDesdeRespuesta({ permite: { capturas: false, elementos: false, pagina_y_navegador: false } })).toEqual({ capturas: false, elementos: false, paginaYNavegador: false });
  });
  it("sólo un false explícito apaga: un campo ausente o raro deja lo de hoy (es comodidad, el control es del backend)", () => {
    expect(permisosDesdeRespuesta({ permite: {} })).toEqual(TODO);
    expect(permisosDesdeRespuesta({ permite: { capturas: "no", elementos: 0 } })).toEqual(TODO);
    expect(permisosDesdeRespuesta({ permite: "x" })).toEqual(TODO);
  });
});
