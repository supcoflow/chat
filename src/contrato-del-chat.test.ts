import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as contrato from "./contrato-del-chat";

// El contrato del navegador con el backend del chat (protocolo v1), escrito UNA vez. Estos valores son el protocolo: cambiar uno rompe a los sitios que ya tienen el widget instalado, así que se clavan acá.

describe("contrato-del-chat: los encabezados del protocolo v1", () => {
  it("son exactamente estos seis, con estos nombres", () => {
    expect(contrato.ENCABEZADOS_DEL_CHAT).toEqual({
      tenant: "x-supcoflow-tenant",
      project: "x-supcoflow-project",
      preview: "x-supcoflow-preview",
      sdk: "x-supcoflow-sdk",
      locale: "x-supcoflow-locale",
      capacidades: "x-supcoflow-capabilities",
    });
  });
  it("la lista que el CORS permite es `content-type` más cada uno, en ese orden y sin repetidos (el navegador corta antes del POST si falta uno)", () => {
    expect(contrato.ENCABEZADOS_PERMITIDOS_EN_CORS).toEqual(["content-type", ...Object.values(contrato.ENCABEZADOS_DEL_CHAT)]);
    expect(new Set(contrato.ENCABEZADOS_PERMITIDOS_EN_CORS).size).toBe(contrato.ENCABEZADOS_PERMITIDOS_EN_CORS.length);
  });
  it("los nombres de las capacidades son los cuatro cerrados, en el orden en que viajan", () => {
    expect(contrato.CAPACIDADES_DEL_CHAT).toEqual(["pickElement", "screenshot", "attachImage", "newConversation"]);
  });
});

describe("contrato-del-chat: los topes del usuario declarado y de las claves del contexto", () => {
  it("son los del §4.1 de la marca (espejados en el motor)", () => {
    expect(contrato.TOPES_DEL_USUARIO).toEqual({ id: 100, rol: 60, atributos: 8, claveDeAtributo: 40, valorDeAtributo: 200 });
    expect(contrato.MAX_LARGO_DE_CLAVE_DEL_CONTEXTO).toBe(48);
  });
});

describe("contrato-del-chat: es el único lugar", () => {
  const RAIZ = join(__dirname);
  function fuentes(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const ruta = join(dir, n);
      if (n === "node_modules") return [];
      return statSync(ruta).isDirectory() ? fuentes(ruta) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [ruta] : [];
    });
  }
  it("ningún otro archivo del widget escribe a mano un encabezado del protocolo", () => {
    const quien = fuentes(RAIZ)
      .filter((r) => /x-supcoflow-(tenant|project|preview|sdk|locale|capabilities)/.test(readFileSync(r, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")))
      .map((r) => relative(RAIZ, r));
    expect(quien).toEqual(["contrato-del-chat.ts"]);
  });
});
