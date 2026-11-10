// @vitest-environment happy-dom
import { h, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alEnviar, estadoInicial, reducir } from "../estado";
import { Compositor } from "./Compositor";
import { Mensajes } from "./Mensajes";

// El pegado largo, con los componentes REALES: el compositor lo colapsa, el mensaje enviado se dibuja colapsado y se puede expandir, y lo corto no cambia.
const cont = document.createElement("div");
document.body.appendChild(cont);
afterEach(() => render(null, cont));

const tick = () => new Promise((r) => setTimeout(r, 0));
const LARGO = Array.from({ length: 30 }, (_, i) => `línea ${i + 1} del log`).join("\n");

function mensajes(textoDelUsuario: string) {
  const estado = [{ v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: textoDelUsuario }, { v: 1, t: "asistente", texto: "Gracias." }, { v: 1, t: "espera", indice: 3 }].reduce(
    (e, ev) => reducir(e, ev as never),
    alEnviar(estadoInicial(null), textoDelUsuario),
  );
  render(h(Mensajes, { estado, titulo: "Ayuda", logoUrl: null, onReintentar: () => {}, onResponder: () => {}, onNuevaConversacion: () => {} }), cont);
  return cont;
}

describe("un mensaje enviado con un pegado largo", () => {
  it("se dibuja como «[pasted text]» y no como el texto entero", () => {
    const c = mensajes(LARGO);
    const burbuja = c.querySelector(".scf-msg--usuario")!;
    expect(burbuja.textContent).toContain("[pasted text]");
    expect(burbuja.textContent).not.toContain("línea 5 del log");
  });
  it("dice cuánto es (caracteres y líneas) y se puede expandir y volver a colapsar, con el texto completo, línea por línea", async () => {
    const c = mensajes(LARGO);
    const boton = c.querySelector<HTMLButtonElement>(".scf-msg--usuario button")!;
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(c.querySelector(".scf-msg--usuario")!.textContent).toMatch(/30 lines/);
    boton.click();
    await tick();
    const abierto = c.querySelector(".scf-msg--usuario")!;
    expect(abierto.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(abierto.querySelector(".scf-pegado-texto")!.textContent).toBe(LARGO);
    abierto.querySelector<HTMLButtonElement>("button")!.click();
    await tick();
    expect(c.querySelector(".scf-pegado-texto")).toBeNull();
  });
  it("un mensaje corto se dibuja como siempre, sin botón", () => {
    const c = mensajes("The save button does nothing");
    expect(c.querySelector(".scf-msg--usuario")!.textContent).toBe("The save button does nothing");
    expect(c.querySelector(".scf-msg--usuario button")).toBeNull();
  });
  it("también por largo en caracteres (una línea de 1.001)", () => {
    expect(mensajes("x".repeat(1001)).querySelector(".scf-msg--usuario")!.textContent).toContain("[pasted text]");
  });
  it("el texto del asistente nunca se colapsa", () => {
    const c = mensajes("hola");
    expect(c.querySelector(".scf-msg--asistente")!.textContent).toBe("Gracias.");
  });
});

describe("la tira de lo pegado en el compositor (revisión 2, N2)", () => {
  const pegados = [{ marca: "[pasted text]", texto: `contraseña: hunter2\n${LARGO}` }];
  function tira() {
    render(h(Compositor, { valor: "mirá [pasted text]", onCambio: () => {}, onEnviar: () => {}, deshabilitado: false, enfocarAlMontar: false, herramientas: null, adjuntos: null, onPegar: () => {}, maxLargo: 4000, pegados, aviso: null }), cont);
    return cont;
  }
  it("antes de mandar se ve cuánto es y la primera línea (para notar un portapapeles equivocado)", () => {
    const li = tira().querySelector(".scf-pegados li")!;
    expect(li.textContent).toContain("[pasted text]");
    expect(li.textContent).toContain("31 lines");
    expect(li.textContent).toContain("contraseña: hunter2");
    expect(li.textContent).not.toContain("línea 5 del log");
  });
  it("se puede abrir y leer completo, y cerrar", async () => {
    const c = tira();
    c.querySelector<HTMLButtonElement>(".scf-pegados button")!.click();
    await tick();
    expect(c.querySelector(".scf-pegados .scf-pegado-texto")!.textContent).toBe(pegados[0]!.texto);
    c.querySelector<HTMLButtonElement>(".scf-pegados button")!.click();
    await tick();
    expect(c.querySelector(".scf-pegados .scf-pegado-texto")).toBeNull();
  });
  it("sin pegados no hay tira", () => {
    render(h(Compositor, { valor: "", onCambio: () => {}, onEnviar: () => {}, deshabilitado: false, enfocarAlMontar: false, herramientas: null, adjuntos: null, onPegar: () => {}, maxLargo: 4000, pegados: [], aviso: null }), cont);
    expect(cont.querySelector(".scf-pegados")).toBeNull();
  });
  it("el aviso de que algo no entró se dice junto al campo", () => {
    render(h(Compositor, { valor: "", onCambio: () => {}, onEnviar: () => {}, deshabilitado: false, enfocarAlMontar: false, herramientas: null, adjuntos: null, onPegar: () => {}, maxLargo: 4000, pegados: [], aviso: "Only the first 3,995 characters of the pasted text fit in one message." }), cont);
    expect(cont.querySelector(".scf-aviso")!.textContent).toContain("Only the first 3,995 characters");
  });
});

describe("el compositor", () => {
  function dibujar(extra: Partial<Parameters<typeof Compositor>[0]> = {}) {
    const onPegar = vi.fn();
    const onCambio = vi.fn();
    render(h(Compositor, { valor: "", onCambio, onEnviar: () => {}, deshabilitado: false, enfocarAlMontar: false, herramientas: null, adjuntos: null, onPegar, maxLargo: 4000, pegados: [], aviso: null, ...extra }), cont);
    const ta = cont.querySelector("textarea")!;
    const pegar = (texto: string) => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: { getData: (t: string) => (t === "text/plain" || t === "text" ? texto : "") } });
      ta.dispatchEvent(ev);
      return ev;
    };
    return { ta, pegar, onPegar, onCambio };
  }

  it("un pegado largo no entra al textarea: se avisa con el texto y la selección, y se frena el pegado normal", () => {
    const { pegar, onPegar } = dibujar();
    const ev = pegar(LARGO);
    expect(ev.defaultPrevented).toBe(true);
    expect(onPegar).toHaveBeenCalledWith({ texto: LARGO, inicio: 0, fin: 0 });
  });
  it("un pegado corto sigue el camino normal del navegador", () => {
    const { pegar, onPegar } = dibujar();
    const ev = pegar("una frase corta");
    expect(ev.defaultPrevented).toBe(false);
    expect(onPegar).not.toHaveBeenCalled();
  });
  it("el tope de lo que se puede seguir escribiendo es `maxLargo` (descuenta lo que ocupan los pegados)", () => {
    const { ta } = dibujar({ maxLargo: 2500 });
    expect(ta.getAttribute("maxlength")).toBe("2500");
  });
});
