import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as modulo from "./index";

// La documentación del hook es parte de lo que se publica: lo que el código exporta y lo que el hook devuelve tiene que estar en `docs/react.md`.
const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));
const react = readFileSync(`${DOCS}react.md`, "utf8");

describe("docs/react.md", () => {
  it("nombra cada exportación de `@supcoflow/chat/react`", () => {
    for (const nombre of Object.keys(modulo)) expect(react, `react.md no menciona \`${nombre}\``).toMatch(new RegExp(`\\b${nombre}\\b`));
  });
  it.each(["chat", "state", "availability", "available", "ready", "onAvailability"])("explica `%s`", (campo) => {
    expect(react).toMatch(new RegExp(`\\| \`${campo}\``));
  });
  it("sus vínculos relativos llevan a algo que existe", () => {
    const vinculos = [...react.matchAll(/\]\((\.{1,2}\/[^)#]*)(#[^)]*)?\)/g)].map((m) => m[1]!);
    expect(vinculos.length).toBeGreaterThan(0);
    for (const v of vinculos) expect(existsSync(resolve(dirname(`${DOCS}react.md`), v)), `react.md apunta a ${v}`).toBe(true);
  });
});
