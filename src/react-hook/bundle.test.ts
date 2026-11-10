import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// `@supcoflow/chat/react` es SÓLO el enlace con React: lo que comprueba `build.mjs`, pero en `npm test` para que falle antes de llegar al build. Se empaqueta en
// memoria con las mismas externas que el build (sin tocar `dist/`).
const RAIZ = fileURLToPath(new URL("../..", import.meta.url));

describe("el bundle de @supcoflow/chat/react", () => {
  it("deja el núcleo y React afuera (una sola copia del motor por página), no trae preact ni CSS, y es chico", async () => {
    const r = await build({
      entryPoints: [`${RAIZ}/src/react-hook/index.ts`],
      bundle: true,
      minify: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      external: ["react", "@supcoflow/chat/core"],
      loader: { ".css": "text" },
      logLevel: "silent",
    });
    const entradas = Object.keys(r.metafile.inputs);
    expect(entradas.filter((f) => /node_modules\/(preact|react)\b|\.css$|\.tsx$|\/core\//.test(f))).toEqual([]);
    const salida = r.outputFiles[0]!.text;
    expect(salida).toContain('from"react"');
    expect(salida).toContain('from"@supcoflow/chat/core"');
    expect(gzipSync(r.outputFiles[0]!.contents).length).toBeLessThan(2 * 1024);
  });

  it("package.json lo publica como `./react` con sus tipos, y el build produce `dist/hook.js` con las mismas externas", () => {
    const paquete = JSON.parse(readFileSync(`${RAIZ}/package.json`, "utf8")) as { exports: Record<string, unknown>; peerDependencies: Record<string, string> };
    expect(paquete.exports["./react"]).toEqual({ types: "./dist/react-hook/index.d.ts", default: "./dist/hook.js" });
    expect(paquete.peerDependencies.react).toBe(">=18");
    const build_ = readFileSync(`${RAIZ}/build.mjs`, "utf8");
    expect(build_).toContain('outfile: "dist/hook.js"');
    expect(build_).toContain('external: ["react", "@supcoflow/chat/core"]');
  });
});
