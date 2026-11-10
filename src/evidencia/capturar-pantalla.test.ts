import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturarPantalla, ESPERA_DEL_PERMISO_MS, ESPERA_DEL_VIDEO_MS, type Codificar } from "./captura";
import { capturarOcultando } from "./capturar-con-chat-oculto";

// Hallazgo de la prueba real en producción (2026-10-29, Chrome headless): al tocar «Take a screenshot» el chat entero (burbuja
// incluida) desaparecía y no volvía. Causa: se ocultaba ANTES de pedir el permiso de pantalla, y en headless `getDisplayMedia` no se
// resuelve ni se rechaza nunca; además no había ningún tope de tiempo ni un `finally` que lo volviera a mostrar (2.3.1).

type Pista = { stop: ReturnType<typeof vi.fn> };
const codificar: Codificar = async () => new Blob([new Uint8Array(10)], { type: "image/webp" });

interface Escenario {
  /** Qué hace getDisplayMedia: devuelve el stream, lo rechaza, o no se resuelve nunca; o se resuelve cuando se llama a `resolverPermiso`. */
  permiso: "concede" | "rechaza" | "nunca" | "manual";
  metadata?: "llega" | "nunca";
  play?: "ok" | "rechaza";
  /** requestAnimationFrame: en una pestaña de fondo no corre nunca. */
  frames?: "corren" | "nunca";
}

function mundo(e: Escenario) {
  const pistas: Pista[] = [{ stop: vi.fn() }];
  const stream = { getTracks: () => pistas } as unknown as MediaStream;
  let resolverPermiso: (s: MediaStream) => void = () => {};
  const orden: string[] = [];
  const video = {
    srcObject: null as unknown,
    muted: false,
    videoWidth: 1000,
    videoHeight: 500,
    onloadedmetadata: null as null | (() => void),
    onerror: null as null | (() => void),
    play: () => (e.play === "rechaza" ? Promise.reject(new Error("no reproduce")) : Promise.resolve()),
  };
  Object.defineProperty(video, "srcObject", {
    get: () => null,
    set: () => {
      orden.push("video");
      if ((e.metadata ?? "llega") === "llega") queueMicrotask(() => video.onloadedmetadata?.());
    },
  });
  const ventana = {
    innerWidth: 1000,
    document: { createElement: () => video },
    requestAnimationFrame: (cb: () => void) => {
      if ((e.frames ?? "corren") === "corren") queueMicrotask(cb);
      return 1;
    },
    navigator: {
      mediaDevices: {
        getDisplayMedia: () => {
          orden.push("permiso");
          if (e.permiso === "concede") return Promise.resolve(stream);
          if (e.permiso === "rechaza") return Promise.reject(new DOMException("denegado", "NotAllowedError"));
          if (e.permiso === "manual") return new Promise<MediaStream>((r) => { resolverPermiso = r; });
          return new Promise<MediaStream>(() => {});
        },
      },
    },
  } as unknown as Window;
  return { ventana, pistas, orden, concederTarde: () => resolverPermiso(stream) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("capturarPantalla — el permiso se pide ANTES de ocultar el chat, y nada puede colgarse", () => {
  it("permiso concedido: pide el permiso, DESPUÉS corre `antesDelFrame` (ahí se oculta el chat), toma el frame y cierra las pistas", async () => {
    const m = mundo({ permiso: "concede" });
    const antesDelFrame = vi.fn(async () => void m.orden.push("oculta"));
    const imagen = await capturarPantalla(m.ventana, null, codificar, { antesDelFrame });
    expect(imagen).not.toBeNull();
    expect(m.orden.slice(0, 2)).toEqual(["permiso", "oculta"]);
    expect(m.orden).toContain("video");
    expect(m.orden.indexOf("oculta")).toBeLessThan(m.orden.indexOf("video"));
    expect(m.pistas[0]!.stop).toHaveBeenCalled();
  });

  it("el permiso NO se resuelve nunca (Chrome headless): a los ESPERA_DEL_PERMISO_MS devuelve null y el chat NUNCA se ocultó", async () => {
    const m = mundo({ permiso: "nunca" });
    const antesDelFrame = vi.fn();
    const p = capturarPantalla(m.ventana, null, codificar, { antesDelFrame });
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_PERMISO_MS - 1);
    let listo = false;
    void p.then(() => (listo = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(listo).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBeNull();
    expect(antesDelFrame).not.toHaveBeenCalled();
  });

  it("el permiso llega TARDE, después del tope: las pistas se cierran (no queda una captura de pantalla abierta) y no se oculta nada", async () => {
    const m = mundo({ permiso: "manual" });
    const antesDelFrame = vi.fn();
    const p = capturarPantalla(m.ventana, null, codificar, { antesDelFrame });
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_PERMISO_MS + 1);
    expect(await p).toBeNull();
    m.concederTarde();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.pistas[0]!.stop).toHaveBeenCalled();
    expect(antesDelFrame).not.toHaveBeenCalled();
  });

  it("el permiso se deniega o se cancela: null enseguida, sin ocultar nada", async () => {
    const m = mundo({ permiso: "rechaza" });
    const antesDelFrame = vi.fn();
    expect(await capturarPantalla(m.ventana, null, codificar, { antesDelFrame })).toBeNull();
    expect(antesDelFrame).not.toHaveBeenCalled();
  });

  it("el video nunca carga sus metadatos: a los ESPERA_DEL_VIDEO_MS devuelve null y cierra las pistas", async () => {
    const m = mundo({ permiso: "concede", metadata: "nunca" });
    const p = capturarPantalla(m.ventana, null, codificar, {});
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_VIDEO_MS + 1);
    expect(await p).toBeNull();
    expect(m.pistas[0]!.stop).toHaveBeenCalled();
  });

  it("los cuadros nunca corren (pestaña de fondo) o `antesDelFrame` no termina: null a los ESPERA_DEL_VIDEO_MS y pistas cerradas", async () => {
    const m = mundo({ permiso: "concede", frames: "nunca" });
    const p = capturarPantalla(m.ventana, null, codificar, { antesDelFrame: () => new Promise<void>(() => {}) });
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_VIDEO_MS + 1);
    expect(await p).toBeNull();
    expect(m.pistas[0]!.stop).toHaveBeenCalled();
  });

  it("`play()` rechaza: null y pistas cerradas, sin excepción", async () => {
    const m = mundo({ permiso: "concede", play: "rechaza" });
    expect(await capturarPantalla(m.ventana, null, codificar, {})).toBeNull();
    expect(m.pistas[0]!.stop).toHaveBeenCalled();
  });

  it("sin opciones sigue andando como antes (el llamador viejo)", async () => {
    const m = mundo({ permiso: "concede" });
    expect(await capturarPantalla(m.ventana, null, codificar)).not.toBeNull();
  });
});

