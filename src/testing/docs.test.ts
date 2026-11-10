import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFakeBackend } from "./backend-falso";
import * as modulo from "./index";
import * as servidor from "./server";
import { scenarios } from "./index";

// La documentación del banco de pruebas es parte de su contrato (como `core/docs.test.ts` para el núcleo): lo que el módulo exporta, lo que expone un backend falso y cada
// escenario del catálogo están en `docs/testing.md`, y a la inversa. Estos tests no leen prosa: leen la tabla de los escenarios y los nombres.
const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));
const doc = readFileSync(`${DOCS}testing.md`, "utf8");

/** La tabla de la sección «The scenarios»: nombre → puntos que dice cubrir. */
function tablaDeEscenarios(): Map<string, string[]> {
  const desde = doc.indexOf("## The scenarios");
  const hasta = doc.indexOf("## Your own scenario");
  expect(desde).toBeGreaterThan(0);
  expect(hasta).toBeGreaterThan(desde);
  const filas = [...doc.slice(desde, hasta).matchAll(/^\| `([a-z0-9-]+)` \| ([^|]*) \|/gm)];
  return new Map(filas.map((m) => [m[1]!, m[2]!.split(",").map((p) => p.trim())]));
}

describe("docs/testing.md", () => {
  it("la tabla de escenarios tiene EXACTAMENTE los del catálogo, con los puntos que cada uno dice cubrir", () => {
    const tabla = tablaDeEscenarios();
    expect([...tabla.keys()].sort()).toEqual(scenarios.map((s) => s.name).sort());
    for (const s of scenarios) expect(tabla.get(s.name), s.name).toEqual([...s.covers]);
  });

  it("documenta cada función que exporta el banco de pruebas, también la del servidor local", () => {
    for (const nombre of [...Object.keys(modulo), ...Object.keys(servidor)]) expect(doc, `testing.md no menciona la exportación \`${nombre}\``).toMatch(new RegExp(`\\b${nombre}\\b`));
  });

  it("documenta cada miembro de un backend falso", () => {
    for (const nombre of Object.keys(createFakeBackend("report-confirmed"))) expect(doc, `testing.md no menciona \`${nombre}\``).toMatch(new RegExp(`\`${nombre}(\\(|\`)`));
  });

  it("nombra el comando, el import y las rutas de control del servidor local", () => {
    for (const t of ["supcoflow-chat-fake", "@supcoflow/chat/testing", "/__fake/scenario", "/__fake/reset", "/__fake/scenarios", "/__fake/state", "@supcoflow/chat/testing/server", "escenario_agotado", "ruta_desconocida", "escenario_desconocido", "fake_fallo", "cuerpo_demasiado_grande"]) expect(doc, t).toContain(t);
  });

  it("los vínculos relativos llevan a algo que existe", () => {
    for (const [, v] of doc.matchAll(/\]\((\.{1,2}\/[^)#]*)(#[^)]*)?\)/g)) expect(existsSync(resolve(dirname(`${DOCS}testing.md`), v!)), v).toBe(true);
  });

  it("el primer ejemplo guarda la confirmación ANTES del gesto: después ya no está en el estado (revisión 1, P2-2)", () => {
    const ejemplo = /```ts\n([\s\S]*?)```/.exec(doc)![1]!;
    const guarda = ejemplo.indexOf("const confirmation = chat.getState().pendingQuestion!");
    const usa = ejemplo.indexOf("confirmation.id");
    expect(guarda).toBeGreaterThan(0);
    expect(usa).toBeGreaterThan(guarda);
    expect(ejemplo).not.toMatch(/requestId: chat\.getState\(\)/);
  });
});
