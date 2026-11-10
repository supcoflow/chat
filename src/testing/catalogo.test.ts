import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scenarios, scenarioNames, getScenario } from "./index";

// EL CATÁLOGO de escenarios del banco de pruebas: los 16 grabados del contrato del núcleo (`core/contrato/*.json`) más los que sumó la T4. Un archivo nuevo sin
// su ficha (descripción en inglés y puntos del contrato que ejercita), o una ficha sin archivo, hace fallar esto.

const DIR = fileURLToPath(new URL("../core/contrato/", import.meta.url));
const archivos = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const contrato = JSON.parse(readFileSync(fileURLToPath(new URL("../../contract.json", import.meta.url)), "utf8")) as { points: { id: string }[]; capabilities: { id: string }[] };
const PUNTOS = new Set([...contrato.points, ...contrato.capabilities].map((p) => p.id));

const LOS_14_DE_ANTES = [
  "report-confirmed", "report-revised", "stale-screen-approval", "reload-with-pending-confirmation", "reload-of-many-turns", "confirmation-no-longer-current",
  "no-confirmation-no-approval", "question-answered", "steps-after-the-answer", "conversation-ended", "daily-cap-on-open", "terminal-error", "unknown-events", "malformed-events",
];
const LOS_DE_LA_PRIVACIDAD = ["data-agreement-closed", "confirmation-from-older-backend"];
const LOS_NUEVOS = ["reload-of-expired-conversation", "link-to-another-site", "image-in-text", "html-in-text", "daily-cap-mid-conversation", "session-limit-mid-conversation", "attachment-failed"];
const DE_APOYO = ["assistant-question", "report-with-attachment", "chat-unavailable"];

describe("el catálogo de escenarios", () => {
  it("tiene un escenario por cada archivo grabado, ni uno más ni uno menos", () => {
    expect([...scenarioNames].sort()).toEqual(archivos);
  });

  it("están los 14 de antes, los 2 de la privacidad y los nuevos que pide el plan (enlace, imagen, tope, límite, adjunto fallido)", () => {
    for (const n of [...LOS_14_DE_ANTES, ...LOS_DE_LA_PRIVACIDAD, ...LOS_NUEVOS, ...DE_APOYO]) expect(scenarioNames, n).toContain(n);
    expect(scenarioNames).toHaveLength(LOS_14_DE_ANTES.length + LOS_DE_LA_PRIVACIDAD.length + LOS_NUEVOS.length + DE_APOYO.length);
  });

  it("`scenarios` y `scenarioNames` van en el mismo orden, y getScenario devuelve el mismo objeto", () => {
    expect(scenarios.map((s) => s.name)).toEqual([...scenarioNames]);
    for (const s of scenarios) expect(getScenario(s.name)).toBe(s);
  });

  it("getScenario con un nombre que no existe lanza y lista los que hay", () => {
    expect(() => getScenario("nope")).toThrow(/nope.*report-confirmed/s);
  });

  it.each(scenarioNames)("%s: nombre en inglés y kebab-case, descripción en inglés y puntos del contrato que existen", (nombre) => {
    const s = getScenario(nombre);
    expect(s.name).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
    expect(s.description.length).toBeGreaterThan(30);
    expect(s.description, "la descripción es para el developer: en inglés").not.toMatch(/[áéíóúñ¿¡]/i);
    for (const p of s.covers) expect(PUNTOS.has(p), `${nombre} dice cubrir ${p}, que el contrato no tiene`).toBe(true);
  });

  it.each(scenarioNames)("%s: tiene qué hace la persona (script) y qué contesta el servidor (responses), o es un escenario sin charla", (nombre) => {
    const s = getScenario(nombre);
    if (nombre === "chat-unavailable") {
      expect(s.responses).toEqual([]);
      expect(s.availability?.body).toMatchObject({ ok: false });
    } else {
      expect(s.script.length).toBeGreaterThan(0);
      expect(s.responses.length).toBeGreaterThan(0);
    }
  });

  it("cada punto obligatorio de presentación que se puede ver en una charla tiene al menos un escenario", () => {
    const cubiertos = new Set(scenarios.flatMap((s) => s.covers));
    for (const p of ["P1", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P14"]) expect(cubiertos.has(p), `ningún escenario cubre ${p}`).toBe(true);
  });

  it("los escenarios son datos congelados: uno que se toca no cambia el de los demás", () => {
    const s = getScenario("report-confirmed");
    expect(Object.isFrozen(s)).toBe(true);
    expect(() => { (s.responses as unknown[]).push({}); }).toThrow();
  });

  it("el texto de los escenarios que muestran lo que el servidor reescribe tiene las marcas del servidor (enlace a otro sitio, imagen, HTML)", () => {
    const texto = (n: string) => JSON.stringify(getScenario(n).responses);
    expect(texto("link-to-another-site")).toContain("{{origin}}");
    expect(texto("link-to-another-site")).toMatch(/other-site\.example[^"]*\)/);
    expect(texto("image-in-text")).toContain("］(");
    expect(texto("html-in-text")).toContain("＜");
  });

  it("en cada turno los fragmentos `texto` suman el mensaje `asistente` completo (el stream no se contradice)", () => {
    // Menos los dos que existen justamente para mandar líneas que no son lo que parecen.
    for (const s of scenarios.filter((x) => x.name !== "unknown-events" && x.name !== "malformed-events")) {
      for (const r of s.responses) {
        if (!("stream" in r)) continue;
        const lineas = r.stream.filter((l): l is { t: string; delta?: string; texto?: string } => typeof l === "object");
        const fragmentos = lineas.filter((l) => l.t === "texto").map((l) => l.delta).join("");
        const completo = lineas.filter((l) => l.t === "asistente").map((l) => l.texto);
        if (fragmentos !== "" && completo.length > 0) expect(fragmentos, s.name).toBe(completo[completo.length - 1]);
      }
    }
  });

  it("todo `outcome` de una `pregunta_resuelta` es uno de los que eve puede mandar (revisión 1, P2-1: el banco no inventa valores)", () => {
    // `InputResolutionOutcome` de eve 0.47.7, `eve/dist/src/protocol/message.d.ts`. «Corregir» el reporte llega como `denied`, no como `cancelled`.
    const DE_EVE = ["answered", "approved", "denied", "ignored", "invalid"];
    const vistos: string[] = [];
    for (const s of scenarios) for (const r of s.responses) {
      if (!("stream" in r)) continue;
      for (const l of r.stream) if (typeof l === "object" && (l as { t?: string }).t === "pregunta_resuelta") vistos.push((l as { outcome: string }).outcome);
    }
    expect(vistos.length).toBeGreaterThan(3);
    for (const o of vistos) expect(DE_EVE).toContain(o);
  });
});
