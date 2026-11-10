// @vitest-environment happy-dom
import { h, render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { agregarCaptura, agregarElemento, marcar, sellarReporte, sinAdjuntos } from "../evidencia/adjuntos";
import { ELEMENTO, IMAGEN } from "../evidencia/adjuntos.test";
import { Adjuntos } from "./Adjuntos";

// Revisión 2, P3-C, con el componente REAL: después del reporte lo que ya estaba subido dice que FUE con él; lo que termina de subir después no lo dice; y no se ofrece «Retry».
const cont = document.createElement("div");
afterEach(() => render(null, cont));
function dibujar(adjuntos: ReturnType<typeof sinAdjuntos>, reportado: boolean) {
  render(h(Adjuntos, { adjuntos: adjuntos.adjuntos, ocupado: false, aviso: null, reportado, onCapturarElemento: null, onQuitar: () => {}, onReintentar: () => {} }), cont);
  return cont;
}
const reintentar = (c: HTMLElement) => [...c.querySelectorAll("button")].filter((b) => b.textContent === "Retry");

describe("Adjuntos después del reporte", () => {
  it("antes del reporte: «Attached. It goes with your report if you send one.» y «Retry» en lo que falló", () => {
    let e = agregarCaptura(agregarCaptura(sinAdjuntos(), IMAGEN), IMAGEN);
    e = marcar(marcar(e, 1, { estado: "listo", evidenciaId: "evd_1" }), 2, { estado: "fallo", motivo: "red", reintentable: true });
    const c = dibujar(e, false);
    expect(c.querySelector(".scf-aviso")!.textContent).toBe("Attached. It goes with your report if you send one.");
    expect(reintentar(c)).toHaveLength(1);
  });
  it("después del reporte: lo sellado dice que FUE con él, no hay «Retry», y nada que no estuviera listo lo dice", () => {
    let e = agregarElemento(agregarCaptura(agregarCaptura(sinAdjuntos(), IMAGEN), IMAGEN), ELEMENTO);
    e = marcar(e, 1, { estado: "listo", evidenciaId: "evd_1" });
    e = marcar(e, 2, { estado: "subiendo" });
    e = marcar(e, 3, { estado: "fallo", motivo: "red", reintentable: true });
    e = sellarReporte(e);
    e = marcar(e, 2, { estado: "listo", evidenciaId: "evd_2" }); // termina de subir DESPUÉS del reporte
    const c = dibujar(e, true);
    expect(c.querySelector(".scf-aviso")!.textContent).toBe("Attached. It was sent with your report.");
    expect(reintentar(c)).toHaveLength(0);
    const titulos = [...c.querySelectorAll(".scf-adjunto")].map((n) => n.getAttribute("title"));
    expect(titulos[0]).toBe("Attached. It was sent with your report."); // sellado
    expect(titulos[1]).toBe("Attached"); // subió después: sin la promesa
    expect(titulos[2]).toBe("Couldn't attach.");
  });
  it("si lo único que está listo subió después del reporte, no hay aviso", () => {
    let e = agregarCaptura(sinAdjuntos(), IMAGEN);
    e = marcar(e, 1, { estado: "subiendo" });
    e = sellarReporte(e);
    e = marcar(e, 1, { estado: "listo", evidenciaId: "evd_1" });
    expect(dibujar(e, true).querySelector(".scf-aviso")).toBeNull();
  });
});
