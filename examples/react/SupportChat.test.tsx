// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESTADO_OK, fetchGuionado, nd, tick } from "../../test-support/fetch-guionado-react";
import type { SupportChat as Chat } from "@supcoflow/chat/core";
import { SupportChat } from "./SupportChat";

// The chats the core creates, to spy on what the example asks of them (`pickElement({ ignore })`, `attachScreenshot({ hideUi })`).
const chats = vi.hoisted(() => [] as Chat[]);
vi.mock("@supcoflow/chat/core", async (importOriginal) => {
  const m = await importOriginal<typeof import("@supcoflow/chat/core")>();
  return { ...m, createSupportChat: (o: Parameters<typeof m.createSupportChat>[0]) => { const c = m.createSupportChat(o); chats.push(c); return c; } };
});

// The unstyled React example, tested the way a browser would use it: the REAL core behind the hook, a scripted `fetch` instead of a backend. What is looked at is the
// DOM — its text, its roles and what was asked of the backend — never its classes or its looks, which is all the presentation contract (P1…P15) is about.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "https://chat.test";
const OPCIONES_BASE = { tenantId: "t", projectId: "p", backendUrl: BASE, autoContext: false, storage: "none" as const, locale: "en" };
let raiz: Root | null = null;
let contenedor: HTMLElement;

beforeEach(() => {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("https://app.example.com/settings");
});
afterEach(async () => {
  if (raiz !== null) await act(async () => raiz!.unmount());
  raiz = null;
  document.body.innerHTML = "";
  sessionStorage.clear();
  chats.length = 0;
  vi.restoreAllMocks();
});

const ESTADOS = (n = 6, cuerpo = ESTADO_OK): string[] => Array.from({ length: n }, () => cuerpo);
const PREGUNTA_DE_REPORTE = (extra: object = {}) => ({
  t: "pregunta",
  requestId: "req_1",
  kind: "tool-approval",
  prompt: "This is what I'll send to the team:\n\nSave does nothing\n\nWhat happened: clicking Save shows no message.\nExpected: it saves.\n\nShall I send it?",
  opciones: [{ id: "approve", label: "Yes, report it", style: "primary" }, { id: "cancel", label: "No, I want to fix something", style: "default" }],
  libre: false,
  reporte: { titulo: "Save does nothing", cuerpo: "What happened: clicking Save shows no message.\nExpected: it saves." },
  ...extra,
});

async function montar(fn: typeof fetch, opciones: Record<string, unknown> = {}, estricto = false) {
  raiz = createRoot(contenedor);
  const r = raiz;
  const arbol = <SupportChat {...OPCIONES_BASE} fetch={fn} {...opciones} />;
  await act(async () => r.render(estricto ? <StrictMode>{arbol}</StrictMode> : arbol));
  await act(async () => tick(8));
}
const boton = (nombre: string | RegExp): HTMLButtonElement | undefined => [...contenedor.querySelectorAll("button")].find((b) => (typeof nombre === "string" ? b.textContent === nombre : nombre.test(b.textContent ?? "")));
const clic = async (el: Element | undefined) => {
  expect(el, "el control no está en pantalla").toBeDefined();
  await act(async () => { (el as HTMLElement).click(); await tick(8); });
};
async function abrir(fn: typeof fetch, opciones: Record<string, unknown> = {}, estricto = false) {
  await montar(fn, opciones, estricto);
  await clic(boton("Help"));
}
async function escribirYMandar(texto: string) {
  const campo = contenedor.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    const poner = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    poner.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { contenedor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(8); });
}
async function escribirSinMandar(texto: string) {
  const campo = contenedor.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    const poner = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    poner.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const texto = () => contenedor.textContent ?? "";
const respuestasAprobadas = (llamadas: { cuerpo?: unknown }[]) => llamadas.filter((l) => JSON.stringify(l.cuerpo ?? {}).includes('"optionId"'));

describe("P1 — availability", () => {
  it("si el chat no está activo para este origen no se dibuja NADA (ni el botón)", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": [new Response(JSON.stringify({ ok: false, motivo: "origen_no_admitido" }), { status: 403 })] });
    await montar(fn);
    expect(contenedor.innerHTML).toBe("");
  });

  it("si está activo se ofrece el disparador, y recién al abrirlo aparece el panel", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS() });
    await montar(fn);
    expect(boton("Help")).toBeDefined();
    expect(contenedor.querySelector("textarea")).toBeNull();
    await clic(boton("Help"));
    expect(contenedor.querySelector("textarea")).not.toBeNull();
  });
});

