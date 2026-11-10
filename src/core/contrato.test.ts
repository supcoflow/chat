// @vitest-environment happy-dom
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVIDADES_V1, DESENLACES_V1, PASOS_V1, TIPOS_DE_EVENTO_V1 } from "../protocolo";
import { createFakeBackend } from "../testing/backend-falso";
import { getScenario } from "../testing/catalogo";
import { completeElementPick } from "../testing/senalar";
import type { Grabacion } from "../testing/escenario";
import { createSupportChat } from "./soporte";
import { TIPOS_DE_EVENTO_PUBLICO } from "./traducir";
import type { ChatEvent, ChatState } from "./tipos";

// LOS TESTS DE CONTRATO del núcleo (plan de las tres formas, B3): cada escenario de `contrato/*.json` es una charla completa con el servidor,
// armada con los eventos que el traductor del backend emite hoy (no son capturas de un servidor vivo: eso gastaría plata y pegaría a producción).
// El test reproduce las acciones de la interfaz contra un `fetch` guionado y compara TRES cosas con lo que el archivo dice que tiene que pasar:
//   · `pedidos`: lo que el núcleo le MANDÓ al servidor (ruta, cuerpo),
//   · `eventos`: lo que una interfaz propia RECIBIÓ por `onEvent`, en inglés y en orden,
//   · `estado`: el `getState()` final.
// Cambiar cualquiera de las tres cosas es cambiar el contrato público: el escenario se actualiza A MANO, en el mismo commit que la documentación.
// Los escenarios son los del banco de pruebas (`testing/`); acá se los repite contra el núcleo.
// Para regenerar lo esperado después de un cambio querido: `ACTUALIZAR_CONTRATO=1 npx vitest run src/core/contrato.test.ts` y revisar el diff.

interface Pedido { metodo: string; ruta: string; cuerpo?: unknown }
interface Escenario extends Grabacion {
  esperado?: { pedidos: Pedido[]; eventos: ChatEvent[]; estado: ChatState };
}

// (`new URL(…, import.meta.url)` no anda bajo happy-dom, que trae su propia `URL`: se arma la ruta con el nombre del archivo.)
const DIR = `${dirname(fileURLToPath(import.meta.url))}/contrato/`;
const archivos = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const ACTUALIZAR = process.env.ACTUALIZAR_CONTRATO === "1";
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// El `fetch` guionado ES el backend falso del banco de pruebas (`@supcoflow/chat/testing`): los escenarios que se repiten acá son los mismos que recibe quien arma una
// interfaz, así que lo que el banco entrega es lo que el núcleo ya prueba que anda.
async function correr(nombre: string): Promise<NonNullable<Escenario["esperado"]>> {
  vi.useFakeTimers({ toFake: ["Date"] }); // lo único que cambia de una corrida a otra es `capturedAt`, la hora en que se señaló el elemento
  vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
  document.body.innerHTML = ""; // el botón que un escenario señala no sobrevive al siguiente (su selector depende de lo que haya en la página)
  const e = getScenario(nombre);
  const falso = createFakeBackend(e, { backendUrl: "https://chat.test", origin: "https://app.example.test" });
  const datos = new Map<string, string>();
  if (e.saved !== undefined) datos.set("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: e.saved.id, indice: e.saved.index }));
  const chat = createSupportChat({
    tenantId: "tnt_a",
    projectId: "proj_b",
    backendUrl: "https://chat.test",
    autoContext: false,
    storage: { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v), removeItem: (k) => void datos.delete(k) },
    fetch: falso.fetch,
  });
  const eventos: ChatEvent[] = [];
  chat.onEvent((ev) => eventos.push(ev));
  for (const a of e.script) {
    if ("send" in a) await chat.send(a.send);
    else if ("answer" in a) await chat.answer(chat.getState().pendingQuestion?.id ?? "ninguna", a.answer);
    // `true` = el id de la pregunta que la interfaz tiene a la vista AHORA; un texto = el id de una tarjeta vieja que quedó guardada.
    else if ("confirmReport" in a) await chat.confirmReport(a.confirmReport === true ? (chat.getState().pendingQuestion?.id ?? "ninguna") : a.confirmReport);
    else if ("reviseReport" in a) await chat.reviseReport(a.reviseReport === true ? (chat.getState().pendingQuestion?.id ?? "ninguna") : a.reviseReport);
    else if ("retry" in a) await chat.retry();
    else if ("newConversation" in a) chat.newConversation();
    else if ("checkAvailability" in a) await chat.checkAvailability();
    else if ("pickElement" in a) expect(await completeElementPick(chat)).toBe("picked");
    else await chat.ready;
  }
  await chat.ready;
  await tick(); // la subida de un adjunto termina en una promesa suelta
  expect(falso.remaining, "el escenario guionó respuestas que nadie pidió").toBe(0);
  const pedidos: Pedido[] = falso.requests.map((p) => ({ metodo: p.method, ruta: p.path, ...(p.body === undefined ? {} : { cuerpo: p.body }) }));
  chat.destroy();
  return { pedidos, eventos, estado: chat.getState() };
}

