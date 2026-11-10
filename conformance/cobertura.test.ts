import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, MANUAL, checks, coverage } from "./checks";

// La conformidad (T6) está atada al contrato (`contract.json`), a su documento (`docs/conformance.md`) y al paquete que viaja: un punto nuevo del contrato sin chequeo (ni nota
// manual), un chequeo sin documentar o un archivo que no viaja hacen fallar este test.
const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const contrato = JSON.parse(readFileSync(`${RAIZ}contract.json`, "utf8")) as { version: string; points: { id: string; level: string }[] };
const doc = readFileSync(`${RAIZ}docs/conformance.md`, "utf8");
const paquete = JSON.parse(readFileSync(`${RAIZ}package.json`, "utf8")) as { files: string[] };
const cobertura = coverage();

describe("la conformidad cubre el contrato de presentación", () => {
  it("sigue la misma versión del contrato que `contract.json`", () => {
    expect(CONTRACT_VERSION).toBe(contrato.version);
  });
  it("cada punto del contrato tiene al menos un chequeo, o se declara a mano (P16: no aplica todavía)", () => {
    for (const p of contrato.points) {
      const c = cobertura[p.id];
      expect(c, `el punto ${p.id} no tiene ni chequeo ni nota manual`).toBeDefined();
      if (p.id !== "P16") expect(c!.checks.length, `el punto ${p.id} no tiene ningún chequeo`).toBeGreaterThan(0);
    }
  });
  it("todo lo que los chequeos y las notas manuales nombran es un punto del contrato", () => {
    const ids = new Set(contrato.points.map((p) => p.id));
    for (const c of checks) for (const p of c.points) expect(ids.has(p), `${c.id} nombra ${p}`).toBe(true);
    for (const m of MANUAL) for (const p of m.points) expect(ids.has(p), `una nota manual nombra ${p}`).toBe(true);
  });
  it("los ids de los chequeos son únicos y empiezan con el punto principal", () => {
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
    for (const c of checks) expect(c.id.startsWith(`${c.points[0]}.`) || c.points.includes(c.id.split(".")[0]!), c.id).toBe(true);
  });
});

describe("los chequeos que dependen de palabras opcionales", () => {
  it("los de adjuntos (P10) declaran que necesitan `pickElement`: sin esa palabra se OMITEN a la vista, no pasan en silencio", () => {
    for (const c of checks.filter((x) => x.points.includes("P10"))) expect(c.needs, c.id).toContain("pickElement");
  });
  it("el de P11 (el nombre de la persona) declara que necesita `personWired`: sin eso se OMITE a la vista, no pasa sin haber podido encontrar nada", () => {
    expect(checks.find((c) => c.id === "P11.the-name-never-leaves")!.needsPerson).toBe(true);
  });
  it("lo documentado con «jest» no existe: los chequeos usan `expect(valor, mensaje)` y sólo andan con vitest", () => {
    for (const archivo of ["docs/conformance.md", "conformance/checks.ts", "conformance/chat.conformance.template.tsx"]) {
      const t = readFileSync(`${RAIZ}${archivo}`, "utf8");
      expect(t.replace(/jest's `expect`|`expect` of jest|jest's/g, ""), archivo).not.toMatch(/\bjest\b/i);
    }
  });
});

describe("docs/conformance.md", () => {
  it("la tabla «What checks what» dice, punto por punto, los chequeos que hay (ni uno de más ni uno de menos) y si algo queda a mano", () => {
    const desde = doc.indexOf("## What checks what");
    const hasta = doc.indexOf("## What the checks do not do");
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    const filas = [...doc.slice(desde, hasta).matchAll(/^\| (P\d+) \| ([^|]*) \| ([^|]*) \|/gm)];
    expect(filas.map((f) => f[1])).toEqual(contrato.points.map((p) => p.id));
    for (const [, punto, columna, manual] of filas) {
      const enDoc = [...columna!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).sort();
      expect(enDoc, punto).toEqual([...cobertura[punto!]!.checks].sort());
      expect(manual!.trim() !== "—", `${punto}: la columna «stays manual»`).toBe(cobertura[punto!]!.manual);
    }
  });
  it("documenta las palabras que el adaptador pide", () => {
    for (const palabra of ["trigger", "messageField", "send", "retry", "newConversation", "automatedAssistant", "working", "reportSent", "reportNotSent", "somethingWrong", "emptyConversation", "freeText", "pickElement", "removeAttachment", "retryAttachment"]) {
      expect(doc, palabra).toContain(`\`${palabra}\``);
    }
  });
});

describe("el paquete", () => {
  it("lleva `conformance/` pero no sus tests ni la interfaz rota", () => {
    expect(paquete.files).toContain("conformance");
    for (const excluido of ["!conformance/**/*.test.ts", "!conformance/**/*.test.tsx", "!conformance/broken-chat.tsx", "!conformance/tsconfig.json"]) expect(paquete.files, excluido).toContain(excluido);
  });
});