describe("P2, P13 — automated assistant, keyboard and screen reader", () => {
  it("al abrir, antes del primer mensaje, dice que es un asistente automático y el foco va al campo", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS() });
    await abrir(fn);
    expect(texto()).toMatch(/automated assistant/i);
    expect(document.activeElement).toBe(contenedor.querySelector("textarea"));
  });

  it("los mensajes viven en una región `log` (el lector de pantalla anuncia los nuevos) y el panel tiene nombre", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS() });
    await abrir(fn);
    expect(contenedor.querySelector('[role="log"]')?.getAttribute("aria-live")).toBe("polite");
    expect(contenedor.querySelector("section")?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("P3, P5 — what the person writes and the working indicator", () => {
  it("el mensaje se ve enseguida; mientras no hay texto del asistente hay un indicador; al llegar el texto se va", async () => {
    let soltar!: () => void;
    const turno = new Promise<string>((r) => (soltar = () => r(nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "hola" }, { t: "asistente", texto: "¿en qué te ayudo?" }, { t: "espera", indice: 3 }))));
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS(), "/api/chat/sesion": [() => turno] });
    await abrir(fn);
    await escribirYMandar("hola");
    expect(texto()).toContain("hola");
    expect(contenedor.querySelector('[role="status"]')?.textContent).toMatch(/working/i);
    await act(async () => { soltar(); await tick(8); });
    expect(texto()).toContain("¿en qué te ayudo?");
    expect(contenedor.querySelector('[role="status"]')).toBeNull();
  });

  it("mientras lee la guía lo dice (`reading_guide`)", async () => {
    let cerrar!: () => void;
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "hola" }, { t: "actividad", que: "leyendo_la_guia" })));
        cerrar = () => c.close();
      },
    });
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS(), "/api/chat/sesion": [new Response(cuerpo, { status: 200, headers: { "content-type": "application/x-ndjson" } })] });
    await abrir(fn);
    await escribirYMandar("hola");
    expect(contenedor.querySelector('[role="status"]')?.textContent).toMatch(/reading the guide/i);
    await act(async () => { cerrar(); await tick(8); });
  });
});

describe("P4 — the assistant's text", () => {
  const TEXTO = "Open **Settings** and see [the guide](https://app.example.com/help) or [a shady site](https://evil.example/x). <img src=x onerror=alert(1)> ![pixel](https://evil.example/p.png)\n\n- first\n- second";

  it("se dibuja el subconjunto seguro: negrita, lista y enlaces sólo al propio origen; nada de HTML ni imágenes ni enlaces a otro sitio", async () => {
    const { fn } = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "help" }, { t: "asistente", texto: TEXTO }, { t: "espera", indice: 3 })],
    });
    await abrir(fn);
    await escribirYMandar("help");
    const registro = contenedor.querySelector('[role="log"]')!;
    expect(registro.querySelector("strong")?.textContent).toBe("Settings");
    expect([...registro.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["first", "second"]);
    expect([...registro.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://app.example.com/help"]);
    expect(registro.querySelector("img")).toBeNull();
    // Lo que no es del subconjunto queda como texto, tal cual llegó.
    expect(registro.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(registro.textContent).toContain("a shady site");
  });
});

