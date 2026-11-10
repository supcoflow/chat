import { describe, expect, it } from "vitest";
import { agregarCaptura, agregarElemento, etiquetaDelElemento, marcar, MAX_ADJUNTOS, pendientes, puedeAgregar, quitar, sellarReporte, sinAdjuntos, ultimoElemento, type EstadoDeAdjuntos } from "./adjuntos";
import type { ElementoSeleccionado } from "./elemento";
import type { ImagenLista } from "./captura";

export const ELEMENTO: ElementoSeleccionado = {
  page: { sanitizedUrl: "https://app.cliente.com/cuenta", title: "Cuenta", viewportWidth: 1440, viewportHeight: 900, scrollX: 0, scrollY: 0, devicePixelRatio: 2, capturedAt: "2026-09-06T00:00:00.000Z" },
  target: { tagName: "button", selector: "form#cuenta > button.guardar", elementPath: "#cuenta > .guardar", fullPath: "html > body > form#cuenta > button.guardar", cssClasses: "guardar", nearbyElements: [], selectedText: null, isFixed: false, textSnippet: "Guardar", htmlSnippet: '<button class="guardar">Guardar</button>', attributes: { class: "guardar", type: "submit" }, accessibility: { role: "button", accessibleName: "Guardar", ariaLabel: null, ariaLabelledBy: null }, rectViewport: { x: 10, y: 20, width: 100, height: 40 }, rectPage: { x: 10, y: 20, width: 100, height: 40 }, computedStyles: { display: "inline-block", position: "static", width: "100px", height: "40px", margin: "0px", padding: "8px", color: "rgb(255, 255, 255)", backgroundColor: "rgb(0, 0, 0)", border: "0px", borderRadius: "6px", fontFamily: "Inter", fontSize: "14px", fontWeight: "600", lineHeight: "20px", textAlign: "center", zIndex: "auto" } },
  nearbyText: ["Nombre", "Email"],
  ancestorPath: ["form", "main", "body"],
};
export const IMAGEN: ImagenLista = { base64: "AAAA", mime: "image/webp", ancho: 800, alto: 600, bytes: 3, miniatura: "data:image/webp;base64,AAAA" };

describe("la cola de adjuntos", () => {
  it("agrega en pendiente con clave creciente; el tope es 4 porque el motor cuenta 5 y el contexto de abrir ocupa uno", () => {
    let e = agregarElemento(sinAdjuntos(), ELEMENTO);
    e = agregarCaptura(e, IMAGEN);
    expect(e.adjuntos.map((a) => [a.clave, a.tipo, a.estado])).toEqual([[1, "elemento", "pendiente"], [2, "captura", "pendiente"]]);
    e = agregarCaptura(agregarCaptura(e, IMAGEN), IMAGEN);
    expect(puedeAgregar(e)).toBe(false);
    expect(e.adjuntos).toHaveLength(MAX_ADJUNTOS);
    expect(agregarCaptura(e, IMAGEN)).toBe(e); // lleno: no cambia
  });
  it("marcar cambia el estado y guarda el id o el motivo; quitar saca; pendientes filtra", () => {
    let e = agregarElemento(agregarCaptura(sinAdjuntos(), IMAGEN), ELEMENTO);
    e = marcar(e, 1, { estado: "subiendo" });
    e = marcar(e, 1, { estado: "listo", evidenciaId: "evd_1" });
    e = marcar(e, 2, { estado: "fallo", motivo: "tope_de_evidencias", reintentable: false });
    expect(e.adjuntos[0]).toMatchObject({ estado: "listo", evidenciaId: "evd_1" });
    expect(e.adjuntos[1]).toMatchObject({ estado: "fallo", motivo: "tope_de_evidencias", reintentable: false });
    expect(pendientes(e)).toEqual([]);
    e = marcar(e, 2, { estado: "pendiente", motivo: undefined });
    expect(pendientes(e).map((a) => a.clave)).toEqual([2]);
    e = quitar(e, 1);
    expect(e.adjuntos.map((a) => a.clave)).toEqual([2]);
    expect(quitar(e, 99)).toBe(e);
  });
  it("el reset de fin de sesión de Widget.tsx conserva siguienteClave — no reusa una clave de la sesión anterior (PR 3, hallazgo 2)", () => {
    let antes = agregarElemento(sinAdjuntos(), ELEMENTO); // clave 1
    antes = agregarCaptura(antes, IMAGEN); // clave 2, siguienteClave pasa a 3
    // La forma que Widget.tsx arma al terminar la sesión — a propósito, NO `sinAdjuntos()`:
    // ésa reinicia siguienteClave a 1, que es correcto sólo para el montaje inicial.
    const reset: EstadoDeAdjuntos = { adjuntos: [], siguienteClave: antes.siguienteClave };
    expect(reset).toEqual({ adjuntos: [], siguienteClave: 3 });
    const despues = agregarElemento(reset, ELEMENTO);
    expect(despues.adjuntos[0].clave).toBe(3); // nunca 1 ni 2: ya se usaron en la sesión anterior
  });
  it("ultimoElemento y la etiqueta del chip", () => {
    expect(ultimoElemento(sinAdjuntos())).toBeNull();
    const e = agregarElemento(sinAdjuntos(), ELEMENTO);
    expect(ultimoElemento(e)?.clave).toBe(1);
    expect(etiquetaDelElemento(ELEMENTO)).toBe("button «Guardar»");
    expect(etiquetaDelElemento({ ...ELEMENTO, target: { ...ELEMENTO.target, textSnippet: "", accessibility: { ...ELEMENTO.target.accessibility, accessibleName: null } } })).toBe("button");
    expect(etiquetaDelElemento({ ...ELEMENTO, target: { ...ELEMENTO.target, textSnippet: "x".repeat(80) } }).length).toBeLessThanOrEqual(50);
  });
});

// Revisión 2, P3-C: sólo lo que YA estaba subido cuando se creó el reporte fue con él; lo que termina de subir después no.
describe("sellarReporte: lo que fue con el reporte", () => {
  it("marca como `enReporte` sólo los adjuntos `listo`; los que subían, pendientes o fallidos no", () => {
    let e = agregarElemento(agregarCaptura(agregarCaptura(agregarCaptura(sinAdjuntos(), IMAGEN), IMAGEN), IMAGEN), ELEMENTO);
    e = marcar(e, 1, { estado: "listo", evidenciaId: "evd_1" });
    e = marcar(e, 2, { estado: "subiendo" });
    e = marcar(e, 3, { estado: "fallo", motivo: "red" });
    const s = sellarReporte(e);
    expect(s.adjuntos.map((a) => [a.clave, a.enReporte])).toEqual([[1, true], [2, false], [3, false], [4, false]]);
    // uno que termina de subir DESPUÉS del sello no entra en el reporte
    const despues = marcar(s, 2, { estado: "listo", evidenciaId: "evd_2" });
    expect(despues.adjuntos[1]).toMatchObject({ estado: "listo", enReporte: false });
  });
  it("no cambia nada si no hay adjuntos", () => {
    const vacio = sinAdjuntos();
    expect(sellarReporte(vacio)).toBe(vacio);
  });
});
