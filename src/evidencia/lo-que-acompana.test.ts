import { describe, expect, it } from "vitest";
import { agregarCaptura, agregarElemento, marcar, quitar, sinAdjuntos } from "./adjuntos";
import { ELEMENTO, IMAGEN } from "./adjuntos.test";
import { lineaDeLoQueAcompana } from "./lo-que-acompana";

// §4.2 de la revisión de las herramientas (2026-10-30): la línea que acompaña a la confirmación dice lo que VIAJA con el reporte —los adjuntos ya subidos— y
// aparte lo que todavía no está. Sin adjuntos no hay línea.
describe("lineaDeLoQueAcompana", () => {
  it("sin adjuntos, ninguna línea", () => {
    expect(lineaDeLoQueAcompana(sinAdjuntos().adjuntos)).toBeNull();
  });
  it("cuenta lo ya subido por tipo, en singular y plural", () => {
    let e = agregarElemento(sinAdjuntos(), ELEMENTO);
    e = marcar(e, 1, { estado: "listo", evidenciaId: "evd_1" });
    expect(lineaDeLoQueAcompana(e.adjuntos)).toBe("Your attachments that go with it: 1 pointed element.");
    e = agregarCaptura(agregarCaptura(e, IMAGEN), IMAGEN);
    e = marcar(marcar(e, 2, { estado: "listo", evidenciaId: "evd_2" }), 3, { estado: "listo", evidenciaId: "evd_3" });
    expect(lineaDeLoQueAcompana(e.adjuntos)).toBe("Your attachments that go with it: 2 images, 1 pointed element.");
  });
  it("lo que está subiendo, pendiente o falló NO va con el reporte: se dice aparte", () => {
    let e = agregarElemento(agregarCaptura(sinAdjuntos(), IMAGEN), ELEMENTO);
    e = marcar(e, 1, { estado: "listo", evidenciaId: "evd_1" });
    e = marcar(e, 2, { estado: "fallo", motivo: "red" });
    expect(lineaDeLoQueAcompana(e.adjuntos)).toBe("Your attachments that go with it: 1 image. Not attached yet: 1.");
    const solo = marcar(agregarCaptura(sinAdjuntos(), IMAGEN), 1, { estado: "subiendo" });
    expect(lineaDeLoQueAcompana(solo.adjuntos)).toBe("Not attached yet: 1.");
  });
  it("un adjunto quitado de la lista (pendiente o fallo) ya no cuenta; es lo que «Remove» hace de verdad", () => {
    let e = agregarCaptura(sinAdjuntos(), IMAGEN);
    e = quitar(e, 1);
    expect(lineaDeLoQueAcompana(e.adjuntos)).toBeNull();
  });
});
