import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { huellaDelBuild } from "../huella-del-build.mjs";

// La huella del build identifica el CÓDIGO del widget (fuente, configuración del build y versiones bloqueadas de sus dependencias): la lleva la etiqueta de versión que viaja en `x-supcoflow-sdk` (`widget/2.3.1+ab12cd34`). Así el `<script>` que se sirve desde `main`
// (chat.supcoflow.dev/widget.js) y el paquete publicado en npm NO pueden llevar la misma etiqueta con código distinto: la versión de `package.json` sola no lo garantiza (puede haber cambios sin publicar bajo
// la misma versión, como los de la «2.4.0 — unreleased» sobre la 2.3.1 de npm).

const dirs: string[] = [];
const PAQUETE = JSON.stringify({ name: "x", version: "1.0.0", dependencies: {}, devDependencies: { preact: "10.0.0", esbuild: "0.1.0" } });
const LOCK = (preact: string, extra = "1") =>
  JSON.stringify({ packages: { "node_modules/preact": { version: preact, integrity: "sha-p" }, "node_modules/esbuild": { version: "0.1.0", integrity: "sha-e" }, "node_modules/otro": { version: extra } } });
/** Un paquete de mentira: `src/`, `build.mjs`, `package.json`, `tsconfig.json` y el lockfile de la raíz (en `lock.json`, un nivel arriba). */
function paquete(cambios: Record<string, string> = {}): { dir: string; lock: string } {
  const raiz = mkdtempSync(join(tmpdir(), "huella-"));
  dirs.push(raiz);
  const dir = join(raiz, "pkg");
  const archivos: Record<string, string> = {
    "src/a.ts": "export const a = 1;",
    "src/core/b.ts": "export const b = 2;",
    "build.mjs": "// build",
    "package.json": PAQUETE,
    "tsconfig.json": "{}",
    ...cambios,
  };
  for (const [ruta, texto] of Object.entries(archivos)) {
    if (ruta === "../lock.json") continue;
    mkdirSync(join(dir, ruta, ".."), { recursive: true });
    writeFileSync(join(dir, ruta), texto);
  }
  writeFileSync(join(raiz, "lock.json"), cambios["../lock.json"] ?? LOCK("10.0.0"));
  return { dir, lock: join(raiz, "lock.json") };
}
const huella = (c: Record<string, string> = {}) => {
  const p = paquete(c);
  return huellaDelBuild(p.dir, p.lock);
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("huellaDelBuild", () => {
  it("son 8 caracteres hexadecimales y es la misma para el mismo contenido, esté donde esté", () => {
    expect(huella()).toMatch(/^[0-9a-f]{8}$/);
    expect(huella()).toBe(huella());
  });
  it("cambia si cambia un archivo del fuente, si se agrega uno o si se cambia el nombre de uno", () => {
    const base = huella();
    expect(huella({ "src/a.ts": "export const a = 2;" })).not.toBe(base);
    expect(huella({ "src/c.css": "x{}" })).not.toBe(base);
    expect(huella({ "src/c.ts": "export const a = 1;", "src/a.ts": "" })).not.toBe(base);
  });
  it("no cambia por un test: lo que se prueba no es lo que se publica", () => {
    expect(huella({ "src/a.test.ts": "it('x')", "src/core/b.test.tsx": "it('y')" })).toBe(huella());
  });
  it("mira el CSS, el JSON y los .tsx, que también entran al bundle", () => {
    const base = huella();
    for (const extra of ["src/w.css", "src/contrato.json", "src/c.tsx"]) expect(huella({ [extra]: "x" }), extra).not.toBe(base);
  });
  it("P2-2 de la revisión: cambia si cambia la configuración del build (`build.mjs`), la del paquete o la de TypeScript, aunque `src/` no se toque", () => {
    const base = huella();
    expect(huella({ "build.mjs": "// build con otro target" })).not.toBe(base);
    expect(huella({ "package.json": PAQUETE.replace("1.0.0", "1.0.1") })).not.toBe(base);
    expect(huella({ "tsconfig.json": '{"compilerOptions":{"jsx":"react"}}' })).not.toBe(base);
  });
  it("P2-2 de la revisión: cambia si cambia la versión BLOQUEADA de una dependencia del paquete (preact entra al bundle), y no por una que el paquete no declara", () => {
    const base = huella();
    expect(huella({ "../lock.json": LOCK("10.0.1") })).not.toBe(base);
    expect(huella({ "../lock.json": LOCK("10.0.0", "2") })).toBe(base);
  });
  it("sin lockfile (quien instala el paquete publicado no lo tiene) calcula igual, con lo demás", () => {
    const p = paquete();
    expect(huellaDelBuild(p.dir, join(p.dir, "no-existe.json"))).toMatch(/^[0-9a-f]{8}$/);
  });
  it("el fuente real da una huella estable entre dos llamadas", () => {
    const dir = fileURLToPath(new URL("..", import.meta.url));
    const lock = fileURLToPath(new URL("../../../package-lock.json", import.meta.url));
    expect(huellaDelBuild(dir, lock)).toBe(huellaDelBuild(dir, lock));
  });
});

describe("el build deja la huella en las salidas", () => {
  // Lo que `build.mjs` escribió la última vez que corrió (`npm run build -w @supcoflow/chat`; `prepare` lo corre en cada install). No compara con el fuente de ahora: un dist viejo no es un error de este test.
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const id = JSON.parse(readFileSync(`${dist}build-id.json`, "utf8")) as { version: string; huella: string };
  it("`dist/build-id.json` lleva la versión del paquete y una huella", () => {
    const paquete = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(id.version).toBe(paquete.version);
    expect(id.huella).toMatch(/^[0-9a-f]{8}$/);
  });
  it.each(["widget.iife.js", "core.js", "index.js"])("%s lleva esa huella adentro (es lo que viaja en la etiqueta del encabezado)", (archivo) => {
    expect(readFileSync(`${dist}${archivo}`, "utf8")).toContain(id.huella);
  });
});
