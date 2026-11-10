// @vitest-environment happy-dom
import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoDelWidget } from "../protocolo";
import { alEnviar, alResponder, estadoInicial, reducir, type EstadoDelChat } from "../estado";
import { Mensajes } from "./Mensajes";

// El scroll de la lista de mensajes (informe «chat-respuesta-cortada», 2026-10-31): la respuesta llegaba entera pero quedaba ESCONDIDA bajo el borde del panel, porque la lista sólo
// bajaba sola si lo nuevo agregaba menos de 80 px y, desde chat-v10, el servidor manda el texto frase por frase (una frase larga, o la burbuja propia más «Thinking…», pasan de 80).
// La regla ahora: se decide si la persona estaba pegada al fondo ANTES de que cambie la lista, y después de cada cambio se baja si lo estaba; mandar un mensaje o apretar un botón de
// respuesta baja siempre; si la persona subió a leer, no se la arrastra.
//
// happy-dom no calcula layout (todo mide 0): se instala una geometría falsa y DETERMINISTA sobre `.scf-mensajes` — cada hijo ocupa 28 px + 20 por cada 32 caracteres + 14 de separación,
// el panel mide 300 px y `scrollTop` se acota como en un navegador y avisa con un evento `scroll` ASÍNCRONO, igual que él. La prueba en un navegador de verdad (widget compilado contra el
// banco de pruebas, historia larga, pregunta de 1 y de 2 renglones) está en el informe de la tarea.

let ALTO_DEL_PANEL = 300; // cambia en los tests del compositor que crece (el panel de la lista se achica)
const cont = document.createElement("div");
document.body.appendChild(cont);
const tick = () => new Promise((r) => setTimeout(r, 0));

const scrollTops = new WeakMap<Element, number>();
const esLista = (el: unknown): el is HTMLElement => el instanceof HTMLElement && el.classList.contains("scf-mensajes");
const altoDeLaLista = (el: HTMLElement): number => Array.from(el.children).reduce((suma, hijo) => suma + 28 + 20 * Math.ceil((hijo.textContent ?? "").length / 32) + 14, 16 + 8);

