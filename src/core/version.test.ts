import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cabeceraDelSdk, ENCABEZADO_SDK, SDK_VERSION } from "./version";

describe("la versión que viaja en x-supcoflow-sdk", () => {
  it("es la del paquete: subir la versión de package.json sin tocar version.ts falla acá, no en la consola de alguien", () => {
    const paquete = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(SDK_VERSION).toBe(paquete.version);
  });
  it("lleva la superficie y la versión: «core/x.y.z» o «widget/x.y.z»", () => {
    expect(ENCABEZADO_SDK).toBe("x-supcoflow-sdk");
    expect(cabeceraDelSdk("core")).toBe(`core/${SDK_VERSION}`);
    expect(cabeceraDelSdk("widget")).toBe(`widget/${SDK_VERSION}`);
  });
  it("con la huella del build la etiqueta lleva `+huella` (build metadata de semver): la misma etiqueta no puede ser código distinto; sin huella (el fuente, los tests) es la versión a secas", () => {
    expect(cabeceraDelSdk("widget", "ab12cd34")).toBe(`widget/${SDK_VERSION}+ab12cd34`);
    expect(cabeceraDelSdk("core", "ab12cd34")).toBe(`core/${SDK_VERSION}+ab12cd34`);
    expect(cabeceraDelSdk("core", "")).toBe(`core/${SDK_VERSION}`);
    expect(cabeceraDelSdk("core", undefined)).toBe(`core/${SDK_VERSION}`);
  });
  it("`CORE_VERSION` (la versión pública del paquete) sigue siendo la del paquete, sin huella", () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
