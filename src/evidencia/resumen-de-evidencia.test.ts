import { describe, expect, it } from "vitest";
import { agregarCaptura, agregarElemento, marcar, sinAdjuntos } from "./adjuntos";
import { ELEMENTO, IMAGEN } from "./adjuntos.test";
import { contextoDeEvidencia, MAX_RESUMEN_CHARS, MAX_VALOR_DE_CONTEXTO, resumenDelElemento } from "./resumen-de-evidencia";

describe("resumenDelElemento", () => {
  it("dice qué señaló el usuario con tag, texto, selector, ruta y dos líneas de estilo — sin HTML, sin ids", () => {
    const r = resumenDelElemento(ELEMENTO);
    expect(r).toContain("<button>");
    expect(r).toContain('"Guardar"');
    expect(r).toContain("form#cuenta > button.guardar");
    expect(r).toContain("#cuenta > .guardar");
    expect(r).toContain("display inline-block");
    expect(r).toContain("color rgb(255, 255, 255)");
    expect(r).not.toContain("<button class");
    expect(r).not.toContain("evd_");
  });
  it("2.3.0 (T0.6, R1): SIN la URL de la página — la página pide otro permiso y viaja en su propia clave", () => {
    const r = resumenDelElemento({ ...ELEMENTO, page: { ...ELEMENTO.page, sanitizedUrl: "https://canario-pagina.test/x" } });
    expect(r).not.toContain("canario-pagina");
    expect(r).not.toContain("https://");
  });
  it("las etiquetas que arma el widget están en inglés (alarma parcial: los datos del elemento son del cliente)", () => {
    const ascii = { ...ELEMENTO, target: { ...ELEMENTO.target, textSnippet: "Save", accessibility: { ...ELEMENTO.target.accessibility, accessibleName: "Save" } } };
    expect(resumenDelElemento(ascii)).not.toMatch(/[¿¡ñáéíóúÁÉÍÓÚÑ]/);
    expect(resumenDelElemento(ascii)).toBe(
      '<button> "Save"; selector: form#cuenta > button.guardar; path: #cuenta > .guardar; style: display inline-block, position static, 100px×40px; color rgb(255, 255, 255), background rgb(0, 0, 0), font Inter 14px',
    );
  });
  it("nunca pasa el tope, aunque el elemento venga al límite de Orca", () => {
    const gordo = { ...ELEMENTO, target: { ...ELEMENTO.target, selector: "s".repeat(712), elementPath: "p".repeat(912), textSnippet: "t".repeat(212) }, page: { ...ELEMENTO.page, sanitizedUrl: `https://a.com/${"u".repeat(1900)}` } };
    expect(resumenDelElemento(gordo).length).toBeLessThanOrEqual(MAX_RESUMEN_CHARS);
  });
});

describe("contextoDeEvidencia (2.3.0, T0.6): tres claves planas, una por permiso", () => {
  it("sin adjuntos es undefined: no se manda ninguna clave", () => {
    expect(contextoDeEvidencia([])).toBeUndefined();
  });
  it("con elemento y capturas: evidencia_elemento (sin URL), evidencia_elemento_pagina (la URL) y evidencia_capturas (la cuenta); nunca `evidencia`", () => {
    let e = agregarElemento(sinAdjuntos(), ELEMENTO);
    e = agregarCaptura(agregarCaptura(e, IMAGEN), IMAGEN);
    const c = contextoDeEvidencia(e.adjuntos)!;
    expect(Object.keys(c).sort()).toEqual(["evidencia_capturas", "evidencia_elemento", "evidencia_elemento_pagina"]);
    expect(c.evidencia_elemento).toBe(resumenDelElemento(ELEMENTO));
    expect(c.evidencia_elemento).not.toContain("https://app.cliente.com/cuenta");
    expect(c.evidencia_elemento_pagina).toBe("https://app.cliente.com/cuenta");
    expect(c.evidencia_capturas).toBe("2");
    expect(c).not.toHaveProperty("evidencia");
  });
  it("sólo capturas: sólo evidencia_capturas; un adjunto en fallo no cuenta (no va a llegar al reporte)", () => {
    let e = agregarCaptura(agregarCaptura(sinAdjuntos(), IMAGEN), IMAGEN);
    e = marcar(e, 2, { estado: "fallo", motivo: "red" });
    expect(contextoDeEvidencia(e.adjuntos)).toEqual({ evidencia_capturas: "1" });
  });
  it("sólo un elemento: sin evidencia_capturas", () => {
    expect(Object.keys(contextoDeEvidencia(agregarElemento(sinAdjuntos(), ELEMENTO).adjuntos)!).sort()).toEqual(["evidencia_elemento", "evidencia_elemento_pagina"]);
  });
  it("con dos elementos, el del ÚLTIMO", () => {
    const otro = { ...ELEMENTO, target: { ...ELEMENTO.target, tagName: "a" }, page: { ...ELEMENTO.page, sanitizedUrl: "https://app.cliente.com/otra" } };
    const c = contextoDeEvidencia(agregarElemento(agregarElemento(sinAdjuntos(), ELEMENTO), otro).adjuntos)!;
    expect(c.evidencia_elemento).toContain("<a>");
    expect(c.evidencia_elemento_pagina).toBe("https://app.cliente.com/otra");
  });
  it("sin el permiso pagina_y_navegador (T0.5) la página del elemento no viaja; el elemento sí", () => {
    const c = contextoDeEvidencia(agregarElemento(sinAdjuntos(), ELEMENTO).adjuntos, { paginaYNavegador: false })!;
    expect(c).toEqual({ evidencia_elemento: resumenDelElemento(ELEMENTO) });
  });
  it("cada valor queda por debajo del tope del backend, con el elemento a los presupuestos propios de Orca", () => {
    const gordo = {
      ...ELEMENTO,
      page: { ...ELEMENTO.page, sanitizedUrl: `https://a.com/${"u".repeat(2000)}` },
      target: {
        ...ELEMENTO.target,
        selector: "s".repeat(700),
        elementPath: "p".repeat(900),
        accessibility: { ...ELEMENTO.target.accessibility, accessibleName: "n".repeat(300) },
        computedStyles: Object.fromEntries(Object.keys(ELEMENTO.target.computedStyles).map((k) => [k, "v".repeat(200)])),
      },
    };
    const c = contextoDeEvidencia(agregarElemento(sinAdjuntos(), gordo).adjuntos)!;
    for (const v of Object.values(c)) expect(v.length).toBeLessThanOrEqual(MAX_VALOR_DE_CONTEXTO);
  });
  it("sin el permiso elementos (acuerdo de datos) no viaja ni el elemento ni su página; sin capturas no viaja la cuenta", () => {
    let e = agregarElemento(sinAdjuntos(), ELEMENTO);
    e = agregarCaptura(e, IMAGEN);
    expect(contextoDeEvidencia(e.adjuntos, { elementos: false, paginaYNavegador: true, capturas: true })).toEqual({ evidencia_capturas: "1" });
    expect(Object.keys(contextoDeEvidencia(e.adjuntos, { elementos: true, paginaYNavegador: true, capturas: false })!).sort()).toEqual(["evidencia_elemento", "evidencia_elemento_pagina"]);
    expect(contextoDeEvidencia(e.adjuntos, { elementos: false, paginaYNavegador: false, capturas: false })).toBeUndefined();
  });
});
