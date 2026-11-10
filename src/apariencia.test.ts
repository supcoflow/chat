import { describe, expect, it } from "vitest";
import { resolverApariencia } from "./apariencia";
import { TEMA_POR_DEFECTO } from "./opciones";

const marca = { logo_url: "https://blob.test/logo.png", titulo: "Example support", saludo: "Saludo de la marca", tema: { acento: "#0a0", fondo: "#fafafa" } };

describe("resolverApariencia", () => {
  it("sin marca: los defaults del widget (en inglés desde la 2.3.0), y el código encima (lo que normalizarOpciones hacía sola)", () => {
    expect(resolverApariencia({}, null)).toEqual({ titulo: "Help", logoUrl: null, saludo: "How can we help?", tema: TEMA_POR_DEFECTO });
    expect(resolverApariencia({ titulo: "Soporte", tema: { acento: "#f00" } }, undefined)).toEqual({ titulo: "Soporte", logoUrl: null, saludo: "How can we help?", tema: { ...TEMA_POR_DEFECTO, acento: "#f00" } });
  });
  it("la marca del motor va DEBAJO del código: el código gana campo a campo (§3.3 — un deploy es una decisión más deliberada que un formulario)", () => {
    const r = resolverApariencia({ tema: { acento: "#f00" } }, marca);
    expect(r).toEqual({ titulo: "Example support", logoUrl: "https://blob.test/logo.png", saludo: "Saludo de la marca", tema: { ...TEMA_POR_DEFECTO, acento: "#f00", fondo: "#fafafa" } });
    expect(resolverApariencia({ titulo: "Del código" }, marca).titulo).toBe("Del código");
  });
  it("un logo que no es https no se dibuja; el resto de la marca sí", () => {
    expect(resolverApariencia({}, { ...marca, logo_url: "javascript:alert(1)" }).logoUrl).toBeNull();
    expect(resolverApariencia({}, { ...marca, logo_url: "http://inseguro.test/l.png" }).logoUrl).toBeNull();
    expect(resolverApariencia({}, { ...marca, logo_url: null }).titulo).toBe("Example support");
  });
  it("una marca malformada (basura de un backend raro) no rompe el montaje: defaults", () => {
    expect(resolverApariencia({}, "x")).toEqual({ titulo: "Help", logoUrl: null, saludo: "How can we help?", tema: TEMA_POR_DEFECTO });
    expect(resolverApariencia({}, { tema: { acento: 3, desconocida: "#000" }, titulo: 7 })).toEqual({ titulo: "Help", logoUrl: null, saludo: "How can we help?", tema: TEMA_POR_DEFECTO });
  });
  it("2.2.0: el saludo se resuelve en los tres niveles, como el título", () => {
    expect(resolverApariencia({}, null).saludo).toBe("How can we help?");
    expect(resolverApariencia({}, marca).saludo).toBe("Saludo de la marca");
    expect(resolverApariencia({}, { ...marca, saludo: "Contanos qué pasó" }).saludo).toBe("Contanos qué pasó");
    expect(resolverApariencia({ saludo: "Del código" }, { ...marca, saludo: "De la marca" }).saludo).toBe("Del código");
    expect(resolverApariencia({}, { ...marca, saludo: "   " }).saludo).toBe("How can we help?");
  });
});
