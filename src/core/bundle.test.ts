import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// `@supcoflow/chat/core` tiene que seguir siendo el núcleo SIN interfaz: lo mismo que comprueba `build.mjs`, pero en `npm test` para que falle
// antes de llegar al build. Se empaqueta con esbuild en memoria (sin tocar `dist/`).
const RAIZ = fileURLToPath(new URL("../..", import.meta.url));

describe("el bundle de @supcoflow/chat/core", () => {
  it("no arrastra preact, react, CSS ni ningún .tsx, y es chico", async () => {
    const r = await build({
      entryPoints: [`${RAIZ}/src/core/index.ts`],
      bundle: true,
      minify: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      loader: { ".css": "text" },
      logLevel: "silent",
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas.filter((f) => /node_modules\/(preact|react)\b|\.css$|\.tsx$/.test(f))).toEqual([]);
    expect(entradas.some((f) => f.endsWith("src/core/soporte.ts"))).toBe(true);
    const gzip = gzipSync(r.outputFiles[0]!.contents).length;
    expect(gzip).toBeLessThan(30 * 1024);
  });

  it("package.json lo publica como `./core` con sus tipos, y deja viajar `docs/`", () => {
    const paquete = JSON.parse(readFileSync(`${RAIZ}/package.json`, "utf8")) as { exports: Record<string, unknown>; files: string[] };
    expect(paquete.exports["./core"]).toEqual({ types: "./dist/core/index.d.ts", default: "./dist/core.js" });
    expect(paquete.files).toEqual(expect.arrayContaining(["docs", "examples", "!examples/**/*.test.ts"])); // el test del ejemplo no viaja
    // el build lo produce
    expect(readFileSync(`${RAIZ}/build.mjs`, "utf8")).toContain('outfile: "dist/core.js"');
  });
});