describe("P6 — the report confirmation", () => {
  async function conConfirmacion(extra: Record<string, unknown> = {}, rutasExtra: Record<string, (string | Response | (() => string | Response | Promise<string | Response>))[]> = {}) {
    const g = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "Save does nothing" }, { t: "asistente", texto: PREGUNTA_DE_REPORTE().prompt }, PREGUNTA_DE_REPORTE(), { t: "espera", indice: 5 })],
      ...rutasExtra,
    });
    await abrir(g.fn, extra);
    await escribirYMandar("Save does nothing");
    return g;
  }

  it("muestra el título y el cuerpo COMPLETOS, como texto plano con sus saltos de línea, y los dos botones con las palabras del servidor", async () => {
    await conConfirmacion();
    const tarjeta = contenedor.querySelector('[data-testid="report"]') ?? contenedor.querySelector("article");
    expect(tarjeta, "la confirmación tiene su propio bloque").not.toBeNull();
    expect(tarjeta!.textContent).toContain("Save does nothing");
    expect(tarjeta!.textContent).toContain("What happened: clicking Save shows no message.\nExpected: it saves.");
    expect(boton("Yes, report it")).toBeDefined();
    expect(boton("No, I want to fix something")).toBeDefined();
  });

  it("el mismo texto no sale dos veces: la copia como último mensaje del asistente no se dibuja mientras la confirmación está pendiente", async () => {
    await conConfirmacion();
    expect(texto().split("clicking Save shows no message.").length - 1).toBe(1);
  });

  it("NADA se aprueba solo: sin clic no hay respuesta; con el clic sale `approve` con el requestId de ESTA confirmación", async () => {
    const { llamadas } = await conConfirmacion({}, {
      "/api/chat/sesion/ses_A": [nd({ t: "pregunta_resuelta", requestId: "req_1", outcome: "approved", optionId: "approve" }, { t: "desenlace", que: "reportado", reporte: "rep_1" }, { t: "asistente", texto: "Done." }, { t: "espera", indice: 9 })],
    });
    await act(async () => tick(20));
    expect(respuestasAprobadas(llamadas)).toEqual([]);
    await clic(boton("Yes, report it"));
    const enviadas = respuestasAprobadas(llamadas);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.cuerpo).toMatchObject({ respuesta: { requestId: "req_1", optionId: "approve" } });
  });

  it("'No, I want to fix something' contesta `cancel` y el reporte no se envía", async () => {
    const { llamadas } = await conConfirmacion({}, { "/api/chat/sesion/ses_A": [nd({ t: "pregunta_resuelta", requestId: "req_1", outcome: "rejected", optionId: "cancel" }, { t: "asistente", texto: "What should change?" }, { t: "espera", indice: 9 })] });
    await clic(boton("No, I want to fix something"));
    const enviadas = respuestasAprobadas(llamadas);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.cuerpo).toMatchObject({ respuesta: { requestId: "req_1", optionId: "cancel" } });
    expect(texto()).not.toMatch(/report sent/i);
  });

  it("los dos botones se deshabilitan mientras hay un turno en vuelo", async () => {
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(nd({ t: "pregunta_resuelta", requestId: "req_1", outcome: "approved", optionId: "approve" }, { t: "espera", indice: 9 }))));
    await conConfirmacion({}, { "/api/chat/sesion/ses_A": [() => lenta] });
    const si = boton("Yes, report it")!;
    await act(async () => { si.click(); await tick(4); });
    expect(boton("Yes, report it")?.disabled ?? true).toBe(true);
    expect(boton("No, I want to fix something")?.disabled ?? true).toBe(true);
    await act(async () => { soltar(); await tick(8); });
  });

  it("dice qué adjuntos van con el reporte: sin adjuntos subidos, que no va ninguno", async () => {
    await conConfirmacion();
    const tarjeta = contenedor.querySelector("article")!;
    expect(tarjeta.textContent).toMatch(/no attachments/i);
  });

  it("si la confirmación ya no vigente llega (`confirmacion_no_vigente`), dice que el reporte NO se envió", async () => {
    await conConfirmacion({}, {
      "/api/chat/sesion/ses_A": [nd({ t: "error", codigo: "confirmacion_no_vigente", mensaje: "This confirmation is no longer current.", terminal: false }, { t: "espera", indice: 9 })],
    });
    await clic(boton("Yes, report it"));
    expect(texto()).toMatch(/report was not sent/i);
    expect(texto()).not.toContain("This confirmation is no longer current.");
  });
});