describe("capturarOcultando — el chat siempre vuelve", () => {
  function deps(capturar: (o: { antesDelFrame: () => void }) => Promise<unknown>) {
    const estado = { ocultar: vi.fn(), mostrar: vi.fn(), enCurso: { current: false } };
    return { ...estado, capturar: capturar as never };
  }
  it("sólo se oculta cuando la captura llama a `antesDelFrame` (no al empezar) y SIEMPRE se vuelve a mostrar", async () => {
    const d = deps(async () => "imagen");
    const r = await capturarOcultando(d);
    expect(r).toEqual({ tipo: "listo", imagen: "imagen" });
    expect(d.ocultar).not.toHaveBeenCalled();
    expect(d.mostrar).toHaveBeenCalledTimes(1);
  });
  it("si la captura llama a `antesDelFrame`, oculta una vez y vuelve a mostrar al terminar", async () => {
    const d = deps(async (o) => {
      o.antesDelFrame();
      return null;
    });
    await capturarOcultando(d);
    expect(d.ocultar).toHaveBeenCalledTimes(1);
    expect(d.mostrar).toHaveBeenCalledTimes(1);
  });
  it("si la captura LANZA, el chat vuelve a mostrarse igual y el error no se pierde", async () => {
    const d = deps(async (o) => {
      o.antesDelFrame();
      throw new Error("se rompió");
    });
    await expect(capturarOcultando(d)).rejects.toThrow("se rompió");
    expect(d.mostrar).toHaveBeenCalledTimes(1);
    expect(d.enCurso.current).toBe(false);
  });
  it("un segundo toque mientras el permiso está pendiente se ignora (no abre otro diálogo)", async () => {
    let soltar: (v: unknown) => void = () => {};
    const d = deps(() => new Promise((r) => { soltar = r; }));
    const primera = capturarOcultando(d);
    expect(await capturarOcultando(d)).toEqual({ tipo: "ocupado" });
    soltar("ok");
    expect(await primera).toEqual({ tipo: "listo", imagen: "ok" });
    expect(d.enCurso.current).toBe(false);
  });
});

