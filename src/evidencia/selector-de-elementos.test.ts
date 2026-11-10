// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ID_DEL_SELECTOR, iniciarSelector } from "./selector-de-elementos";

// happy-dom no hace layout: `elementFromPoint` se reemplaza en cada test por lo que el puntero
// "tendría debajo". Lo que se prueba es el ciclo de vida del overlay, no el hit-test real (§8:
// ése es prueba a mano).
afterEach(() => { document.body.innerHTML = ""; document.getElementById(ID_DEL_SELECTOR)?.remove(); });

function mover(x = 10, y = 10): void {
  document.getElementById(ID_DEL_SELECTOR)!.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
}
function clic(): void {
  document.getElementById(ID_DEL_SELECTOR)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("iniciarSelector", () => {
  it("inyecta el host en documentElement, con z-index máximo y un shadow root cerrado", () => {
    const s = iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar: vi.fn() });
    const host = document.getElementById(ID_DEL_SELECTOR)!;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.style.zIndex).toBe("2147483647");
    expect(host.shadowRoot).toBeNull(); // cerrado: la página no puede tocar el overlay
    s.cancelar();
    expect(document.getElementById(ID_DEL_SELECTOR)).toBeNull();
  });

  it("clic sobre un elemento resaltado lo elige y desmonta el overlay", () => {
    document.body.innerHTML = `<button id="b">Guardar</button>`;
    const boton = document.getElementById("b")!;
    document.elementFromPoint = () => boton;
    const alElegir = vi.fn();
    iniciarSelector({ documento: document, ignorar: null, alElegir, alCancelar: vi.fn() });
    mover();
    clic();
    expect(alElegir).toHaveBeenCalledWith(boton);
    expect(document.getElementById(ID_DEL_SELECTOR)).toBeNull();
  });

  it("clic sin nada resaltado no elige ni desmonta: el usuario sigue eligiendo", () => {
    document.elementFromPoint = () => null;
    const alElegir = vi.fn();
    iniciarSelector({ documento: document, ignorar: null, alElegir, alCancelar: vi.fn() });
    mover();
    clic();
    expect(alElegir).not.toHaveBeenCalled();
    expect(document.getElementById(ID_DEL_SELECTOR)).not.toBeNull();
  });

  it("nuestro propio widget y html/body no se pueden elegir", () => {
    document.body.innerHTML = `<div id="widget"><button id="nuestro">x</button></div>`;
    const nuestro = document.getElementById("nuestro")!;
    document.elementFromPoint = () => nuestro;
    const alElegir = vi.fn();
    iniciarSelector({ documento: document, ignorar: document.getElementById("widget"), alElegir, alCancelar: vi.fn() });
    mover();
    clic();
    expect(alElegir).not.toHaveBeenCalled();
    document.elementFromPoint = () => document.body;
    mover();
    clic();
    expect(alElegir).not.toHaveBeenCalled();
  });

  it("Esc cancela: desmonta y avisa; un segundo Esc no avisa dos veces", () => {
    const alCancelar = vi.fn();
    iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(alCancelar).toHaveBeenCalledTimes(1);
    expect(document.getElementById(ID_DEL_SELECTOR)).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(alCancelar).toHaveBeenCalledTimes(1);
  });

  it("iniciar dos veces desmonta el anterior: nunca hay dos overlays", () => {
    iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar: vi.fn() });
    iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar: vi.fn() });
    expect(document.querySelectorAll(`#${ID_DEL_SELECTOR}`)).toHaveLength(1);
  });
  it("cuando otro selector lo reemplaza avisa a SU dueño con `alReemplazar` (y no con `alCancelar`): quien esperaba la elección no queda colgado (revisión 1 del núcleo, P2-4)", () => {
    const alReemplazar = vi.fn();
    const alCancelar = vi.fn();
    iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar, alReemplazar });
    iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar: vi.fn() });
    expect(alReemplazar).toHaveBeenCalledTimes(1);
    expect(alCancelar).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`#${ID_DEL_SELECTOR}`)).toHaveLength(1);
  });
  it("`alReemplazar` es opcional, y un selector que ya se cerró no se avisa al reemplazarlo", () => {
    const alReemplazar = vi.fn();
    const primero = iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar: vi.fn(), alReemplazar });
    primero.cancelar(); // se cierra por su cuenta (silencioso)
    iniciarSelector({ documento: document, ignorar: null, alElegir: vi.fn(), alCancelar: vi.fn() });
    expect(alReemplazar).not.toHaveBeenCalled();
  });
});
