import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { alEnviar, estadoInicial, reducir } from "../estado";
import { PERMISOS_COMO_HOY } from "../estado-del-widget";
import { agregarElemento, marcar, sinAdjuntos } from "../evidencia/adjuntos";
import { ELEMENTO } from "../evidencia/adjuntos.test";
import { CODIGOS_DE_ERROR_V1, type EventoDelWidget } from "../protocolo";
import * as modulo from "./index";
import { createSupportChat } from "./soporte";
import type { Availability, ChatActivity, ChatCapabilities, ChatOutcome, ChatUser, PendingQuestion, SupportChat, SupportChatOptions } from "./tipos";
import { estadoPublico, TIPOS_DE_EVENTO_PUBLICO } from "./traducir";

// El CONTRATO DE PRESENTACIÓN ata tres cosas (plan «ui-agnóstico», T1): el documento que lee quien (o el agente de código que) arma la interfaz
// (`docs/presentation-contract.md`), su versión legible por máquina (`contract.json`, que viaja en el paquete) y los TIPOS del núcleo (`tipos.ts`
// y, en tiempo de ejecución, lo que el núcleo expone de verdad). Cambiar uno sin los otros hace fallar este test:
//   · el documento y el JSON dicen lo mismo, frase por frase (lo obligatorio, lo libre, los niveles, lo que NO se pide);
//   · todo lo que el JSON nombra del núcleo (métodos, campos del estado, eventos, opciones, códigos de error) existe;
//   · todo lo que el núcleo expone está en el contrato o declarado «sin requisito»: agregar un método, un campo o un evento obliga a decidir
//     qué exige el contrato sobre él.

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const DOC = readFileSync(`${RAIZ}docs/presentation-contract.md`, "utf8");

interface Referencias {
  methods?: string[];
  state?: string[];
  events?: string[];
  options?: string[];
  errors?: string[];
}
interface Punto {
  id: string;
  title: string;
  level: "required" | "default_on" | "optional";
  condition?: string;
  reads: Referencias;
  must: string[];
  free: string[];
}
interface Contrato {
  name: string;
  version: string;
  levels: Record<string, string>;
  points: Punto[];
  capabilities: Punto[];
  withoutRequirement: Required<Omit<Referencias, "errors">>;
  doesNotAsk: string[];
}

const json = JSON.parse(readFileSync(`${RAIZ}contract.json`, "utf8")) as Contrato;
const todos = [...json.points, ...json.capabilities];
const NIVELES = ["required", "default_on", "optional"] as const;

// Compilación: una entrada por opción pública. Una opción nueva no compila hasta que se la lista acá, y el test de abajo exige que el contrato la nombre o la deje sin requisito.
const OPCIONES: Record<keyof SupportChatOptions, true> = {
  tenantId: true, projectId: true, backendUrl: true, user: true, appVersion: true, autoContext: true, storage: true, resume: true, locale: true, capabilities: true, fetch: true,
};

const chat = createSupportChat({ tenantId: "t", projectId: "p", storage: "none", fetch: (async () => new Response("")) as typeof fetch });
const METODOS = Object.keys(chat);
const CAMPOS = Object.keys(estadoPublico({ chat: estadoInicial(null), adjuntos: sinAdjuntos(), permisos: PERMISOS_COMO_HOY }));
const EVENTOS = Object.keys(TIPOS_DE_EVENTO_PUBLICO);

