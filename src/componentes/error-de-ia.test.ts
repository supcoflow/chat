// @vitest-environment happy-dom
import { h, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estadoInicial, type EstadoDelChat } from "../estado";
import { Mensajes } from "./Mensajes";

// Con la clave del cliente muerta a mitad de una charla (tanda 8, «La IA la pone el cliente»), el backend manda el error con `ia_no_disponible` / `ia_sin_configurar` y la frase
// neutra. El widget dibuja SU texto (el `mensaje` del backend no se usa) y NO ofrece «Retry»: si el turno falló dentro de eve, «Retry» sólo rebobina desde una `espera` que ya está después
// del error (lo borra sin volver a pedir el turno); si la admisión rechazó el mensaje, el arreglo es del cliente. Escribir de nuevo sigue funcionando.
const cont = document.createElement("div");
document.body.appendChild(cont);
afterEach(() => render(null, cont));

function dibujar(codigo: string, terminal: boolean, mensaje = "msg del backend"): void {
  const estado: EstadoDelChat = { ...estadoInicial(null), error: { codigo, mensaje, terminal } };
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  render(h(Mensajes, { estado, titulo: "Ayuda", logoUrl: null, onReintentar: () => {}, onResponder: () => {}, onNuevaConversacion: () => {} }), cont);
}
const texto = (): string => cont.querySelector(".scf-error span")?.textContent ?? "";
const boton = (): Element | null => cont.querySelector(".scf-error button");

describe("el error de la IA del cliente en el widget", () => {
  it("ia_no_disponible e ia_sin_configurar: la frase neutra propia (no la del backend) y sin «Retry»", () => {
    for (const codigo of ["ia_no_disponible", "ia_sin_configurar"]) {
      dibujar(codigo, false);
      expect(texto(), codigo).toBe("The assistant isn't available right now. Please try again later.");
      expect(boton(), codigo).toBeNull();
      render(null, cont);
    }
  });
  it("el resto de los errores no terminales sigue con su texto y su «Retry»", () => {
    for (const [codigo, frase] of [["red", "Couldn't send. Try again."], ["tope_de_mensajes", "The chat can't take more messages right now. Try again later."]] as const) {
      dibujar(codigo, false);
      expect(texto(), codigo).toBe(frase);
      expect(boton()?.textContent, codigo).toBe("Retry");
      render(null, cont);
    }
  });
  it("un error terminal sigue sin «Retry»", () => {
    dibujar("limite_de_sesion", true);
    expect(boton()).toBeNull();
  });
});
