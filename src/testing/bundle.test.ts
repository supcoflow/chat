import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// `@supcoflow/chat/testing` es un banco de pruebas SIN interfaz, como el núcleo: lo mismo que comprueba `build.mjs`, pero en `npm test` para que falle antes de llegar al build.
// Se empaqueta con esbuild en memoria (sin tocar `dist/`).
const RAIZ = fileURLToPath(new URL("../..", import.meta.url));

describe("el bundle de @supcoflow/chat/testing", () => {
  it("se empaqueta para un navegador SIN externos y sin errores (Storybook, una página de desarrollo), no arrastra preact, react, CSS ni ningún .tsx, y es chico", async () => {
    const r = await build({
      entryPoints: [`${RAIZ}/src/testing/index.ts`],
      bundle: true,
      minify: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      // Sin `external`: si el índice tocara algo de Node, esbuild fallaría acá como le falla a quien lo empaqueta (revisión 1, P2-3).
      loader: { ".css": "text" },
      logLevel: "silent",
    });
    expect(Object.keys(r.metafile.inputs).filter((f) => /node_modules\/(preact|react)\b|\.css$|\.tsx$/.test(f))).toEqual([]);
    const codigo = new TextDecoder().decode(r.outputFiles[0]!.contents);
    expect(codigo).not.toMatch(/node:/);
    expect(gzipSync(r.outputFiles[0]!.contents).length).toBeLessThan(30 * 1024);
  });

  it("el servidor local tiene su entrada, sólo para Node, y es lo único que trae `node:http`", async () => {
    const r = await build({ entryPoints: [`${RAIZ}/src/testing/server.ts`], bundle: true, write: false, format: "esm", platform: "node", target: ["es2022"], logLevel: "silent" });
    const codigo = new TextDecoder().decode(r.outputFiles[0]!.contents);
    expect(codigo).toMatch(/from\s*["']node:http["']/);
    // y el índice del banco no lo exporta
    const indice = readFileSync(`${RAIZ}/src/testing/index.ts`, "utf8");
    expect(indice).not.toMatch(/servidor-local|startFakeServer/);
  });

  it("package.json lo publica como `./testing` con sus tipos y el comando `supcoflow-chat-fake`, sin tocar lo que ya se publicaba", () => {
    const paquete = JSON.parse(readFileSync(`${RAIZ}/package.json`, "utf8")) as { exports: Record<string, unknown>; bin: Record<string, string>; files: string[] };
    expect(paquete.exports["./testing"]).toEqual({ types: "./dist/testing/index.d.ts", default: "./dist/testing.js" });
    expect(paquete.exports["./testing/server"]).toEqual({ types: "./dist/testing/server.d.ts", default: "./dist/testing-server.js" });
    expect(Object.keys(paquete.exports)).toEqual(expect.arrayContaining([".", "./core", "./widget.js", "./contract.json"]));
    expect(paquete.bin).toEqual({ "supcoflow-chat-fake": "./dist/fake-server.js" });
    expect(paquete.files).toContain("dist");
    const build = readFileSync(`${RAIZ}/build.mjs`, "utf8");
    expect(build).toContain('outfile: "dist/testing.js"');
    expect(build).toContain('outfile: "dist/testing-server.js"');
    expect(build).toContain('outfile: "dist/fake-server.js"');
    expect(build).toContain("#!/usr/bin/env node");
  });
});