const originales = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
  scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop"),
};
// Un `ResizeObserver` que sólo avisa cuando el test lo dice: el alto del panel cambia SIN que Preact dibuje nada (el compositor ajusta su textarea en un efecto, después del de la lista).
const avisos: (() => void)[] = [];
class ResizeObserverFalso { constructor(cb: () => void) { avisos.push(cb); } observe(): void {} unobserve(): void {} disconnect(): void {} }
/** Cambia el alto del panel como lo hace el navegador al crecer el cuadro de escribir: no mueve `scrollTop`, no dibuja, y recién después avisa el observador. */
const cambiarAltoDelPanel = (alto: number): void => { ALTO_DEL_PANEL = alto; avisos.forEach((f) => f()); };
beforeEach(() => {
  ALTO_DEL_PANEL = 300;
  avisos.length = 0;
  vi.stubGlobal("ResizeObserver", ResizeObserverFalso);
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get(this: Element) { return esLista(this) ? altoDeLaLista(this) : (originales.scrollHeight?.get?.call(this) ?? 0); } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get(this: Element) { return esLista(this) ? ALTO_DEL_PANEL : (originales.clientHeight?.get?.call(this) ?? 0); } });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) { return esLista(this) ? Math.min(scrollTops.get(this) ?? 0, Math.max(0, altoDeLaLista(this) - ALTO_DEL_PANEL)) : (originales.scrollTop?.get?.call(this) ?? 0); },
    set(this: Element, v: number) {
      if (!esLista(this)) { originales.scrollTop?.set?.call(this, v); return; }
      scrollTops.set(this, Math.max(0, Math.min(v, Math.max(0, altoDeLaLista(this) - ALTO_DEL_PANEL))));
      setTimeout(() => this.dispatchEvent(new Event("scroll")), 0); // como el navegador: el evento llega DESPUÉS
    },
  });
});
afterEach(() => {
  render(null, cont);
  for (const k of ["scrollHeight", "clientHeight", "scrollTop"] as const) {
    const o = originales[k];
    if (o !== undefined) Object.defineProperty(HTMLElement.prototype, k, o);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const aplicar = (e: EstadoDelChat, ...eventos: EventoDelWidget[]): EstadoDelChat => eventos.reduce((x, ev) => reducir(x, ev), e);
const lista = (): HTMLElement => cont.querySelector<HTMLElement>(".scf-mensajes")!;
/** Lo que queda escondido bajo el borde de abajo del panel, en px (lo mismo que midió el informe: `scrollHeight − scrollTop − clientHeight`). */
const escondido = (): number => lista().scrollHeight - lista().scrollTop - lista().clientHeight;

interface Gancho { onResponder: (r: unknown) => void; onReintentar: () => void }
function dibujar(estado: EstadoDelChat, g: Partial<Gancho> = {}): void {
  render(h(Mensajes, { estado, titulo: "Ayuda", logoUrl: null, onReintentar: g.onReintentar ?? (() => {}), onResponder: (g.onResponder as never) ?? (() => {}), onNuevaConversacion: () => {} }), cont);
}

const LARGO = Array.from({ length: 9 }, (_, i) => `Este es el párrafo ${i + 1} de una respuesta anterior larga, para que el panel ya tenga historia arriba.`).join("\n\n");
const P1 = "Estás en la página principal. ";
const P2 = "Desde acá podés ver todas tus reservas con su fecha y su estado, crear una reserva nueva eligiendo el día y la hora, y cancelar o cambiar cualquiera de las que ya tenés sin tener que llamar a nadie. ";
const P3 = "¿Querés que te explique alguna de esas cosas paso a paso?";
const historiaLarga = (): EstadoDelChat => aplicar(estadoInicial(null), { v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "hola" }, { v: 1, t: "asistente", texto: LARGO }, { v: 1, t: "espera", indice: 5 });

describe("la lista sigue al final de la charla", () => {
  it("la geometría falsa se parece a un panel: con historia larga hay contenido de sobra para desplazar", () => {
    dibujar(historiaLarga());
    expect(lista().scrollHeight).toBeGreaterThan(ALTO_DEL_PANEL * 2);
  });

  it("una charla recuperada se ve desde el final, sin que nadie haya hecho scroll", () => {
    dibujar(historiaLarga());
    expect(escondido()).toBe(0);
    expect(lista().scrollTop).toBeGreaterThan(0);
  });

  // Los dos largos de la pregunta del informe: 1 renglón (25 caracteres) y 2 (49).
  for (const pregunta of ["¿qué puedo hacer acá?....", "¿en qué página estoy y qué puedo hacer acá?"]) {
    it(`pregunta de ${pregunta.length} caracteres con la respuesta por frases: termina con 0 px escondidos, y también a mitad de camino`, async () => {
      dibujar(historiaLarga());
      await tick();
      // La persona manda: la burbuja propia más «Thinking…» juntas pasan los 80 px que la regla vieja toleraba.
      let e = alEnviar(historiaLarga(), pregunta);
      dibujar(e);
      expect(escondido()).toBe(0);
      await tick();
      // El servidor confirma la pregunta y suelta la respuesta frase por frase: la segunda llega de golpe y es larga.
      const pasos: EventoDelWidget[] = [
        { v: 1, t: "usuario", texto: pregunta },
        { v: 1, t: "texto", delta: P1 },
        { v: 1, t: "texto", delta: P2 },
        { v: 1, t: "asistente", texto: P1 + P2 + P3 },
        { v: 1, t: "espera", indice: 20 },
      ];
      for (const ev of pasos) {
        e = aplicar(e, ev);
        dibujar(e);
        expect(escondido(), `tras «${ev.t}»`).toBe(0);
        await tick();
        expect(escondido(), `tras «${ev.t}» y el evento scroll`).toBe(0);
      }
    });
  }

  it("una lista de golpe (la respuesta entera de una vez) también se sigue", async () => {
    let e = alEnviar(historiaLarga(), "¿cómo cancelo una reserva?");
    dibujar(e);
    await tick();
    e = aplicar(e, { v: 1, t: "usuario", texto: "¿cómo cancelo una reserva?" }, { v: 1, t: "asistente", texto: Array.from({ length: 12 }, (_, i) => `${i + 1}. Un paso largo de la lista, con su explicación completa.`).join("\n") }, { v: 1, t: "espera", indice: 9 });
    dibujar(e);
    expect(escondido()).toBe(0);
  });

  it("un error al pie también queda a la vista", async () => {
    let e = alEnviar(historiaLarga(), "hola otra vez");
    dibujar(e);
    await tick();
    e = { ...e, ocupado: false, error: { codigo: "red", mensaje: "x", terminal: false } };
    dibujar(e);
    expect(escondido()).toBe(0);
  });
});

describe("si la persona subió a leer, no se la arrastra", () => {
  async function subida(): Promise<EstadoDelChat> {
    const e = alEnviar(historiaLarga(), "¿qué puedo hacer acá?");
    dibujar(e);
    await tick();
    lista().scrollTop = 0; // subió al principio de la charla
    await tick(); // llega el evento scroll
    expect(escondido()).toBeGreaterThan(ALTO_DEL_PANEL);
    return e;
  }

  it("llega texto nuevo, frase larga o corta: la lista se queda donde estaba", async () => {
    let e = await subida();
    for (const ev of [{ v: 1, t: "usuario", texto: "¿qué puedo hacer acá?" }, { v: 1, t: "texto", delta: P1 }, { v: 1, t: "texto", delta: P2 }, { v: 1, t: "asistente", texto: P1 + P2 + P3 }, { v: 1, t: "espera", indice: 20 }] as EventoDelWidget[]) {
      e = aplicar(e, ev);
      dibujar(e);
      await tick();
      expect(lista().scrollTop, `tras «${ev.t}»`).toBe(0);
    }
  });

  it("si vuelve al fondo con la mano, la lista lo vuelve a seguir", async () => {
    let e = await subida();
    lista().scrollTop = lista().scrollHeight; // baja hasta el fondo
    await tick();
    expect(escondido()).toBe(0);
    e = aplicar(e, { v: 1, t: "usuario", texto: "¿qué puedo hacer acá?" }, { v: 1, t: "texto", delta: P1 }, { v: 1, t: "texto", delta: P2 });
    dibujar(e);
    expect(escondido()).toBe(0);
  });

  it("si vuelve a bajar y queda a unos pocos píxeles del fondo (subpíxeles, un renglón a medias), cuenta como pegada", async () => {
    const e = aplicar(alEnviar(historiaLarga(), "x"), { v: 1, t: "usuario", texto: "x" });
    dibujar(e);
    await tick();
    lista().scrollTop = 0;
    await tick();
    lista().scrollTop = lista().scrollHeight - ALTO_DEL_PANEL - 10;
    await tick();
    dibujar(aplicar(e, { v: 1, t: "texto", delta: P2 }));
    expect(escondido()).toBe(0);
  });

  // Revisión 2, P2-1: cada `scroll` sólo veía una bajada de 1 px respecto del anterior y la referencia seguía CADA bajada, así que un arrastre lento (dedo, trackpad) nunca sumaba.
  it("subir de a 1 px por evento, 25 veces, despega la lista", async () => {
    const e = aplicar(alEnviar(historiaLarga(), "x"), { v: 1, t: "usuario", texto: "x" });
    dibujar(e);
    await tick();
    for (let i = 0; i < 25; i++) { lista().scrollTop = lista().scrollTop - 1; await tick(); }
    const antes = lista().scrollTop;
    dibujar(aplicar(e, { v: 1, t: "texto", delta: P2 }));
    expect(lista().scrollTop).toBe(antes);
    expect(escondido()).toBeGreaterThan(0);
  });

  it("un movimiento de medio píxel (redondeo del navegador) no la despega", async () => {
    const e = aplicar(alEnviar(historiaLarga(), "x"), { v: 1, t: "usuario", texto: "x" });
    dibujar(e);
    await tick();
    lista().scrollTop = lista().scrollTop - 0.5;
    await tick();
    dibujar(aplicar(e, { v: 1, t: "texto", delta: P2 }));
    expect(escondido()).toBe(0);
  });

  it("MANDAR un mensaje baja siempre al fondo, aunque estuviera leyendo arriba, y sigue la respuesta", async () => {
    let e = historiaLarga();
    dibujar(e);
    await tick();
    lista().scrollTop = 0;
    await tick();
    expect(escondido()).toBeGreaterThan(ALTO_DEL_PANEL);
    e = alEnviar(e, "otra pregunta");
    dibujar(e);
    expect(escondido()).toBe(0);
    await tick();
    e = aplicar(e, { v: 1, t: "usuario", texto: "otra pregunta" }, { v: 1, t: "texto", delta: P2 });
    dibujar(e);
    expect(escondido()).toBe(0);
  });

  it("APRETAR un botón de respuesta baja siempre al fondo", async () => {
    const respuestas: unknown[] = [];
    let e = aplicar(historiaLarga(), { v: 1, t: "pregunta", requestId: "r1", kind: "question", prompt: "¿Querés que lo reporte?", libre: false, opciones: [{ id: "si", label: "Sí, reportar", style: "primary" }, { id: "no", label: "No", style: "default" }] }, { v: 1, t: "espera", indice: 9 });
    dibujar(e, { onResponder: (r) => respuestas.push(r) });
    await tick();
    lista().scrollTop = 0; // estaba leyendo arriba
    await tick();
    expect(escondido()).toBeGreaterThan(ALTO_DEL_PANEL);
    cont.querySelector<HTMLButtonElement>(".scf-opcion")!.click();
    expect(respuestas).toEqual([{ requestId: "r1", optionId: "si" }]);
    // El controlador marca el pedido en curso y la etiqueta elegida llega como turno del usuario.
    e = alResponder(e);
    dibujar(e, { onResponder: (r) => respuestas.push(r) });
    expect(escondido()).toBe(0);
    await tick();
    e = aplicar(e, { v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "answered", optionId: "si" }, { v: 1, t: "texto", delta: P2 });
    dibujar(e);
    expect(escondido()).toBe(0);
  });

  it("«Retry» también baja al fondo", async () => {
    let e = { ...alEnviar(historiaLarga(), "hola"), ocupado: false, error: { codigo: "red", mensaje: "x", terminal: false } } as EstadoDelChat;
    const reintentos: number[] = [];
    dibujar(e, { onReintentar: () => reintentos.push(1) });
    await tick();
    lista().scrollTop = 0;
    await tick();
    cont.querySelector<HTMLButtonElement>(".scf-error button")!.click();
    expect(reintentos).toHaveLength(1);
    e = { ...e, ocupado: true, error: null };
    dibujar(e);
    expect(escondido()).toBe(0);
  });
});

// Revisión 1, P2-1 (2026-10-31): un cambio de alto del panel que NO viene de la persona (el cuadro de escribir que crece, el teclado del celular, la ventana) no despega la lista,
// aunque el navegador dispare su propio `scroll` al reacomodar; y la lista sigue el cambio sin esperar al próximo dibujo.
describe("el panel cambia de alto sin que la persona toque la lista", () => {
  async function alFondo(): Promise<EstadoDelChat> {
    const e = aplicar(alEnviar(historiaLarga(), "pregunta"), { v: 1, t: "usuario", texto: "pregunta" });
    dibujar(e);
    await tick();
    expect(escondido()).toBe(0);
    return e;
  }

  it("el cuadro de escribir crece: la lista queda al fondo en cuanto avisa el observador, sin otro dibujo ni otra tecla", async () => {
    await alFondo();
    cambiarAltoDelPanel(ALTO_DEL_PANEL - 60); // tres renglones de golpe (un pegado)
    expect(escondido()).toBe(0);
  });

  it("el navegador dispara su `scroll` al reacomodar (el panel ya achicado, scrollTop sin moverse): sigue pegada y la respuesta que llega se ve entera", async () => {
    let e = await alFondo();
    ALTO_DEL_PANEL -= 60; // el navegador achica la lista…
    lista().dispatchEvent(new Event("scroll")); // …y avisa con un scroll propio ANTES de que nadie la vuelva a bajar: dist = 60 > margen
    await tick();
    e = aplicar(e, { v: 1, t: "texto", delta: P1 }, { v: 1, t: "texto", delta: P2 });
    dibujar(e);
    expect(escondido()).toBe(0);
  });

  it("el panel se achica Y la persona nunca subió: tras varios cambios de alto seguidos sigue al fondo", async () => {
    await alFondo();
    for (const alto of [260, 220, 180, 300]) {
      cambiarAltoDelPanel(alto);
      lista().dispatchEvent(new Event("scroll"));
      await tick();
      expect(escondido(), `alto ${alto}`).toBe(0);
    }
  });

  it("si la persona SUBIÓ a leer, un cambio de alto del panel no la baja", async () => {
    await alFondo();
    lista().scrollTop = 0;
    await tick();
    cambiarAltoDelPanel(ALTO_DEL_PANEL - 60);
    await tick();
    expect(lista().scrollTop).toBe(0);
  });

  it("subir apenas, menos que el margen, también despega la lista (un dedo que arrastra despacio)", async () => {
    let e = await alFondo();
    lista().scrollTop = lista().scrollTop - 10;
    await tick();
    e = aplicar(e, { v: 1, t: "texto", delta: P2 });
    const antes = lista().scrollTop;
    dibujar(e);
    expect(lista().scrollTop).toBe(antes);
    expect(escondido()).toBeGreaterThan(0);
  });

  it("sin `ResizeObserver` (un navegador viejo, un entorno de prueba) la lista sigue andando", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(null, cont);
    dibujar(historiaLarga());
    expect(escondido()).toBe(0);
  });
});
