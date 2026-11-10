// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { montarChat } from "./montar";
import css from "./widget.css";

// Ningún test habla con un backend: `fetch` se simula por URL. `init` no lo usa la respuesta
// simulada, pero se declara para que `mock.calls` conserve el cuerpo de cada request: el test de
// evidencia lo lee para verificar qué viajó a cada endpoint.
function fetchPorUrl(rutas: Record<string, { status: number; cuerpo: string; tipo?: string }>) {
  return vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    void init;
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const clave = Object.keys(rutas).find((k) => url.includes(k));
    if (clave === undefined) throw new Error(`fetch inesperado: ${url}`);
    const r = rutas[clave];
    return new Response(r.cuerpo, { status: r.status, headers: { "content-type": r.tipo ?? "application/json" } });
  });
}
const ESTADO_OK = { "/api/chat/estado": { status: 200, cuerpo: JSON.stringify({ ok: true, motivo: null }) } };

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; sessionStorage.clear(); document.getElementById("supcoflow-chat-selector")?.remove(); });
async function esperarRender(): Promise<void> { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); }

describe("montarChat", () => {
  it("con estado ok dibuja la burbuja dentro de un shadow root con las variables del tema", async () => {
    vi.stubGlobal("fetch", fetchPorUrl(ESTADO_OK));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    const diag = vi.fn();
    const { desmontar } = montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", tema: { acento: "#f00" }, onDiagnostico: diag });
    await esperarRender();
    const host = cont.firstElementChild as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    expect(host.getAttribute("style")).toContain("--scf-acento:#f00");
    expect(host.shadowRoot!.querySelector("style")?.textContent).toContain(".scf-burbuja");
    expect(host.shadowRoot!.querySelector(".scf-burbuja")).not.toBeNull();
    expect(host.shadowRoot!.querySelector(".scf-panel")).toBeNull(); // cerrado hasta el clic
    expect(diag).toHaveBeenCalledWith({ visible: true, status: 200, motivo: null });
    desmontar();
    expect(cont.firstElementChild).toBeNull();
  });

  it("con 403 no dibuja NADA y avisa el motivo al desarrollador", async () => {
    vi.stubGlobal("fetch", fetchPorUrl({ "/api/chat/estado": { status: 403, cuerpo: JSON.stringify({ ok: false, motivo: "chat_deshabilitado" }) } }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    const diag = vi.fn();
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", onDiagnostico: diag });
    await esperarRender();
    expect((cont.firstElementChild as HTMLElement).shadowRoot!.querySelector(".scf-burbuja")).toBeNull();
    expect(diag).toHaveBeenCalledWith({ visible: false, status: 403, motivo: "chat_deshabilitado" });
  });

  it("modo inline dibuja el panel directo, sin burbuja", async () => {
    vi.stubGlobal("fetch", fetchPorUrl(ESTADO_OK));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    expect(sr.querySelector(".scf-panel--inline")).not.toBeNull();
    expect(sr.querySelector(".scf-burbuja")).toBeNull();
  });

  it("con un cursor guardado, recupera la charla desde el stream y abre el panel con ella", async () => {
    sessionStorage.setItem("supcoflow-chat/t/p", JSON.stringify({ id: "s1", indice: 6 }));
    // `desde=0` y no `desde=6` (2.2.0, hallazgo 3): el replay reconstruye la charla completa, no
    // sólo desde el último índice consumido — ver el test dedicado más abajo.
    vi.stubGlobal("fetch", fetchPorUrl({
      ...ESTADO_OK,
      "/api/chat/sesion/s1/eventos?desde=0": {
        status: 200,
        tipo: "application/x-ndjson",
        cuerpo: '{"v":1,"t":"usuario","texto":"hola"}\n{"v":1,"t":"asistente","texto":"**Hola.**"}\n{"v":1,"t":"espera","indice":6}\n',
      },
    }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    const burbujas = [...sr.querySelectorAll(".scf-msg")].map((m) => m.textContent);
    expect(burbujas).toEqual(["hola", "Hola."]);
    expect(sr.querySelector(".scf-msg--asistente strong")?.textContent).toBe("Hola.");
    expect(sr.querySelector(".scf-indicador")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem("supcoflow-chat/t/p")!)).toEqual({ id: "s1", indice: 6 });
  });

  it("con el panel abierto dibuja las herramientas adentro de la caja del compositor; sin getDisplayMedia el menú NO ofrece capturar (§3.2), adjuntar imagen siempre", async () => {
    vi.stubGlobal("fetch", fetchPorUrl(ESTADO_OK));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    // 2.2.0: la fila `.scf-herramientas` de la 2.1.0 no existe más — las herramientas viven
    // adentro de `.scf-caja`, junto al textarea (ver el test de grupos/caja más abajo).
    expect(sr.querySelector(".scf-caja .scf-herramienta")).not.toBeNull();
    (sr.querySelector('button[aria-label="Attach"]') as HTMLButtonElement).click();
    await esperarRender();
    const items = [...sr.querySelectorAll(".scf-menu button")].map((b) => b.textContent);
    expect(items).toEqual(["Attach an image"]);
    expect(sr.querySelector('input[type="file"][accept="image/*"]')).not.toBeNull();
  });

  it("2.3.0 (T0.5): con `permite` del estado, el widget no ofrece lo que el acuerdo no deja", async () => {
    const herramientasCon = async (permite: unknown): Promise<string[]> => {
      vi.stubGlobal("fetch", fetchPorUrl({ "/api/chat/estado": { status: 200, cuerpo: JSON.stringify({ ok: true, motivo: null, permite }) } }));
      const cont = document.createElement("div");
      document.body.appendChild(cont);
      montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
      await esperarRender();
      const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
      const etiquetas = [...sr.querySelectorAll(".scf-herramienta")].map((b) => b.getAttribute("aria-label")!);
      if (sr.querySelector('input[type="file"]') !== null) etiquetas.push("input de archivo");
      return etiquetas;
    };
    expect(await herramientasCon(undefined)).toEqual(["Pick an element", "Attach", "input de archivo"]);
    expect(await herramientasCon({ capturas: false, elementos: true, pagina_y_navegador: true })).toEqual(["Pick an element"]);
    expect(await herramientasCon({ capturas: true, elementos: false, pagina_y_navegador: true })).toEqual(["Attach", "input de archivo"]);
    expect(await herramientasCon({ capturas: false, elementos: false, pagina_y_navegador: true })).toEqual([]);
  });

  it("señalar pliega el panel e inyecta el overlay en la PÁGINA; Esc lo saca y el panel vuelve", async () => {
    vi.stubGlobal("fetch", fetchPorUrl(ESTADO_OK));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    (sr.querySelector('button[aria-label="Pick an element"]') as HTMLButtonElement).click();
    await esperarRender();
    expect(document.getElementById("supcoflow-chat-selector")).not.toBeNull();
    expect(document.getElementById("supcoflow-chat-selector")!.getRootNode()).toBe(document); // fuera del shadow root
    expect(sr.querySelector(".scf-panel")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await esperarRender();
    expect(document.getElementById("supcoflow-chat-selector")).toBeNull();
    expect(sr.querySelector(".scf-panel")).not.toBeNull();
  });

  it("evidencia: el elemento señalado sube CRUDO a /api/evidencias; /api/chat/sesion sólo recibe un resumen corto, nunca el HTML ni el id de evidencia (PR 3, hallazgo 3)", async () => {
    const fetchMock = fetchPorUrl({
      ...ESTADO_OK,
      "/api/evidencias": { status: 201, cuerpo: JSON.stringify({ ok: true, evidencia_id: "evd_secreto" }) },
      "/api/chat/sesion": { status: 200, tipo: "application/x-ndjson", cuerpo: '{"v":1,"t":"sesion","id":"s1","indice":0}\n{"v":1,"t":"espera","indice":1}\n' },
    });
    vi.stubGlobal("fetch", fetchMock);

    // El elemento de la PÁGINA (no del widget) que el usuario va a señalar.
    const objetivo = document.createElement("button");
    objetivo.className = "guardar";
    objetivo.textContent = "Guardar";
    document.body.appendChild(objetivo);

    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;

    // Señalar: mismo patrón que Task 6 (selector-de-elementos.test.ts) y el test de Esc de arriba.
    (sr.querySelector('button[aria-label="Pick an element"]') as HTMLButtonElement).click();
    await esperarRender();
    document.elementFromPoint = () => objetivo;
    const overlay = document.getElementById("supcoflow-chat-selector")!;
    overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await esperarRender();
    expect(document.getElementById("supcoflow-chat-selector")).toBeNull(); // overlay se fue, panel vuelve

    // Enviar un mensaje: abre la sesión y, con el cursor, sube el adjunto que quedó pendiente.
    const textarea = sr.querySelector(".scf-textarea") as HTMLTextAreaElement;
    textarea.value = "el botón guardar no hace nada";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await esperarRender();
    (sr.querySelector(".scf-enviar") as HTMLButtonElement).click();
    await esperarRender();
    await esperarRender(); // la subida del adjunto espera al cursor de la sesión y hace su propio fetch

    const llamadas = fetchMock.mock.calls.map(([entrada, init]) => ({
      url: typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : (entrada as Request).url,
      cuerpo: (init as RequestInit | undefined)?.body as string | undefined,
    }));

    const aEvidencias = llamadas.find((l) => l.url.includes("/api/evidencias"));
    expect(aEvidencias?.cuerpo).toBeDefined();
    const cuerpoEvidencia = JSON.parse(aEvidencias!.cuerpo!);
    expect(cuerpoEvidencia.evidencia.tipo).toBe("elemento");
    expect(cuerpoEvidencia.evidencia.contenido.target.tagName).toBe("button"); // el ElementoSeleccionado crudo

    const aSesion = llamadas.find((l) => l.url.includes("/api/chat/sesion") && !l.url.includes("/eventos"));
    expect(aSesion?.cuerpo).toBeDefined();
    const cuerpoSesion = JSON.parse(aSesion!.cuerpo!);
    // 2.3.0 (T0.6): tres claves planas de texto corto, una por permiso; el string `evidencia` ya no viaja.
    expect(cuerpoSesion.contexto).not.toHaveProperty("evidencia");
    expect(typeof cuerpoSesion.contexto.evidencia_elemento).toBe("string");
    expect(cuerpoSesion.contexto.evidencia_elemento).toContain("<button>");
    expect(cuerpoSesion.contexto.evidencia_elemento).not.toContain("http");
    expect(typeof cuerpoSesion.contexto.evidencia_elemento_pagina).toBe("string");
    const crudo = JSON.stringify(cuerpoSesion);
    expect(crudo).not.toContain("evd_secreto"); // nunca el id de evidencia
    expect(crudo).not.toMatch(/<button class=/); // nunca el HTML del elemento
    expect(crudo).not.toContain("base64");
  });

  it("sin projectId lanza en el montaje, antes de tocar el DOM", () => {
    const cont = document.createElement("div");
    expect(() => montarChat(cont, { tenantId: "t", projectId: "" })).toThrow(/projectId/);
    expect(cont.firstElementChild).toBeNull();
  });

  it("marca: /api/chat/estado trae la marca y el widget se pinta con ella DEBAJO del código — título y logo del motor, acento del código, fondo de la marca (§3.3)", async () => {
    vi.stubGlobal("fetch", fetchPorUrl({
      "/api/chat/estado": { status: 200, cuerpo: JSON.stringify({ ok: true, motivo: null, marca: { logo_url: "https://blob.test/logo.png", titulo: "Example support", saludo: "¿En qué te ayudamos?", tema: { acento: "#0a0", fondo: "#fafafa" } } }) },
    }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline", tema: { acento: "#f00" } });
    await esperarRender();
    const host = cont.firstElementChild as HTMLElement;
    expect(host.getAttribute("style")).toContain("--scf-acento:#f00");
    expect(host.getAttribute("style")).toContain("--scf-fondo:#fafafa");
    const sr = host.shadowRoot!;
    // 2.2.0: sin sesión el panel arranca en la pantalla de inicio (`sinTitulo`) — el título del
    // motor sigue en el `aria-label` del panel, y el logo en el avatar del saludo, no en `.scf-cabecera`.
    expect(sr.querySelector(".scf-panel")?.getAttribute("aria-label")).toBe("Example support");
    expect((sr.querySelector(".scf-avatar img") as HTMLImageElement).src).toBe("https://blob.test/logo.png");
    expect(sr.querySelector(".scf-rotulo")).toBeNull(); // sin previewToken no hay rótulo
  });

  it("preview: el token va en el header de estado y de la sesión, la cabecera lleva el rótulo, y las herramientas de evidencia no se dibujan (§2, §5.3)", async () => {
    const fetchMock = fetchPorUrl({
      ...ESTADO_OK,
      "/api/chat/sesion": { status: 200, tipo: "application/x-ndjson", cuerpo: '{"v":1,"t":"sesion","id":"s1","indice":0}\n{"v":1,"t":"espera","indice":1}\n' },
    });
    vi.stubGlobal("fetch", fetchMock);
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline", previewToken: "v1.t.p.9.f" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    expect(sr.querySelector(".scf-rotulo")?.textContent).toBe("Preview");
    expect(sr.querySelector(".scf-herramienta")).toBeNull();
    expect(sr.querySelector(".scf-adjuntos")).toBeNull();

    const textarea = sr.querySelector(".scf-textarea") as HTMLTextAreaElement;
    textarea.value = "hola";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await esperarRender();
    (sr.querySelector(".scf-enviar") as HTMLButtonElement).click();
    await esperarRender();

    const headersDe = (fragmento: string) => {
      const llamada = fetchMock.mock.calls.find(([e]) => (typeof e === "string" ? e : e instanceof URL ? e.href : (e as Request).url).includes(fragmento));
      return new Headers((llamada?.[1] as RequestInit | undefined)?.headers);
    };
    expect(headersDe("/api/chat/estado").get("x-supcoflow-preview")).toBe("v1.t.p.9.f");
    expect(headersDe("/api/chat/sesion").get("x-supcoflow-preview")).toBe("v1.t.p.9.f");
  });

  // T7: el widget es una interfaz más y declara lo que DIBUJA de verdad (lo que el acuerdo deja y el modo permite), con el mismo encabezado que el núcleo.
  it("T7: el widget declara en `x-supcoflow-capabilities` lo que dibuja: sin captura de pantalla en este navegador, y menos si el acuerdo o el preview lo quitan", async () => {
    const declaradoCon = async (permite: unknown, extra: { previewToken?: string } = {}): Promise<string | null> => {
      const fetchMock = fetchPorUrl({
        "/api/chat/estado": { status: 200, cuerpo: JSON.stringify({ ok: true, motivo: null, ...(permite === undefined ? {} : { permite }) }) },
        "/api/chat/sesion": { status: 200, tipo: "application/x-ndjson", cuerpo: '{"v":1,"t":"sesion","id":"s1","indice":0}\n{"v":1,"t":"espera","indice":1}\n' },
      });
      vi.stubGlobal("fetch", fetchMock);
      const cont = document.createElement("div");
      document.body.appendChild(cont);
      montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline", ...extra });
      await esperarRender();
      const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
      const textarea = sr.querySelector(".scf-textarea") as HTMLTextAreaElement;
      textarea.value = "hola";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await esperarRender();
      (sr.querySelector(".scf-enviar") as HTMLButtonElement).click();
      await esperarRender();
      const llamada = fetchMock.mock.calls.find(([e]) => (typeof e === "string" ? e : e instanceof URL ? e.href : (e as Request).url).includes("/api/chat/sesion"));
      return new Headers((llamada?.[1] as RequestInit | undefined)?.headers).get("x-supcoflow-capabilities");
    };
    expect(await declaradoCon(undefined)).toBe("pickElement,attachImage,newConversation"); // happy-dom no captura pantalla: la captura no se declara
    expect(await declaradoCon({ capturas: false, elementos: true, pagina_y_navegador: true })).toBe("pickElement,newConversation");
    expect(await declaradoCon({ capturas: true, elementos: false, pagina_y_navegador: true })).toBe("attachImage,newConversation");
    expect(await declaradoCon({ capturas: false, elementos: false, pagina_y_navegador: true })).toBe("newConversation");
    expect(await declaradoCon(undefined, { previewToken: "v1.t.p.9.f" })).toBe("newConversation"); // el preview no dibuja ninguna herramienta de evidencia
  });

  it("usuario: id, rol y atributos viajan planos en el contexto del primer mensaje; el nombre no existe (§4)", async () => {
    const fetchMock = fetchPorUrl({
      ...ESTADO_OK,
      "/api/chat/sesion": { status: 200, tipo: "application/x-ndjson", cuerpo: '{"v":1,"t":"sesion","id":"s1","indice":0}\n{"v":1,"t":"espera","indice":1}\n' },
    });
    vi.stubGlobal("fetch", fetchMock);
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline", usuario: { id: "u_123", rol: "admin", atributos: { plan: "pro" }, nombre: "Ana" } as unknown as { id: string } });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    const textarea = sr.querySelector(".scf-textarea") as HTMLTextAreaElement;
    textarea.value = "no me deja guardar";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await esperarRender();
    (sr.querySelector(".scf-enviar") as HTMLButtonElement).click();
    await esperarRender();
    // Misma lectura de `mock.calls` que el test de evidencia de más arriba.
    const llamadas = fetchMock.mock.calls.map(([entrada, init]) => ({
      url: typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : (entrada as Request).url,
      cuerpo: (init as RequestInit | undefined)?.body as string | undefined,
    }));
    const aSesion = llamadas.find((l) => l.url.includes("/api/chat/sesion"));
    const cuerpo = JSON.parse(aSesion!.cuerpo!);
    expect(cuerpo.contexto).toMatchObject({ usr_id: "u_123", usr_rol: "admin", usr_attr_plan: "pro" });
    expect(JSON.stringify(cuerpo)).not.toContain("Ana");
    expect(JSON.stringify(cuerpo)).not.toContain("nombre");
  });

  it("2.2.0 (hallazgo 3): con cursor guardado rebobina desde CERO, no desde el índice del cursor — si no, la lista queda vacía y el agente sigue con memoria", async () => {
    sessionStorage.setItem("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 6 }));
    const historia = [
      { v: 1, t: "usuario", texto: "hola" },
      { v: 1, t: "asistente", texto: "Hola." },
      { v: 1, t: "espera", indice: 6 },
    ].map((e) => JSON.stringify(e)).join("\n");
    const fetchFalso = fetchPorUrl({ ...ESTADO_OK, "/api/chat/sesion/s1/eventos": { status: 200, cuerpo: historia, tipo: "application/x-ndjson" } });
    vi.stubGlobal("fetch", fetchFalso);
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test" });
    await esperarRender();
    await esperarRender();
    const urls = fetchFalso.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/chat/sesion/s1/eventos?desde=0"))).toBe(true);
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    expect(shadow.textContent).toContain("Hola.");
  });

  it("2.3.0 (T0.3): los desenlaces se dibujan con textos fijos del widget — la tarjeta con el id del reporte y el chip de la respuesta", async () => {
    sessionStorage.setItem("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 9 }));
    const historia = [
      { v: 1, t: "usuario", texto: "the save button does nothing" },
      { v: 1, t: "asistente", texto: "Sent." },
      { v: 1, t: "desenlace", que: "reportado", reporte: "rep_0123456789abcdef" },
      { v: 1, t: "usuario", texto: "and how do I export?" },
      { v: 1, t: "asistente", texto: "Go to Settings." },
      { v: 1, t: "desenlace", que: "respondida" },
      { v: 1, t: "espera", indice: 9 },
    ].map((e) => JSON.stringify(e)).join("\n");
    vi.stubGlobal("fetch", fetchPorUrl({ ...ESTADO_OK, "/api/chat/sesion/s1/eventos": { status: 200, cuerpo: historia, tipo: "application/x-ndjson" } }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test" });
    await esperarRender();
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    const tarjeta = shadow.querySelector(".scf-desenlace--reportado")!;
    expect(tarjeta.textContent).toContain("Report sent.");
    expect(tarjeta.textContent).toContain("Report rep_0123456789abcdef");
    expect(shadow.querySelector(".scf-desenlace--respondida")!.textContent).toBe("Answered · no issue");
  });

  it("los pasos reales se dibujan como una línea de texto fijo sobre la respuesta que sigue, sobreviven a la recarga y no suman burbujas", async () => {
    sessionStorage.setItem("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 9 }));
    const historia = [
      { v: 1, t: "usuario", texto: "where do I change the billing email?" },
      { v: 1, t: "actividad", que: "leyendo_la_guia" },
      { v: 1, t: "paso", que: "guia_leida", seccion: "Billing" },
      { v: 1, t: "asistente", texto: "Go to Settings → Billing." },
      { v: 1, t: "usuario", texto: "the save button does nothing" },
      { v: 1, t: "paso", que: "resumen_preparado" },
      { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "This is what I'll send to the team", opciones: [{ id: "approve", label: "Yes, report it", style: "primary" }], libre: false },
      { v: 1, t: "espera", indice: 9 },
    ].map((e) => JSON.stringify(e)).join("\n");
    vi.stubGlobal("fetch", fetchPorUrl({ ...ESTADO_OK, "/api/chat/sesion/s1/eventos": { status: 200, cuerpo: historia, tipo: "application/x-ndjson" } }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test" });
    await esperarRender();
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    expect([...shadow.querySelectorAll(".scf-paso")].map((p) => p.textContent?.trim())).toEqual(["Read the guide · Billing", "Summarized the report"]);
    // La línea va justo ANTES de la burbuja a la que pertenece, y los pasos no son burbujas.
    const burbujas = [...shadow.querySelectorAll(".scf-msg")].map((m) => m.textContent);
    expect(burbujas).toEqual(["where do I change the billing email?", "Go to Settings → Billing.", "the save button does nothing", "This is what I'll send to the team"]);
    expect(shadow.querySelector(".scf-pasos + .scf-msg")?.textContent).toBe("Go to Settings → Billing.");
    // Nada de jerga interna.
    expect(shadow.textContent).not.toMatch(/orientar|clasificar|resolver|reportar|guia_leida/);
    expect(shadow.querySelector(".scf-indicador")).toBeNull();
  });

  it("2.2.0: onEvento recibe `enviado` con el texto y el contexto ANTES de los eventos del stream", async () => {
    const stream = [{ v: 1, t: "sesion", id: "s9", indice: 0 }, { v: 1, t: "usuario", texto: "hola" }, { v: 1, t: "espera", indice: 2 }].map((e) => JSON.stringify(e)).join("\n");
    vi.stubGlobal("fetch", fetchPorUrl({ ...ESTADO_OK, "/api/chat/sesion": { status: 200, cuerpo: stream, tipo: "application/x-ndjson" } }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    const eventos: unknown[] = [];
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", modo: "inline", contextoAutomatico: false, onEvento: (e) => eventos.push(e) });
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    const ta = shadow.querySelector<HTMLTextAreaElement>(".scf-textarea")!;
    ta.value = "hola";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    // Un tick de render entre el `input` y el `submit`: sin él, el `onSubmit` del compositor sigue
    // siendo el de ANTES del tipeo (preact re-renderiza en microtask) y `enviar` lee `entrada` vacía.
    await esperarRender();
    shadow.querySelector("form.scf-compositor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await esperarRender();
    await esperarRender();
    expect(eventos[0]).toEqual({ t: "enviado", texto: "hola", contexto: undefined });
    expect((eventos[1] as { t: string }).t).toBe("sesion");
  });

  it("2.2.0: sin sesión guardada se dibuja la pantalla de inicio con el saludo de la marca y «Hola {nombre}»", async () => {
    vi.stubGlobal("fetch", fetchPorUrl({ "/api/chat/estado": { status: 200, cuerpo: JSON.stringify({ ok: true, motivo: null, marca: { titulo: "Ayuda de Turnera", saludo: "¿En qué te ayudamos con Turnera?" } }) } }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", modo: "inline", usuario: { nombre: "Ana" } });
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    expect(shadow.querySelector(".scf-inicio")).not.toBeNull();
    expect(shadow.textContent).toContain("Hi Ana");
    expect(shadow.textContent).toContain("¿En qué te ayudamos con Turnera?");
    expect(shadow.querySelectorAll(".scf-arranque")).toHaveLength(2);
    expect(shadow.querySelector(".scf-avatar")?.textContent).toBe("AT"); // sin logo: iniciales
    expect(shadow.textContent).toContain("Supcoflow"); // la atribución del pie
    expect(shadow.querySelector(".scf-mensajes")).toBeNull();
  });

  it("2.2.0: un arranque manda su texto como primer mensaje del usuario, por el mismo camino que escribir", async () => {
    const stream = [{ v: 1, t: "sesion", id: "s2", indice: 0 }, { v: 1, t: "usuario", texto: "I want to report a bug" }, { v: 1, t: "espera", indice: 2 }].map((e) => JSON.stringify(e)).join("\n");
    const fetchFalso = fetchPorUrl({ ...ESTADO_OK, "/api/chat/sesion": { status: 200, cuerpo: stream, tipo: "application/x-ndjson" } });
    vi.stubGlobal("fetch", fetchFalso);
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", modo: "inline", contextoAutomatico: false });
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    shadow.querySelector<HTMLButtonElement>(".scf-arranque")!.click();
    await esperarRender();
    await esperarRender();
    const post = fetchFalso.mock.calls.find((c) => String(c[0]).endsWith("/api/chat/sesion"));
    expect(JSON.parse(String(post![1]!.body))).toEqual({ mensaje: "I want to report a bug" });
    expect(shadow.querySelector(".scf-inicio")).toBeNull();
    expect(shadow.querySelector(".scf-mensajes")!.textContent).toContain("I want to report a bug");
  });

  it("2.2.0: `abierto: true` dibuja el panel al montar en modo burbuja", async () => {
    vi.stubGlobal("fetch", fetchPorUrl(ESTADO_OK));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", abierto: true });
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    expect(shadow.querySelector(".scf-panel")).not.toBeNull();
    expect(shadow.querySelector(".scf-burbuja")).not.toBeNull();
  });

  it("2.2.0: los mensajes van en grupos con avatar; las herramientas viven adentro de la caja del compositor; el estado de un adjunto es una clase, no un texto", async () => {
    sessionStorage.setItem("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 6 }));
    const historia = [
      { v: 1, t: "usuario", texto: "hola" },
      { v: 1, t: "asistente", texto: "Hola." },
      { v: 1, t: "asistente", texto: "¿Qué pasó?" },
      { v: 1, t: "espera", indice: 6 },
    ].map((e) => JSON.stringify(e)).join("\n");
    vi.stubGlobal("fetch", fetchPorUrl({ ...ESTADO_OK, "/api/chat/sesion/s1/eventos": { status: 200, cuerpo: historia, tipo: "application/x-ndjson" } }));
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", modo: "inline" });
    await esperarRender();
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    const grupos = shadow.querySelectorAll(".scf-grupo");
    expect(grupos).toHaveLength(2);
    expect(grupos[1]!.querySelectorAll(".scf-msg")).toHaveLength(2);
    expect(grupos[1]!.querySelector(".scf-avatar")).not.toBeNull();
    expect(grupos[0]!.querySelector(".scf-avatar")).toBeNull();
    expect(shadow.querySelector(".scf-caja .scf-herramienta")).not.toBeNull();
    expect(shadow.querySelector(".scf-caja .scf-enviar")).not.toBeNull();
    expect(shadow.querySelector(".scf-herramientas")).toBeNull(); // la fila de la 2.1.0 no existe más
  });

  it("hallazgo 2 (revisión final de la rama, 2026-09-11): el replay del montaje marca `ocupado` mientras está en vuelo, así que un envío en esa ventana no duplica la burbuja", async () => {
    sessionStorage.setItem("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 6 }));
    const historia = [
      { v: 1, t: "usuario", texto: "hola" },
      { v: 1, t: "asistente", texto: "Hola." },
      { v: 1, t: "espera", indice: 6 },
    ].map((e) => JSON.stringify(e)).join("\n");
    // A diferencia de `fetchPorUrl` (que resuelve sincrónico), acá el replay queda pendiente hasta
    // que el test lo libera: es la única forma de mirar el estado MIENTRAS el rebobinado sigue en vuelo.
    let liberarReplay: () => void = () => {};
    const fetchControlable = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.includes("/api/chat/estado")) return new Response(JSON.stringify({ ok: true, motivo: null }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/api/chat/sesion/s1/eventos")) {
        await new Promise<void>((resolve) => { liberarReplay = resolve; });
        return new Response(historia, { status: 200, headers: { "content-type": "application/x-ndjson" } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
    vi.stubGlobal("fetch", fetchControlable);
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test" });
    await esperarRender();
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;

    // Todavía en vuelo: el compositor está deshabilitado (`ocupado`) y el replay no puso nada todavía.
    // `:not(.scf-trabajando)` porque el indicador de "pensando" es TAMBIÉN un `.scf-msg`.
    expect((shadow.querySelector(".scf-caja .scf-enviar") as HTMLButtonElement).disabled).toBe(true);
    expect(shadow.querySelectorAll(".scf-msg:not(.scf-trabajando)")).toHaveLength(0);
    // Mientras el agente trabaja y todavía no escribió, el indicador lo dice con palabras (no tres puntos mudos).
    expect(shadow.querySelector(".scf-indicador .scf-trabajando")?.textContent).toBe("Thinking…");

    // Un intento de envío durante la ventana: `enviarTexto` lo descarta por `ocupado`, así que no
    // agrega el optimista ni pisa la charla que está por llegar (antes de este fix, acá se colaba).
    const textarea = shadow.querySelector(".scf-textarea") as HTMLTextAreaElement;
    textarea.value = "durante el replay";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await esperarRender();
    shadow.querySelector("form.scf-compositor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await esperarRender();
    expect(shadow.querySelectorAll(".scf-msg:not(.scf-trabajando)")).toHaveLength(0);

    liberarReplay();
    await esperarRender();
    await esperarRender();

    // El replay llega y es la única charla: sin burbuja duplicada del envío descartado, y el
    // widget vuelve a estar disponible (no se queda `ocupado` para siempre).
    expect([...shadow.querySelectorAll(".scf-msg:not(.scf-trabajando)")].map((m) => m.textContent)).toEqual(["hola", "Hola."]);
    expect(shadow.querySelector(".scf-indicador")).toBeNull();
    expect((shadow.querySelector(".scf-caja .scf-enviar") as HTMLButtonElement).disabled).toBe(false);
  });

  it("en inline, el alto lo pone el contenedor por `--scf-alto`, y sin ella sigue siendo 560", () => {
    // El CSS entra como texto (css.d.ts), así que se lee el archivo y no un layout: happy-dom no
    // resuelve la cascada dentro de un shadow root. Es un control de texto, como los guards de
    // cabina.css en el motor. Lo que cubre es que alguien vuelva a clavar el alto: el preview de
    // la consola (motor, 2026-09-12) lo estira a la columna entera con esta variable.
    const regla = css.match(/\.scf-panel--inline\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(regla).toMatch(/height:\s*var\(--scf-alto,\s*560px\)/);
  });

  it("T0.7: la tarjeta del reporte trae «New conversation»; al tocarlo se borra el cursor guardado y el próximo mensaje abre otra sesión", async () => {
    sessionStorage.setItem("supcoflow-chat/tnt_a/proj_b", JSON.stringify({ id: "s1", indice: 4 }));
    const historia = [
      { v: 1, t: "usuario", texto: "the save button does nothing" },
      { v: 1, t: "desenlace", que: "reportado", reporte: "rep_0123456789abcdef" },
      { v: 1, t: "espera", indice: 4 },
    ].map((e) => JSON.stringify(e)).join("\n");
    const abierta = [{ v: 1, t: "sesion", id: "s2", indice: 0 }, { v: 1, t: "usuario", texto: "another problem" }, { v: 1, t: "espera", indice: 2 }].map((e) => JSON.stringify(e)).join("\n");
    const fetchFalso = fetchPorUrl({ ...ESTADO_OK, "/api/chat/sesion/s1/eventos": { status: 200, cuerpo: historia, tipo: "application/x-ndjson" }, "/api/chat/sesion": { status: 200, cuerpo: abierta, tipo: "application/x-ndjson" } });
    vi.stubGlobal("fetch", fetchFalso);
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test" });
    await esperarRender();
    await esperarRender();
    const shadow = (cont.firstElementChild as HTMLElement).shadowRoot!;
    const boton = [...shadow.querySelectorAll(".scf-desenlace--reportado button")].find((b) => b.textContent === "New conversation") as HTMLButtonElement;
    expect(boton).toBeDefined();
    boton.click();
    await esperarRender();
    expect(sessionStorage.getItem("supcoflow-chat/tnt_a/proj_b")).toBeNull();
    // los mensajes siguen a la vista y el botón ya no está (no hay sesión que cerrar)
    expect(shadow.textContent).toContain("Report sent.");
    expect(shadow.querySelector(".scf-desenlace--reportado button")).toBeNull();
    // el próximo mensaje llama a ABRIR (POST /api/chat/sesion), no a seguir en s1
    const ta = shadow.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "another problem";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await esperarRender();
    (shadow.querySelector('button[aria-label="Send the message"]') as HTMLButtonElement).click();
    await esperarRender();
    const urls = fetchFalso.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/api/chat/sesion"))).toBe(true);
    expect(urls.some((u) => /\/api\/chat\/sesion\/s1$/.test(u))).toBe(false);
  });
  // 2.3.1: la prueba real en producción (Chrome headless) mostró que «Take a screenshot» ocultaba el chat ENTERO antes de pedir el permiso y
  // no volvía si el navegador no contestaba el diálogo. Ahora el chat sigue a la vista mientras el permiso está pendiente.
  it("2.3.1: «Take a screenshot» NO oculta el chat mientras el navegador espera el permiso de pantalla, y un segundo toque no abre otro diálogo", async () => {
    vi.stubGlobal("fetch", fetchPorUrl(ESTADO_OK));
    const getDisplayMedia = vi.fn(() => new Promise<MediaStream>(() => {})); // headless: nunca se resuelve
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getDisplayMedia } });
    const cont = document.createElement("div");
    document.body.appendChild(cont);
    montarChat(cont, { tenantId: "t", projectId: "p", backendUrl: "https://chat.test", modo: "inline" });
    await esperarRender();
    const sr = (cont.firstElementChild as HTMLElement).shadowRoot!;
    const abrirMenu = () => (sr.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).click();
    const tocarCaptura = async () => {
      abrirMenu();
      await esperarRender();
      const item = [...sr.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === "Take a screenshot") as HTMLButtonElement | undefined;
      expect(item, "el ítem «Take a screenshot» tiene que estar").toBeDefined();
      item!.click();
      await esperarRender();
    };
    await tocarCaptura();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(sr.querySelector(".scf-panel"), "el chat sigue a la vista con el permiso pendiente").not.toBeNull();
    await tocarCaptura();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  });
});