/** El cuerpo de la sección `### id — título` hasta el próximo encabezado de nivel 3 o menos. */
function seccion(id: string): string {
  const m = new RegExp(`^### ${id} — .*$`, "m").exec(DOC);
  expect(m, `el documento no tiene la sección «### ${id} — …»`).not.toBeNull();
  const resto = DOC.slice(m!.index + m![0].length);
  const fin = resto.search(/\n#{1,3} /);
  return fin < 0 ? resto : resto.slice(0, fin);
}

/** Las viñetas `- …` que siguen a la etiqueta `**Must**` / `**Free**` (hasta la primera línea que no sea viñeta ni continuación). */
function vinetas(cuerpo: string, etiqueta: string): string[] {
  const lineas = cuerpo.split("\n");
  const desde = lineas.findIndex((l) => l.trim() === `**${etiqueta}**`);
  if (desde < 0) return [];
  const salida: string[] = [];
  for (const l of lineas.slice(desde + 1)) {
    if (l.startsWith("- ")) salida.push(l.slice(2));
    else if (l.startsWith("  ") && salida.length > 0) salida[salida.length - 1] += ` ${l.trim()}`;
    else if (l.trim() === "" && salida.length === 0) continue;
    else break;
  }
  return salida;
}

describe("contract.json", () => {
  it("tiene nombre y una versión semver, y es la que dice el título del documento", () => {
    expect(json.name).toBe("supcoflow-presentation-contract");
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(DOC.split("\n")[0]).toBe(`# Supcoflow presentation contract — v${json.version}`);
  });

  it("los niveles son exactamente tres y están explicados", () => {
    expect(Object.keys(json.levels).sort()).toEqual([...NIVELES].sort());
    for (const nivel of NIVELES) expect(DOC, `el documento no explica el nivel ${nivel}`).toContain(`- **${nivel}** — ${json.levels[nivel]}`);
  });

  it("los puntos son P1…Pn sin saltos, todos obligatorios, y las capacidades nunca lo son", () => {
    expect(json.points.map((p) => p.id)).toEqual(json.points.map((_, i) => `P${i + 1}`));
    for (const p of json.points) expect(p.level, p.id).toBe("required");
    expect(json.capabilities.length).toBeGreaterThan(0);
    for (const c of json.capabilities) expect(["default_on", "optional"], c.id).toContain(c.level);
    expect(new Set(todos.map((x) => x.id)).size).toBe(todos.length);
  });

  it("el historial de charlas es obligatorio (decisión del dueño, 2026-10-30)", () => {
    const historial = json.points.find((p) => /history/i.test(p.title));
    expect(historial, "falta el punto de historial").toBeDefined();
    expect(historial!.level).toBe("required");
    expect(historial!.reads.methods).toContain("ready");
    expect(historial!.reads.options).toEqual(expect.arrayContaining(["resume", "storage"]));
  });

  it("es el pedido de D4: lo obligatorio incluye avisar que es un asistente automático y la conversación nueva tras el reporte; encendido por defecto, las tres pruebas y «leyendo la guía»; opcional, lo demás", () => {
    expect(json.points.find((p) => /automated assistant/i.test(p.title))?.level).toBe("required");
    expect(json.points.find((p) => p.reads.methods?.includes("newConversation") && /report/i.test(p.title))?.level).toBe("required");
    const nivel = (id: string) => json.capabilities.find((c) => c.id === id)?.level;
    expect(["attach_image", "screenshot", "pick_element", "reading_guide"].map(nivel)).toEqual(["default_on", "default_on", "default_on", "default_on"]);
    expect(["visible_steps", "answered_outcome"].map(nivel)).toEqual(["optional", "optional"]);
  });

  it("no pide la marca de Supcoflow ni diseño (decisión del dueño: la marca no va en el chat)", () => {
    for (const x of todos) {
      expect(`${x.id} ${x.title}`, x.id).not.toMatch(/attribution|brand|powered by|logo/i);
      for (const frase of x.must) expect(frase, `${x.id} exige algo de marca o de diseño`).not.toMatch(/brand|powered by|logo|colou?r|\bfont|class name/i);
    }
    expect(json.doesNotAsk.some((f) => /Supcoflow/.test(f) && /attribution/i.test(f))).toBe(true);
    expect(json.doesNotAsk.some((f) => /colou?rs/i.test(f))).toBe(true);
  });
});

describe("el documento dice lo mismo que contract.json", () => {
  it("tiene una sección por punto y por capacidad, con el id y el título del JSON, y ninguna más", () => {
    const enDoc = [...DOC.matchAll(/^### (P\d+|[a-z_]+) — (.+)$/gm)].map((m) => [m[1]!, m[2]!]);
    expect(enDoc).toEqual(todos.map((x) => [x.id, x.title]));
  });

  it.each(todos.map((x) => [x.id, x] as const))("%s: nivel, condición, obligaciones y libertades coinciden frase por frase", (id, x) => {
    const cuerpo = seccion(id);
    expect(cuerpo, `${id}: el nivel`).toContain(`**Level:** ${x.level}`);
    if (x.condition !== undefined) expect(cuerpo, `${id}: la condición`).toContain(`**Applies when:** ${x.condition}`);
    else expect(cuerpo, `${id} no declara condición en el JSON`).not.toContain("**Applies when:**");
    expect(vinetas(cuerpo, "Must"), `${id}: Must`).toEqual(x.must);
    expect(vinetas(cuerpo, "Free"), `${id}: Free`).toEqual(x.free);
    expect(x.must.length, `${id} sin obligaciones`).toBeGreaterThan(0);
    expect(x.free.length, `${id} sin libertades`).toBeGreaterThan(0);
  });

  it("lo que el contrato NO pide está en el documento, frase por frase", () => {
    const cuerpo = DOC.slice(DOC.indexOf("## What the contract does not ask for"));
    expect(DOC).toContain("## What the contract does not ask for");
    expect(vinetas(cuerpo, "Not asked"), "lo que no se pide").toEqual(json.doesNotAsk);
  });

  it("los vínculos relativos llevan a algo que existe", () => {
    const vinculosRelativos = [...DOC.matchAll(/\]\((\.{1,2}\/[^)#]*)(#[^)]*)?\)/g)].map((m) => m[1]!);
    for (const v of vinculosRelativos) expect(existsSync(resolve(RAIZ, "docs", v)), `apunta a ${v}`).toBe(true);
  });
});

describe("el contrato está atado a los tipos del núcleo", () => {
  const nombrados = (clave: keyof Referencias): string[] => todos.flatMap((x) => x.reads[clave] ?? []);

  it("todo método, campo del estado, evento, opción y código de error que nombra existe", () => {
    for (const m of nombrados("methods")) expect(METODOS, `el núcleo no tiene el método/propiedad «${m}»`).toContain(m);
    for (const s of nombrados("state")) expect(CAMPOS, `el estado no tiene el campo «${s}»`).toContain(s);
    for (const e of nombrados("events")) expect(EVENTOS, `el núcleo no emite el evento «${e}»`).toContain(e);
    for (const o of nombrados("options")) expect(Object.keys(OPCIONES), `no existe la opción «${o}»`).toContain(o);
    for (const c of nombrados("errors")) expect(CODIGOS_DE_ERROR_V1, `el protocolo no documenta el código «${c}»`).toContain(c);
  });

  it("todo lo que el núcleo expone está en un punto o declarado sin requisito (y no en los dos)", () => {
    const sin = json.withoutRequirement;
    const todo: [string, string[], string[], string[]][] = [
      ["método", METODOS, nombrados("methods"), sin.methods],
      ["campo del estado", CAMPOS, nombrados("state"), sin.state],
      ["evento", EVENTOS, nombrados("events"), sin.events],
      ["opción", Object.keys(OPCIONES), nombrados("options"), sin.options],
    ];
    for (const [que, existentes, nombradosAca, sinRequisito] of todo) {
      for (const nombre of existentes) {
        const enContrato = nombradosAca.includes(nombre);
        const libre = sinRequisito.includes(nombre);
        expect(enContrato || libre, `${que} «${nombre}»: el contrato no dice nada de él (ni en un punto ni en withoutRequirement)`).toBe(true);
        expect(enContrato && libre, `${que} «${nombre}» está en un punto Y en withoutRequirement`).toBe(false);
      }
      for (const nombre of sinRequisito) expect(existentes, `withoutRequirement nombra un ${que} que no existe: «${nombre}»`).toContain(nombre);
    }
  });
});

describe("el paquete lleva el contrato", () => {
  const paquete = JSON.parse(readFileSync(`${RAIZ}package.json`, "utf8")) as { files: string[]; exports: Record<string, unknown> };
  it("`contract.json` está en `files` y exportado", () => {
    expect(paquete.files).toContain("contract.json");
    expect(paquete.exports["./contract.json"]).toBe("./contract.json");
    expect(paquete.files).toContain("docs");
  });
});

// ── los nombres de ADENTRO ────────────────────────────────────────────────────────────────────────────────────────────────────────
// `reads` ata los nombres de primer nivel. Las obligaciones nombran además campos anidados y valores (`pendingQuestion.report`, `options[].label`, `status: "uploaded"`, `reportId`…): si
// se renombra uno en `tipos.ts`, ESTE test tiene que ponerse rojo (revisión 1, H4). Cada nombre entre comillas invertidas de un título, una obligación o una libertad es de una de tres clases:
// un nombre de primer nivel que `reads` ya ata, un literal que no es del núcleo, o un nombre anidado que se comprueba acá contra un estado público real (o contra el tipo, al compilar).
describe("los nombres entre comillas invertidas existen en el núcleo", () => {
  const evs: EventoDelWidget[] = [
    { v: 1, t: "sesion", id: "s1", indice: 0 },
    { v: 1, t: "paso", que: "guia_leida", seccion: "Billing" },
    { v: 1, t: "asistente", texto: "hola" },
    { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "p", opciones: [{ id: "approve", label: "Yes", style: "primary" }], libre: false, reporte: { titulo: "T", cuerpo: "C" } },
    { v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" },
    { v: 1, t: "error", codigo: "red", mensaje: "m", terminal: false },
  ];
  const adjuntos = marcar(agregarElemento(sinAdjuntos(), ELEMENTO), 1, { estado: "listo", evidenciaId: "evd_1" });
  const E = estadoPublico({ chat: evs.reduce(reducir, alEnviar(estadoInicial(null), "hola")), adjuntos, permisos: PERMISOS_COMO_HOY });
  const q = E.pendingQuestion!;
  const tiene = (o: object | null | undefined, ...claves: string[]) => o != null && claves.every((c) => c in o);

  // Comprobaciones al COMPILAR: un valor o campo que deje de existir en los tipos rompe `npm run typecheck`.
  const _tipos = {
    kindDeLaPregunta: "question" satisfies PendingQuestion["kind"],
    kindDelDesenlace: ["reported", "answered"] satisfies ChatOutcome["kind"][],
    actividad: "reading_guide" satisfies ChatActivity,
    disponibilidad: ["available"] satisfies (keyof Availability)[],
    usuario: ["attributes", "id"] satisfies (keyof ChatUser)[],
    captura: ["hideUi", "showUi"] satisfies (keyof NonNullable<Parameters<SupportChat["attachScreenshot"]>[0]>)[],
    elegir: ["ignore"] satisfies (keyof NonNullable<Parameters<SupportChat["pickElement"]>[0]>)[],
    almacen: ["none"] satisfies NonNullable<SupportChatOptions["storage"]>[],
  };
  void _tipos;

  /** Nombres anidados y valores: cada uno se comprueba contra el estado de arriba (o contra los tipos, ya arriba). */
  const ANIDADOS: Record<string, () => boolean> = {
    "pendingQuestion.prompt": () => tiene(q, "prompt"),
    "pendingQuestion.report": () => tiene(q, "report") && tiene(q.report, "title", "body"),
    "reportCopy: true": () => E.messages.some((m) => m.role === "assistant" && m.reportCopy === true && m.text === q.prompt),
    "options[].label": () => q.options.length > 0 && q.options.every((o) => tiene(o, "id", "label", "style")),
    allowsText: () => tiene(q, "allowsText"),
    id: () => tiene(q, "id"),
    question: () => true, // el `kind` de PendingQuestion, al compilar
    code: () => tiene(E.error, "code"),
    "error.message": () => tiene(E.error, "message"),
    "pending: true": () => E.messages.some((m) => m.role === "user" && tiene(m, "pending")),
    'status: "uploaded"': () => E.attachments.some((a) => a.status === "uploaded"),
    retryable: () => E.attachments.every((a) => tiene(a, "retryable")),
    reportId: () => E.messages.some((m) => m.role === "outcome" && m.outcome.kind === "reported" && tiene(m.outcome, "reportId")),
    reported: () => E.reported && E.messages.some((m) => m.role === "outcome" && m.outcome.kind === "reported"),
    answered: () => true, // el `kind` del desenlace, al compilar
    steps: () => E.messages.some((m) => m.role === "assistant" && m.steps.length > 0),
    reading_guide: () => true, // ChatActivity, al compilar
    available: () => true, // Availability, al compilar
    "user.attributes": () => true, // ChatUser, al compilar
    "user.id": () => true, // ChatUser, al compilar
    // T7: las tres herramientas de evidencia se declaran en `capabilities`; el tipo lo comprueba al compilar y el núcleo las acepta en `createSupportChat` (ver `soporte.test.ts`).
    "attachImage: true": () => (({ attachImage: true }) satisfies ChatCapabilities).attachImage,
    "screenshot: true": () => (({ screenshot: true }) satisfies ChatCapabilities).screenshot,
    "pickElement: true": () => (({ pickElement: true }) satisfies ChatCapabilities).pickElement,
    hideUi: () => true,
    showUi: () => true,
    ignore: () => true,
    '"none"': () => true, // SupportChatOptions["storage"], al compilar
  };
  /** Literales y palabras de otros mundos (HTML, JS) que el contrato nombra sin que sean del núcleo. */
  const AJENOS = new Set(["true", "false", "null", "innerHTML", "dangerouslySetInnerHTML", "v-html", "remark-gfm", "href"]);

  const nombresDeNivel1 = new Set([...METODOS, ...CAMPOS, ...EVENTOS, ...Object.keys(OPCIONES), ...CODIGOS_DE_ERROR_V1, ...Object.keys(modulo)]);
  const textos = todos.flatMap((x) => [x.title, ...x.must, ...x.free].map((t) => [x.id, t] as const));
  const nombres = [...new Set(textos.flatMap(([, t]) => [...t.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)))];

  it.each(nombres.map((n) => [n]))("`%s`", (nombre) => {
    if (AJENOS.has(nombre)) return;
    if (Object.hasOwn(ANIDADOS, nombre)) {
      expect(ANIDADOS[nombre]!(), `\`${nombre}\` ya no existe en el estado público`).toBe(true);
      return;
    }
    const raiz = nombre.replace(/\(.*\)$/, "");
    expect(nombresDeNivel1.has(raiz), `\`${nombre}\` no es un nombre del núcleo que el test conozca: agregalo a ANIDADOS (con su comprobación) o a AJENOS`).toBe(true);
  });

  it("las comprobaciones de ANIDADOS no sobran: todas las usa algún texto del contrato", () => {
    for (const k of Object.keys(ANIDADOS)) expect(nombres, `\`${k}\` está en ANIDADOS y el contrato ya no lo nombra`).toContain(k);
  });

  it("`parseAssistantText`, que P4 recomienda, es una exportación del núcleo y el documento lo nombra en P4", () => {
    expect(Object.keys(modulo)).toContain("parseAssistantText");
    expect(seccion("P4")).toContain("`parseAssistantText(text, origin)`");
  });
});

// ── revisión 1 (H2, H3.1, H5, H6) ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("el contrato dice la verdad y no pone diseño", () => {
  const guia = (rel: string) => readFileSync(`${RAIZ}${rel}`, "utf8");
  const P = (id: string) => todos.find((x) => x.id === id)!;

  it("H3.1: P6 exige dibujar el reporte como texto plano (lo que se lee es lo que se manda), también la copia que llega en `messages`", () => {
    const plano = P("P6").must.find((m) => /plain text/.test(m));
    expect(plano, "P6 no pide texto plano").toBeDefined();
    expect(plano).toMatch(/never as Markdown or HTML/);
    expect(plano).toMatch(/line breaks/);
    expect(plano).toMatch(/messages/);
  });

  it("H2: P4 nombra el caso de las bibliotecas que vuelven enlaces las URL sueltas (`remark-gfm`)", () => {
    expect(P("P4").must.some((m) => /remark-gfm/.test(m) && /href/.test(m))).toBe(true);
  });

  it("H2: la documentación no promete que el servidor ya sacó todo ni que el texto es seguro «con cualquier biblioteca»", () => {
    for (const rel of ["docs/presentation-contract.md", "docs/core.md", "docs/protocol-v1.md", "CHANGELOG.md"]) {
      const md = guia(rel);
      expect(md, rel).not.toMatch(/whatever library draws it/i);
      expect(md, rel).not.toMatch(/already removes links to other sites/i);
      expect(md, rel).not.toMatch(/already lost every link/i);
      expect(md, rel).not.toMatch(/every HTML tag/i);
    }
    expect(guia("docs/core.md")).toMatch(/syntax of a link/);
    expect(guia("docs/protocol-v1.md")).toMatch(/syntax of a link/);
  });

  it("H5: el contrato tiene su propia versión; el documento no dice que es la del paquete", () => {
    expect(DOC).not.toMatch(/version of the contract is the one of the package/i);
    expect(DOC).toMatch(/own version/);
    const paquete = JSON.parse(readFileSync(`${RAIZ}package.json`, "utf8")) as { version: string };
    expect(json.version).not.toBe(paquete.version);
  });

  it("H6: las obligaciones dicen QUÉ y no DÓNDE (nada de «dentro de», «encima de», «al lado de»)", () => {
    for (const x of todos) for (const m of x.must) expect(m, `${x.id}: pone diseño`).not.toMatch(/\b(inside|above|below|beside|underneath|next to)\b/i);
  });

  it("H8: los límites conocidos avisan que el servidor puede dejar código con caracteres de ancho completo", () => {
    expect(DOC).toMatch(/full-width/);
    expect(guia("docs/core.md")).toMatch(/full-width/);
  });
});

// ── pedidos del dueño del 2026-10-30 ──────────────────────────────────────────────────────────────────────
describe("el pegado largo y la lista de charlas anteriores", () => {
  const P = (id: string) => json.points.find((p) => p.id === id);

  it("P15: lo pegado que supera el límite se muestra colapsado, se puede expandir y se manda completo; el criterio es el del núcleo", () => {
    const p = P("P15")!;
    expect(p, "falta P15").toBeDefined();
    expect(p.level).toBe("required");
    const must = p.must.join("\n");
    expect(must).toMatch(/isLongPaste\(\)/);
    expect(must).toMatch(/pasted text/);
    expect(must).toMatch(/expand/);
    expect(must).toMatch(/whole/);
    expect(p.reads.state).toContain("messages");
    expect(seccion("P15")).toContain("`PASTE_LIMITS`");
  });

  it("P15 no inventa un límite propio: el documento dice el mismo número que `PASTE_LIMITS`", () => {
    expect(seccion("P15")).toContain(`${modulo.PASTE_LIMITS.characters.toLocaleString("en-US")} characters`);
    expect(seccion("P15")).toContain(`${modulo.PASTE_LIMITS.lines} lines`);
  });

  it("P16: la lista de charlas anteriores es obligatoria CUANDO EL SERVIDOR LA SOPORTE (todavía no), y el documento dice qué necesita", () => {
    const p = P("P16")!;
    expect(p, "falta P16").toBeDefined();
    expect(p.level).toBe("required");
    expect(p.condition).toMatch(/does not yet/);
    const cuerpo = seccion("P16");
    expect(cuerpo).toMatch(/identity/);
    expect(cuerpo).toMatch(/verified/);
    expect(cuerpo).toMatch(/P14/);
  });

  it("P14 sigue siendo lo que el núcleo da hoy: recuperar la charla en curso", () => {
    expect(P("P14")!.reads.methods).toContain("ready");
    expect(P("P14")!.condition).toBeUndefined();
  });
});

// ── revisión 2 (N1, N3, N8, N9, N10) ──────────────────────────────────────────────────────────────────────────────────────────────
describe("revisión 2 del contrato", () => {
  const P = (id: string) => json.points.find((p) => p.id === id)!;

  it("N1: P15 manda avisar cuando un pegado no entra en el mensaje, y no promete que siempre cabe", () => {
    expect(P("P15").must.some((m) => /MESSAGE_MAX_LENGTH/.test(m) && /tell the person/.test(m) && /never cut it silently/.test(m))).toBe(true);
    expect(DOC).not.toMatch(/a collapsed text always fits/);
    expect(seccion("P15")).toContain("`MESSAGE_MAX_LENGTH`");
  });

  it("N2: P15 pide poder ver y expandir lo pegado mientras se escribe, no sólo después de mandarlo", () => {
    expect(P("P15").must.some((m) => /before sending/.test(m) && /expand/.test(m))).toBe(true);
  });

  it("N3: P16 no manda filtrar por el usuario DECLARADO: exige la identidad verificada que el servidor pida", () => {
    const m = P("P16").must.join("\n");
    expect(m).toMatch(/verified identity/);
    expect(m).toMatch(/a declared `user.id` alone is not enough/);
    expect(m).not.toMatch(/identified by the user your app declares/);
  });

  it("N8: P15 no alcanza al asistente ni a la confirmación del reporte", () => {
    expect(P("P15").must.some((m) => /Never collapse/.test(m) && /assistant/.test(m) && /report confirmation/.test(m))).toBe(true);
  });

  it("N9: P16 empieza a aplicar con una versión MAYOR del contrato (un requisito nuevo), no con una menor", () => {
    const c = seccion("P16");
    expect(c).toMatch(/new major version/);
    expect(c).not.toMatch(/new minor version/);
  });

  it("N10: la regla del `href` de P4 nombra también los correos sueltos", () => {
    expect(P("P4").must.some((m) => /bare URLs or e-mail addresses/.test(m) && /remark-gfm/.test(m))).toBe(true);
  });
});