describe("P8 — after a report", () => {
  it("dice que se envió con el número, ya no ofrece adjuntos y ofrece empezar otra conversación (que abre una sesión nueva)", async () => {
    const { fn, llamadas } = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [
        nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "Save does nothing" }, PREGUNTA_DE_REPORTE(), { t: "espera", indice: 5 }),
        nd({ t: "sesion", id: "ses_B", indice: 0 }, { t: "usuario", texto: "another thing" }, { t: "asistente", texto: "Sure." }, { t: "espera", indice: 3 }),
      ],
      "/api/chat/sesion/ses_A": [nd({ t: "pregunta_resuelta", requestId: "req_1", outcome: "approved", optionId: "approve" }, { t: "desenlace", que: "reportado", reporte: "rep_3f9a" }, { t: "asistente", texto: "Done." }, { t: "espera", indice: 9 })],
    });
    await abrir(fn);
    await escribirYMandar("Save does nothing");
    expect(contenedor.querySelector('input[type="file"]')).not.toBeNull();
    await clic(boton("Yes, report it"));
    expect(texto()).toMatch(/report sent/i);
    expect(texto()).toContain("rep_3f9a");
    expect(contenedor.querySelector('input[type="file"]')).toBeNull();
    expect(boton(/pick an element/i)).toBeUndefined();
    await clic(boton("New conversation"));
    await escribirYMandar("another thing");
    const aperturas = llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/api/chat/sesion");
    expect(aperturas).toHaveLength(2);
  });

  it("el desenlace `answered` es una marca chica con palabras propias", async () => {
    const { fn } = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "how?" }, { t: "asistente", texto: "Like this." }, { t: "desenlace", que: "respondida" }, { t: "espera", indice: 4 })],
    });
    await abrir(fn);
    await escribirYMandar("how?");
    expect(texto()).toMatch(/answered/i);
  });
});

describe("P9 — errors", () => {
  async function conError(codigo: string, terminal: boolean) {
    const g = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "hola" }, { t: "error", codigo, mensaje: "Mensaje del servidor que NO se muestra", terminal }, { t: "fin" })],
    });
    await abrir(g.fn);
    await escribirYMandar("hola");
    return g;
  }

  it("`tope_de_mensajes`: no disponible por ahora, y jamás un botón que pida más", async () => {
    await conError("tope_de_mensajes", true);
    expect(texto()).toMatch(/not available for now/i);
    expect(texto()).not.toContain("Mensaje del servidor");
    expect(boton(/more/i)).toBeUndefined();
  });

  it("`limite_de_sesion`: llegó a su límite y se puede empezar otra", async () => {
    await conError("limite_de_sesion", true);
    expect(texto()).toMatch(/reached its limit/i);
    expect(boton("New conversation")).toBeDefined();
  });

  it("un código que no conoce: falla genérica; si no es terminal, `Retry`", async () => {
    await conError("codigo_nuevo_del_futuro", false);
    expect(texto()).toMatch(/something went wrong/i);
    expect(texto()).not.toContain("Mensaje del servidor");
    expect(boton("Retry")).toBeDefined();
  });
});

describe("P10 — attachments follow the data agreement and the state of the chat", () => {
  it("con el acuerdo de datos cerrado no se ofrecen imagen, captura ni señalar un elemento", async () => {
    const cerrado = JSON.stringify({ ok: true, motivo: null, marca: null, permite: { capturas: false, elementos: false, pagina_y_navegador: false } });
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS(6, cerrado) });
    await abrir(fn);
    expect(contenedor.querySelector('input[type="file"]')).toBeNull();
    expect(boton(/pick an element/i)).toBeUndefined();
    expect(boton(/screenshot/i)).toBeUndefined();
  });

  it("sin restricciones se ofrecen la imagen y señalar un elemento (la captura sólo si el navegador puede)", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS() });
    await abrir(fn);
    expect(contenedor.querySelector('input[type="file"]')).not.toBeNull();
    expect(boton(/pick an element/i)).toBeDefined();
  });
});

describe("P14 — the conversation comes back", () => {
  it("con una charla guardada no se muestra un chat vacío: se dice que se está cargando y recién después aparece la conversación", async () => {
    sessionStorage.setItem("supcoflow-chat/t/p", JSON.stringify({ id: "s1", indice: 1 }));
    let soltar!: () => void;
    const lenta = new Promise<string>((r) => (soltar = () => r(nd({ t: "usuario", texto: "hola" }, { t: "asistente", texto: "buen día" }, { t: "espera", indice: 1 }))));
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS(), "/api/chat/sesion/s1/eventos": [() => lenta] });
    await abrir(fn, { storage: "session" });
    expect(texto()).toMatch(/loading your conversation/i);
    expect(texto()).not.toMatch(/how can i help/i);
    await act(async () => { soltar(); await tick(10); });
    expect(texto()).toContain("buen día");
    expect(texto()).not.toMatch(/loading your conversation/i);
  });
});