// Revisión del widget 2.3.1, vuelta 1, hallazgo 1: al vencer los 60 s el chat se libera y se devuelve `null`, pero el permiso NATIVO
// sigue pendiente (no se puede cancelar). Un segundo toque no puede abrir otro `getDisplayMedia` mientras el primero siga vivo: el guard del
// pedido dura hasta que la promesa original se resuelve o rechaza.
describe("el permiso nativo vencido por tiempo sigue ocupando el guard hasta que termine", () => {
  const pendiente = () => ({ current: false });
  function contar(m: ReturnType<typeof mundo>) {
    return () => m.orden.filter((x) => x === "permiso").length;
  }

  it("vence el permiso, se vuelve a tocar → SIGUE habiendo una sola llamada nativa (y el chat ya se había liberado)", async () => {
    const m = mundo({ permiso: "manual" });
    const permisoPendiente = pendiente();
    const enCurso = { current: false };
    const capturar = () => capturarOcultando({ enCurso, ocultar: () => {}, mostrar: () => {}, capturar: ({ antesDelFrame }) => capturarPantalla(m.ventana, null, codificar, { antesDelFrame, permisoPendiente }) });
    const primera = capturar();
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_PERMISO_MS + 1);
    expect(await primera).toEqual({ tipo: "listo", imagen: null });
    expect(enCurso.current).toBe(false); // el chat ya no espera...
    expect(permisoPendiente.current).toBe(true); // ...pero el permiso nativo sigue vivo
    const segunda = await capturar();
    expect(segunda).toEqual({ tipo: "listo", imagen: null });
    expect(contar(m)()).toBe(1);
  });

  it("el permiso viejo llega tarde: se cierran sus pistas y recién entonces se permite un intento nuevo", async () => {
    const m = mundo({ permiso: "manual" });
    const permisoPendiente = pendiente();
    const p = capturarPantalla(m.ventana, null, codificar, { permisoPendiente });
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_PERMISO_MS + 1);
    expect(await p).toBeNull();
    expect(permisoPendiente.current).toBe(true);
    m.concederTarde();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.pistas[0]!.stop).toHaveBeenCalled();
    expect(permisoPendiente.current).toBe(false);
  });

  it("el permiso viejo se rechaza tarde: se libera el guard y un intento nuevo vuelve a pedir el permiso", async () => {
    let rechazarTarde: (e: unknown) => void = () => {};
    let llamadas = 0;
    const ventana = { innerWidth: 1000, document: {}, requestAnimationFrame: (cb: () => void) => { queueMicrotask(cb); return 1; },
      navigator: { mediaDevices: { getDisplayMedia: () => { llamadas++; return new Promise<MediaStream>((_, rej) => { rechazarTarde = rej; }); } } } } as unknown as Window;
    const permisoPendiente = pendiente();
    const p = capturarPantalla(ventana, null, codificar, { permisoPendiente });
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_PERMISO_MS + 1);
    expect(await p).toBeNull();
    expect(llamadas).toBe(1);
    rechazarTarde(new DOMException("cancelado", "NotAllowedError"));
    await vi.advanceTimersByTimeAsync(0);
    expect(permisoPendiente.current).toBe(false);
    void capturarPantalla(ventana, null, codificar, { permisoPendiente });
    expect(llamadas).toBe(2);
  });

  it("un permiso que se contesta a tiempo (concedido o denegado) libera el guard enseguida", async () => {
    const denegado = pendiente();
    expect(await capturarPantalla(mundo({ permiso: "rechaza" }).ventana, null, codificar, { permisoPendiente: denegado })).toBeNull();
    expect(denegado.current).toBe(false);
    const concedido = pendiente();
    expect(await capturarPantalla(mundo({ permiso: "concede" }).ventana, null, codificar, { permisoPendiente: concedido })).not.toBeNull();
    expect(concedido.current).toBe(false);
  });
});
