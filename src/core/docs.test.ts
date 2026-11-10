import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIVIDADES_V1, CODIGOS_DE_ERROR_V1, DESENLACES_V1, PASOS_V1, TIPOS_DE_EVENTO_V1 } from "../protocolo";
import * as modulo from "./index";
import { createSupportChat } from "./soporte";
import { estadoPublico, TIPOS_DE_EVENTO_PUBLICO } from "./traducir";
import { estadoInicial } from "../estado";
import { FORMA_V1 } from "../validar-evento";
import { sinAdjuntos } from "../evidencia/adjuntos";
import { PERMISOS_COMO_HOY } from "../estado-del-widget";

// La documentación es parte del contrato (plan de las tres formas, B3): «cambiar un evento sin cambiar su documento hace fallar un test». Estos
// tests no leen prosa; leen los ENCABEZADOS y las tablas que otras interfaces (y personas) usan para saber qué esperar.
const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));
const protocolo = readFileSync(`${DOCS}protocol-v1.md`, "utf8");
const nucleo = readFileSync(`${DOCS}core.md`, "utf8");

/** Los `#### \`nombre\`` que hay dentro de la sección `## … / ### titulo`, hasta el próximo encabezado de nivel 3 o menos. */
function encabezadosDe(md: string, seccion: string): string[] {
  const desde = md.indexOf(`### ${seccion}`) >= 0 ? md.indexOf(`### ${seccion}`) : md.indexOf(`## ${seccion}`);
  expect(desde, `no hay una sección «${seccion}»`).toBeGreaterThanOrEqual(0);
  const resto = md.slice(desde + 4);
  const fin = resto.search(/\n#{1,3} /);
  const cuerpo = fin < 0 ? resto : resto.slice(0, fin);
  return [...cuerpo.matchAll(/^#### `([^`]+)`/gm)].map((m) => m[1]!);
}

describe("docs/protocol-v1.md", () => {
  it("documenta EXACTAMENTE los eventos del protocolo: ni uno de menos ni uno de más", () => {
    expect(encabezadosDe(protocolo, "Events").sort()).toEqual(Object.keys(TIPOS_DE_EVENTO_V1).sort());
  });
  it.each([...Object.keys(PASOS_V1), ...Object.keys(ACTIVIDADES_V1), ...Object.keys(DESENLACES_V1)])("el vocabulario cerrado `%s` está en el documento", (que) => {
    expect(protocolo).toContain(`\`${que}\``);
  });
  it.each(CODIGOS_DE_ERROR_V1.filter((c) => c !== "stream_fallo" && c !== "traductor_fallo"))("el código de error `%s` está en su tabla", (codigo) => {
    const tabla = protocolo.slice(protocolo.indexOf("### Error codes"));
    expect(tabla).toContain(`\`${codigo}\``);
  });
  it.each(Object.keys(FORMA_V1))("la primera línea de forma del evento `%s` nombra exactamente los campos que el código valida, y cuáles son opcionales", (t) => {
    const desde = protocolo.indexOf(`#### \`${t}\``);
    expect(desde).toBeGreaterThanOrEqual(0);
    const seccion = protocolo.slice(desde).split(/\n#{1,4} /)[0]!;
    const forma = /`(\{[^`]*\})`/.exec(seccion)?.[1];
    expect(forma, `el evento ${t} no abre con una línea de forma \`{ … }\``).toBeDefined();
    const documentados = Object.fromEntries([...forma!.matchAll(/"(\w+)"(\?)?\s*:/g)].filter((m) => m[1] !== "v" && m[1] !== "t").map((m) => [m[1]!, m[2] === "?"]));
    const reales = Object.fromEntries(Object.entries(FORMA_V1[t as keyof typeof FORMA_V1]).map(([campo, tipo]) => [campo, tipo.endsWith("?")]));
    expect(documentados).toEqual(reales);
  });
  it("las dos fallas internas comparten fila", () => {
    expect(protocolo).toContain("`stream_fallo`, `traductor_fallo`");
  });
  it("nombra las cinco rutas públicas", () => {
    for (const ruta of ["/api/chat/estado", "/api/chat/sesion`", "/api/chat/sesion/:id`", "/api/chat/sesion/:id/eventos", "/api/evidencias"]) expect(protocolo).toContain(ruta);
  });
});

describe("docs/core.md", () => {
  it("documenta EXACTAMENTE los eventos públicos", () => {
    expect(encabezadosDe(nucleo, "Events").sort()).toEqual(Object.keys(TIPOS_DE_EVENTO_PUBLICO).sort());
  });
  it("documenta cada método y propiedad de SupportChat", () => {
    const chat = createSupportChat({ tenantId: "t", projectId: "p", storage: "none", fetch: (async () => new Response("")) as typeof fetch });
    for (const nombre of Object.keys(chat)) expect(nucleo, `core.md no menciona \`${nombre}\``).toMatch(new RegExp(`\`${nombre}(\\(|\`)`));
  });
  it("documenta cada función y constante que exporta el núcleo", () => {
    for (const nombre of Object.keys(modulo)) expect(nucleo, `core.md no menciona la exportación \`${nombre}\``).toMatch(new RegExp(`\\b${nombre}\\b`));
  });
  it("documenta cada campo del estado público", () => {
    for (const campo of Object.keys(estadoPublico({ chat: estadoInicial(null), adjuntos: sinAdjuntos(), permisos: PERMISOS_COMO_HOY }))) expect(nucleo, `core.md no menciona el campo \`${campo}\``).toContain(`\`${campo}\``);
  });
});

describe("los vínculos relativos de la documentación llevan a algo que existe", () => {
  it.each([["protocol-v1.md", protocolo], ["core.md", nucleo]])("%s", (archivo, md) => {
    const vinculos = [...md.matchAll(/\]\((\.{1,2}\/[^)#]*)(#[^)]*)?\)/g)].map((m) => m[1]!);
    for (const v of vinculos) expect(existsSync(resolve(dirname(`${DOCS}${archivo}`), v)), `${archivo} apunta a ${v}`).toBe(true);
  });
});