describe("P15 — pasted text", () => {
  const LARGO = Array.from({ length: 30 }, (_, i) => `línea ${i + 1} del error`).join("\n");

  it("un mensaje del usuario largo se dibuja plegado, con su tamaño, y se puede abrir", async () => {
    const { fn } = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: LARGO }, { t: "asistente", texto: "Thanks." }, { t: "espera", indice: 3 })],
    });
    await abrir(fn);
    await escribirYMandar(LARGO);
    const plegado = contenedor.querySelector('[role="log"] details')!;
    expect(plegado).not.toBeNull();
    expect(plegado.querySelector("summary")?.textContent).toMatch(/pasted text/i);
    expect(plegado.querySelector("summary")?.textContent).toContain("30 lines");
    expect(plegado.textContent).toContain("línea 30 del error");
  });

  it("lo pegado en el campo se pliega, y se manda ENTERO", async () => {
    const { fn, llamadas } = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: `Look: ${LARGO}` }, { t: "asistente", texto: "Thanks." }, { t: "espera", indice: 3 })],
    });
    await abrir(fn);
    const campo = contenedor.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const evento = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
      evento.clipboardData = { getData: () => LARGO };
      campo.dispatchEvent(evento);
    });
    expect(campo.value).toBe("");
    expect(contenedor.querySelector("form details summary")?.textContent).toMatch(/pasted text/i);
    await escribirYMandar("Look: ");
    const apertura = llamadas.find((l) => l.metodo === "POST" && l.ruta === "/api/chat/sesion")!;
    expect(JSON.stringify(apertura.cuerpo)).toContain("línea 30 del error");
    expect(JSON.stringify(apertura.cuerpo)).toContain("Look: ");
  });
});

describe("P15 — the message never goes over the limit (review 1, P2-1, P3-7)", () => {
  const pegar = async (campo: HTMLTextAreaElement, texto: string) => act(async () => {
    const evento = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
    evento.clipboardData = { getData: () => texto };
    campo.dispatchEvent(evento);
  });
  const abrirYApuntar = async () => {
    const g = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "x" }, { t: "asistente", texto: "ok" }, { t: "espera", indice: 3 })],
    });
    await abrir(g.fn);
    return g;
  };
  const enviado = (llamadas: { metodo: string; ruta: string; cuerpo?: unknown }[]) => (llamadas.find((l) => l.metodo === "POST" && l.ruta === "/api/chat/sesion")!.cuerpo as { mensaje: string }).mensaje;

  it("lo escrito + un pegado largo que no entra: lo que sale mide como mucho 4.000 y el aviso dice cuánto se guardó", async () => {
    const { llamadas } = await abrirYApuntar();
    await escribirSinMandar("Here is the log:");
    await pegar(contenedor.querySelector("textarea")!, "x".repeat(5000));
    const aviso = /Only the first (\d+) of 5000 characters fit/.exec(contenedor.querySelector("form")!.textContent ?? "");
    expect(aviso).not.toBeNull();
    await act(async () => { contenedor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(8); });
    const mensaje = enviado(llamadas);
    expect(mensaje.length).toBeLessThanOrEqual(4000);
    expect(mensaje.startsWith("Here is the log:\nxxxx")).toBe(true);
    // «Here is the log:» (16) + el salto de línea (1) + lo guardado = el mensaje entero.
    expect(Number(aviso![1]) + 17).toBe(mensaje.length);
  });

  it("dos pegados largos no quedan pegados en la misma línea, y juntos tampoco pasan de 4.000", async () => {
    const { llamadas } = await abrirYApuntar();
    const campo = contenedor.querySelector("textarea")!;
    await pegar(campo, Array.from({ length: 20 }, (_, i) => `a${i}`).join("\n"));
    await pegar(campo, Array.from({ length: 20 }, (_, i) => `b${i}`).join("\n"));
    await escribirSinMandar("see:");
    await act(async () => { contenedor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(8); });
    const mensaje = enviado(llamadas);
    expect(mensaje).toContain("a19\nb0");
    expect(mensaje.length).toBeLessThanOrEqual(4000);
  });

  it("un pegado corto que no entra se inserta donde está el cursor (no al final) y se avisa", async () => {
    await abrirYApuntar();
    const campo = contenedor.querySelector("textarea") as HTMLTextAreaElement;
    await escribirSinMandar("AAAA" + "z".repeat(3982) + "BBBB");
    await act(async () => campo.setSelectionRange(4, 4));
    await pegar(campo, "12345678901234567890");
    expect(campo.value.length).toBe(4000);
    expect(campo.value.startsWith("AAAA1234567890zzz")).toBe(true);
    expect(campo.value.endsWith("BBBB")).toBe(true);
    expect(contenedor.querySelector("form")!.textContent).toContain("Only the first 10 of 20 characters fit");
  });
});

