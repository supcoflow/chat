import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

// `build.mjs` bundles the widget's CSS as plain text (esbuild's `.css` -> "text" loader) and the widget injects it by hand into its shadow root.
// Vite has no such loader: a bare `import css from "./x.css"` resolves to an empty module in vitest. This plugin resolves those imports to a
// virtual module whose code is the raw text of the file, so a test sees the same string the production build does. The virtual id must NOT keep
// the ".css" extension (Vite's own CSS plugin would process it again and break it), hence the opaque `\0` id and the map.
const rutaPorIdVirtual = new Map<string, string>();
let contadorIdVirtual = 0;
const cssComoTextoParaTests: Plugin = {
  name: "css-como-texto-para-tests",
  enforce: "pre",
  async resolveId(fuente, importador, opciones) {
    if (!fuente.endsWith(".css") || importador === undefined) return null;
    const resuelto = await this.resolve(fuente, importador, { ...opciones, skipSelf: true });
    if (resuelto === null) return null;
    const idVirtual = `\0css-como-texto:${contadorIdVirtual++}`;
    rutaPorIdVirtual.set(idVirtual, resuelto.id);
    return idVirtual;
  },
  load(id) {
    const ruta = rutaPorIdVirtual.get(id);
    if (ruta === undefined) return null;
    return `export default ${JSON.stringify(readFileSync(ruta, "utf8"))};`;
  },
};

export default defineConfig({
  plugins: [cssComoTextoParaTests],
  // The examples and the conformance checks import what a developer who installs the package imports: `@supcoflow/chat/core` and friends.
  // Here they point at the source, without going through `dist/`. The most specific alias goes first: a prefix alias would eat `testing/server`.
  resolve: {
    alias: {
      "@supcoflow/chat/core": fileURLToPath(new URL("./src/core/index.ts", import.meta.url)),
      "@supcoflow/chat/react": fileURLToPath(new URL("./src/react-hook/index.ts", import.meta.url)),
      "@supcoflow/chat/testing/server": fileURLToPath(new URL("./src/testing/server.ts", import.meta.url)),
      "@supcoflow/chat/testing": fileURLToPath(new URL("./src/testing/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Some tests start a child process; on a loaded machine the default 5 s is not enough.
    testTimeout: 20_000,
    include: ["src/**/*.test.ts", "examples/**/*.test.{ts,tsx}", "conformance/**/*.test.{ts,tsx}"],
  },
});
