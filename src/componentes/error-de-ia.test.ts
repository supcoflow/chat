// @vitest-environment happy-dom
import { h, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../cliente";
import { normalizarOpciones } from "../opciones";
import { estadoInicial, reducir, type EstadoDelChat } from "../estado";
import { Mensajes } from "./Mensajes";

// Con la clave del cliente muerta a mitad de una charla (tanda 8, «La IA la pone el cliente»), el backend manda el error con `ia_no_disponible` / `ia_sin_configurar` y la frase
// neutra. Para estos dos códigos el widget dibuja la frase de la causa que manda el backend (si no viene, la suya) y NO ofrece «Retry»: si el turno falló dentro de eve, «Retry» sólo rebobina desde una `espera` que ya está después
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
  it("ia_no_disponible e ia_sin_configurar sin frase del backend: la frase neutra propia y sin «Retry»", () => {
    for (const codigo of ["ia_no_disponible", "ia_sin_configurar"]) {
      dibujar(codigo, false, "");
      expect(texto(), codigo).toBe("The assistant isn't available right now. Please try again later.");
      expect(boton(), codigo).toBeNull();
      render(null, cont);
    }
  });
  it("con frase del backend (la de la causa) se dibuja ESA, sin «Retry»", () => {
    for (const codigo of ["ia_no_disponible", "ia_sin_configurar"]) {
      dibujar(codigo, false, "Hay muchas consultas al mismo tiempo. Esperá un minuto y probá de nuevo.");
      expect(texto(), codigo).toBe("Hay muchas consultas al mismo tiempo. Esperá un minuto y probá de nuevo.");
      expect(boton(), codigo).toBeNull();
      render(null, cont);
    }
  });
  it("la frase se dibuja como texto, nunca como HTML, y una desmedida cae a la neutra", () => {
    dibujar("ia_no_disponible", false, "<img src=x onerror=alert(1)>Esperá");
    expect(cont.querySelector(".scf-error img")).toBeNull();
    expect(texto()).not.toContain("<");
    render(null, cont);
    dibujar("ia_no_disponible", false, "x".repeat(500));
    expect(texto()).toBe("The assistant isn't available right now. Please try again later.");
  });
  it("un 403 de la admisión con `ia_no_disponible` (cuerpo `{ ok:false, motivo }`, sin frase) dibuja la frase neutra, nunca el status HTTP", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, motivo: "ia_no_disponible" }), { status: 403 })) as unknown as typeof fetch;
    const cliente = crearCliente(normalizarOpciones({ tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test/" }), f);
    let estado: EstadoDelChat = estadoInicial(null);
    for await (const ev of cliente.seguir("ses_1", 2, { mensaje: "hola" })) estado = reducir(estado, ev);
    vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    render(h(Mensajes, { estado, titulo: "Ayuda", logoUrl: null, onReintentar: () => {}, onResponder: () => {}, onNuevaConversacion: () => {} }), cont);
    expect(texto()).toBe("The assistant isn't available right now. Please try again later.");
    expect(boton()).toBeNull();
  });
  it("otros códigos siguen ignorando el mensaje del backend", () => {
    dibujar("tope_de_mensajes", false, "Esperá un minuto");
    expect(texto()).toBe("The chat can't take more messages right now. Try again later.");
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