afterEach(() => { vi.useRealTimers(); });

describe("contrato: charlas grabadas → pedidos, eventos y estado", () => {
  it("hay escenarios", () => {
    expect(archivos.length).toBeGreaterThanOrEqual(25);
  });

  it.each(archivos)("%s", async (archivo) => {
    const ruta = `${DIR}${archivo}`;
    const escenario = JSON.parse(readFileSync(ruta, "utf8")) as Escenario;
    const real = await correr(archivo.replace(/\.json$/, ""));
    if (ACTUALIZAR) {
      writeFileSync(ruta, JSON.stringify({ ...escenario, esperado: real }, null, 2) + "\n");
      return;
    }
    expect(escenario.esperado, `${archivo} no tiene \`esperado\`: corré con ACTUALIZAR_CONTRATO=1 y revisá el diff`).toBeDefined();
    expect(real.pedidos).toEqual(escenario.esperado!.pedidos);
    expect(real.eventos).toEqual(escenario.esperado!.eventos);
    expect(real.estado).toEqual(escenario.esperado!.estado);
  });
});

describe("contrato: cada evento del protocolo tiene su escenario", () => {
  const lineas = archivos.flatMap((f) => (JSON.parse(readFileSync(`${DIR}${f}`, "utf8")) as Escenario).respuestas.flatMap((r) => ("stream" in r ? r.stream : []))).filter((l): l is { t: string; que?: string } => typeof l === "object" && (l as { v?: unknown }).v === 1);

  it.each(Object.keys(TIPOS_DE_EVENTO_V1))("el evento `%s` aparece en algún escenario", (t) => {
    expect(lineas.some((l) => l.t === t)).toBe(true);
  });
  it.each(Object.keys(PASOS_V1))("el paso `%s` aparece en algún escenario", (que) => {
    expect(lineas.some((l) => l.t === "paso" && l.que === que)).toBe(true);
  });
  it.each(Object.keys(ACTIVIDADES_V1))("la actividad `%s` aparece en algún escenario", (que) => {
    expect(lineas.some((l) => l.t === "actividad" && l.que === que)).toBe(true);
  });
  it.each(Object.keys(DESENLACES_V1))("el desenlace `%s` aparece en algún escenario", (que) => {
    expect(lineas.some((l) => l.t === "desenlace" && l.que === que)).toBe(true);
  });
});

describe("contrato: cada evento público tiene su escenario", () => {
  const publicos = archivos.flatMap((f) => (JSON.parse(readFileSync(`${DIR}${f}`, "utf8")) as Escenario).esperado?.eventos.map((e) => e.type) ?? []);
  it.each(Object.keys(TIPOS_DE_EVENTO_PUBLICO))("el evento público `%s` llega en algún escenario", (tipo) => {
    expect(publicos).toContain(tipo);
  });
});
