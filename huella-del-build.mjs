// La huella del build del widget: ocho caracteres hexadecimales del sha256 de TODO lo que entra al código publicado. `build.mjs` la mete en cada salida como `__SDK_BUILD__` y la etiqueta de
// `x-supcoflow-sdk` queda `widget/2.3.1+ab12cd34`: la versión de `package.json` sola no identifica el código (el `<script>` de chat.supcoflow.dev/widget.js sale de `main`, que puede llevar cambios sin
// publicar bajo la misma versión que npm). Mismo código → misma etiqueta; código distinto → etiqueta distinta.
//
// Qué entra (revisión 1, P2-2: antes sólo `src/`, y un cambio de target o de dependencia daba otro bundle con la misma etiqueta):
//   1. el fuente: todo lo que no es un test bajo `src/` (ruta y contenido);
//   2. la configuración del build: `build.mjs`, este archivo, `package.json` y los `tsconfig*.json` del paquete (esbuild lee el `tsconfig.json`; `tsconfig.base.json` es del paquete);
//   3. las versiones BLOQUEADAS (versión, origen e integridad en el lockfile de la raíz) de cada dependencia que el `package.json` declara — preact entra al bundle y esbuild lo arma —. Las que el paquete no declara
//      no cuentan; un lockfile ausente (quien instala el paquete publicado no lo tiene ni construye) se ignora.
//
// Es un `.mjs` sin dependencias porque lo corre `build.mjs` con el Node que tenga el entorno (Vercel incluido, vía `prepare`), sin pasos de compilación.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, parse, relative, sep } from "node:path";

const EXTENSIONES = /\.(ts|tsx|css|json)$/;
const ES_DE_TEST = /\.test\.(ts|tsx)$/;

function archivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : archivos(ruta);
    return EXTENSIONES.test(e.name) && !ES_DE_TEST.test(e.name) ? [ruta] : [];
  });
}

function entradasDelBuild(dirDelPaquete) {
  const sueltos = ["build.mjs", "huella-del-build.mjs", "package.json", "tsconfig.json", "tsconfig.build.json", "tsconfig.base.json"]
    .map((rel) => join(dirDelPaquete, rel))
    .filter((r) => existsSync(r));
  const delFuente = existsSync(join(dirDelPaquete, "src")) ? archivos(join(dirDelPaquete, "src")) : [];
  return [...sueltos, ...delFuente]
    .map((r) => ({ r, rel: relative(dirDelPaquete, r).split(sep).join("/") }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Lo bloqueado de cada dependencia que declara el `package.json`, en orden de nombre. */
function dependenciasBloqueadas(dirDelPaquete, rutaDelLockfile) {
  if (rutaDelLockfile === undefined || !existsSync(rutaDelLockfile)) return [];
  let paquete;
  let lock;
  try {
    paquete = JSON.parse(readFileSync(join(dirDelPaquete, "package.json"), "utf8"));
    lock = JSON.parse(readFileSync(rutaDelLockfile, "utf8"));
  } catch {
    return [];
  }
  const nombres = [...new Set([...Object.keys(paquete.dependencies ?? {}), ...Object.keys(paquete.devDependencies ?? {}), ...Object.keys(paquete.peerDependencies ?? {})])].sort();
  const raiz = dirname(rutaDelLockfile);
  const propio = relative(raiz, dirDelPaquete).split(sep).join("/");
  return nombres.map((n) => {
    const e = (propio === "" ? undefined : lock.packages?.[`${propio}/node_modules/${n}`]) ?? lock.packages?.[`node_modules/${n}`];
    return `${n}\0${e === undefined ? "-" : `${e.version}\0${e.resolved ?? ""}\0${e.integrity ?? ""}`}`;
  });
}

/**
 * El `package-lock.json` que bloquea las dependencias del paquete: el primero que se encuentra subiendo desde su carpeta. Dentro del workspace es el de la raíz (`../../package-lock.json`); en el repo público del kit, el
 * paquete es la raíz y el lockfile está al lado de `package.json`. Sin ninguno (quien instala el paquete publicado) devuelve `undefined`.
 * @param {string} dirDelPaquete @returns {string | undefined}
 */
export function buscarLockfile(dirDelPaquete) {
  for (let dir = dirDelPaquete; ; dir = dirname(dir)) {
    const candidato = join(dir, "package-lock.json");
    if (existsSync(candidato)) return candidato;
    if (dirname(dir) === dir || dir === parse(dir).root) return undefined;
  }
}

/** @param {string} dirDelPaquete la carpeta del paquete (`packages/widget` en el workspace; la raíz en el repo público del kit) @param {string} [rutaDelLockfile] el `package-lock.json` de la raíz del workspace @returns {string} */
export function huellaDelBuild(dirDelPaquete, rutaDelLockfile) {
  const hash = createHash("sha256");
  for (const { r, rel } of entradasDelBuild(dirDelPaquete)) hash.update(`${rel}\0`).update(readFileSync(r)).update("\0");
  for (const linea of dependenciasBloqueadas(dirDelPaquete, rutaDelLockfile)) hash.update(`dep:${linea}\0`);
  return hash.digest("hex").slice(0, 8);
}
