// El build del widget: dos salidas del MISMO código, con el presupuesto de tamaño adentro.
//
// Por qué esbuild y no tsc a secas (como hasta la 1.x): el widget ahora incorpora `preact` y
// el cliente de Eve en vez de declararlos como dependencias — un `import` que tsc deja tal cual
// le exigiría al sitio del cliente instalar 47 MB de `eve` (§1.1 del diseño). Y por qué el
// presupuesto vive ACÁ y no en un test: el número que importa es el del artefacto publicado,
// no el de un módulo suelto.
import { build } from "esbuild";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { buscarLockfile, huellaDelBuild } from "./huella-del-build.mjs";

// §1.3 del diseño: menos de 80 KB gzip por salida. Si algún día hay que subirlo, se sube acá
// con el porqué al lado, no se comenta el chequeo.
export const PRESUPUESTO_GZIP = 80 * 1024;

// La versión del paquete MÁS la huella del build (fuente, configuración y dependencias bloqueadas: `huella-del-build.mjs`) identifican el código de cada salida: `x-supcoflow-sdk` viaja como `widget/2.3.1+ab12cd34` (`src/core/version.ts`). Con sólo la versión, el `<script>` de
// chat.supcoflow.dev/widget.js (sale de `main`) y el paquete de npm podían llevar la misma etiqueta con código distinto. `dist/build-id.json` la deja a la vista (la lee un test).
const aqui = fileURLToPath(new URL(".", import.meta.url));
const huella = huellaDelBuild(aqui, buscarLockfile(aqui));
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const comun = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2022"],
  platform: "browser",
  // El CSS entra como STRING y se inyecta en el shadow root en runtime: un <link> externo
  // no sirve dentro de un shadow root ajeno y obligaría a servir un segundo archivo.
  loader: { ".css": "text" },
  jsx: "automatic",
  jsxImportSource: "preact",
  define: { "process.env.NODE_ENV": '"production"', __SDK_BUILD__: JSON.stringify(huella) },
  logLevel: "warning",
};

await build({
  ...comun,
  entryPoints: ["src/index.ts"],
  format: "esm",
  outfile: "dist/index.js",
  // React es del consumidor (peer opcional): sólo lo usa el wrapper `ChatDeIntake`.
  external: ["react"],
});

await build({
  ...comun,
  entryPoints: ["src/iife.ts"],
  format: "iife",
  outfile: "dist/widget.iife.js",
});

// `@supcoflow/chat/core`: el núcleo SIN interfaz (plan de las tres formas, §4). Mismo código que el widget por debajo, pero ni preact ni
// el CSS entran en este bundle: quien arma su propia interfaz no paga una que no usa. Si algún import de dibujo se cuela en `core/`, el build falla.
const nucleo = await build({
  ...comun,
  entryPoints: ["src/core/index.ts"],
  format: "esm",
  outfile: "dist/core.js",
  metafile: true,
});
const dibujo = Object.keys(nucleo.metafile.inputs).filter((f) => /node_modules\/(preact|react)\b|\.css$|\.tsx$/.test(f));
if (dibujo.length > 0) {
  console.error(`El núcleo (dist/core.js) arrastró código de dibujo: ${dibujo.join(", ")}. Un import de preact, react, CSS o un .tsx se coló en core/.`);
  process.exit(1);
}

// `@supcoflow/chat/react`: el hook de React, sin interfaz. Deja EXTERNOS `react` (peer del consumidor) y `@supcoflow/chat/core` (el hook importa el núcleo por su nombre público: hay
// UNA copia del motor por página, la que el developer también importa para el resto; con otra copia adentro habría dos chats por proyecto). Ni preact ni CSS pueden entrar acá.
const gancho = await build({
  ...comun,
  entryPoints: ["src/react-hook/index.ts"],
  format: "esm",
  outfile: "dist/hook.js",
  external: ["react", "@supcoflow/chat/core"],
  metafile: true,
});
const dibujoDelGancho = Object.keys(gancho.metafile.inputs).filter((f) => /node_modules\/(preact|react)\b|\.css$|\.tsx$|\/core\//.test(f));
if (dibujoDelGancho.length > 0) {
  console.error(`El hook (dist/hook.js) arrastró ${dibujoDelGancho.join(", ")}. Tiene que importar el núcleo por "@supcoflow/chat/core" (externo) y no traer preact, react, CSS ni un .tsx.`);
  process.exit(1);
}

// `@supcoflow/chat/testing`: el banco de pruebas (T4 del plan «ui-agnóstico»). Backend falso con los escenarios grabados adentro (JSON). No importa nada de Node, así que se
// puede empaquetar para un navegador (Storybook, una página de desarrollo); el servidor local, que sí usa `node:http`, tiene su entrada aparte (`testing/server`).
// Tampoco puede arrastrar código de dibujo.
const banco = await build({
  ...comun,
  entryPoints: ["src/testing/index.ts"],
  format: "esm",
  outfile: "dist/testing.js",
  metafile: true,
});
const dibujoEnElBanco = Object.keys(banco.metafile.inputs).filter((f) => /node_modules\/(preact|react)\b|\.css$|\.tsx$/.test(f));
if (dibujoEnElBanco.length > 0) {
  console.error(`El banco de pruebas (dist/testing.js) arrastró código de dibujo: ${dibujoEnElBanco.join(", ")}.`);
  process.exit(1);
}

// `@supcoflow/chat/testing/server`: el servidor local, para Node.
await build({
  ...comun,
  platform: "node",
  entryPoints: ["src/testing/server.ts"],
  format: "esm",
  outfile: "dist/testing-server.js",
});

// `supcoflow-chat-fake` (el `bin` del paquete): el mismo banco como comando, para Node. Con su shebang y sin tocar el navegador.
await build({
  ...comun,
  platform: "node",
  entryPoints: ["src/testing/bin.ts"],
  format: "esm",
  outfile: "dist/fake-server.js",
  banner: { js: "#!/usr/bin/env node" },
});
chmodSync("dist/fake-server.js", 0o755);

let excedido = false;
for (const archivo of ["dist/index.js", "dist/widget.iife.js", "dist/core.js", "dist/hook.js", "dist/testing.js", "dist/testing-server.js", "dist/fake-server.js"]) {
  const bytes = statSync(archivo).size;
  const gzip = gzipSync(readFileSync(archivo)).length;
  const marca = gzip > PRESUPUESTO_GZIP ? "  ← EXCEDE EL PRESUPUESTO" : "";
  console.log(`${archivo}: ${(bytes / 1024).toFixed(1)} KB, ${(gzip / 1024).toFixed(1)} KB gzip${marca}`);
  if (gzip > PRESUPUESTO_GZIP) excedido = true;
}
if (excedido) {
  console.error(`El widget pasa los ${PRESUPUESTO_GZIP / 1024} KB gzip del §1.3 del diseño.`);
  process.exit(1);
}

writeFileSync("dist/build-id.json", `${JSON.stringify({ version, huella }, null, 2)}\n`);
console.log(`dist/build-id.json: ${version}+${huella}`);