describe("P6 — the copy of the report stays plain text after it is answered (review 1, P2-2; the core marks it with `reportCopy` since T6)", () => {
  it("después de «No, I want to fix something» el borrador se relee como TEXTO (sin negrita ni lista), no como Markdown", async () => {
    const prompt = "This is what I'll send to the team:\n\nSave does nothing\n\n- step **one**\n- step two\n\nShall I send it?";
    const g = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "Save does nothing" }, PREGUNTA_DE_REPORTE({ prompt, reporte: { titulo: "Save does nothing", cuerpo: "- step **one**\n- step two" } }), { t: "espera", indice: 5 })],
      "/api/chat/sesion/ses_A": [nd({ t: "pregunta_resuelta", requestId: "req_1", outcome: "rejected", optionId: "cancel" }, { t: "asistente", texto: "What should change?" }, { t: "espera", indice: 9 })],
    });
    await abrir(g.fn);
    await escribirYMandar("Save does nothing");
    await clic(boton("No, I want to fix something"));
    const registro = contenedor.querySelector('[role="log"]')!;
    expect(registro.querySelector("strong")).toBeNull();
    expect(registro.querySelector("li")).toBeNull();
    expect(registro.textContent).toContain("- step **one**\n- step two");
    expect(registro.textContent).toContain("What should change?");
  });
});

describe("P10 — hide and ignore the whole interface, trigger included (review 1, P3-2)", () => {
  it("`pickElement` recibe como `ignore` un contenedor que tiene el disparador Y el panel", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS() });
    await abrir(fn);
    const chat = chats[chats.length - 1]!;
    const espiar = vi.spyOn(chat, "pickElement").mockResolvedValue("cancelled");
    await clic(boton(/pick an element/i));
    const ignorado = espiar.mock.calls[0]![0]!.ignore as Element;
    expect(ignorado.contains(boton("Help")!)).toBe(true);
    expect(ignorado.contains(contenedor.querySelector("section"))).toBe(true);
  });

  it("al capturar la pantalla se oculta todo con `display: none` (le gana a la clase de la app) y se vuelve a mostrar", async () => {
    const { fn } = fetchGuionado({ "/api/chat/estado": ESTADOS() });
    await abrir(fn);
    const chat = chats[chats.length - 1]!;
    vi.spyOn(chat, "canCaptureScreen").mockReturnValue(true);
    let oculto = "";
    vi.spyOn(chat, "attachScreenshot").mockImplementation(async (o) => {
      o?.hideUi?.();
      oculto = (boton("Help")!.parentElement as HTMLElement).style.display + "|" + (boton("Help")!.parentElement as HTMLElement).hidden;
      o?.showUi?.();
      return "ok";
    });
    await escribirSinMandar("x"); // vuelve a dibujar el panel y aparece el botón de captura
    await clic(boton("Take a screenshot"));
    expect(oculto.startsWith("none")).toBe(true);
    expect((boton("Help")!.parentElement as HTMLElement).style.display).toBe("");
  });
});

describe("StrictMode", () => {
  it("en StrictMode (doble montaje) el ejemplo anda igual: un solo chat vivo y un mensaje sale UNA vez", async () => {
    const { fn, llamadas } = fetchGuionado({
      "/api/chat/estado": ESTADOS(),
      "/api/chat/sesion": [nd({ t: "sesion", id: "ses_A", indice: 0 }, { t: "usuario", texto: "hola" }, { t: "asistente", texto: "buen día" }, { t: "espera", indice: 3 })],
    });
    await abrir(fn, {}, true);
    await escribirYMandar("hola");
    expect(llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/api/chat/sesion")).toHaveLength(1);
    expect(texto()).toContain("buen día");
  });
});
