import { describe, expect, it, vi } from "vitest";
import type { ClienteDelChat, Respuesta } from "../cliente";
import { ELEMENTO, IMAGEN } from "../evidencia/adjuntos.test";
import type { ResultadoDeSubida, subirAdjunto } from "../evidencia/subida";
import { normalizarOpciones } from "../opciones";
import type { EventoDelPreview, EventoDelWidget } from "../protocolo";
import { ControladorDelChat, type OpcionesDelControlador } from "./controlador";

// El motor del núcleo sin DOM ni red: un cliente guionado (cada llamada consume el siguiente guion) y un almacén en memoria.
// Lo que se prueba es lo que antes vivía dentro de Widget.tsx: reconectar, reintentar sin duplicar, subir adjuntos cuando hay sesión,
// guardar el cursor y avisar los errores. Los widgets y el núcleo público comparten ESTAS reglas.

type Guion = (EventoDelWidget | Error)[];
async function* corriente(guion: Guion, alEmpezar?: () => void): AsyncGenerator<EventoDelWidget> {
  alEmpezar?.();
  for (const e of guion) {
    if (e instanceof Error) throw e;
    await Promise.resolve();
    yield e;
  }
}

function clienteGuionado(guiones: Guion[]) {
  const llamadas: { metodo: "abrir" | "seguir" | "recuperar"; args: unknown[]; senal: AbortSignal | undefined }[] = [];
  const siguiente = (): Guion => guiones.shift() ?? [{ v: 1, t: "espera", indice: 99 }];
  const cliente: ClienteDelChat = {
    abrir: (mensaje, contexto, senal) => { llamadas.push({ metodo: "abrir", args: [mensaje, contexto], senal }); return corriente(siguiente()); },
    seguir: (id, indice, cuerpo, senal) => { llamadas.push({ metodo: "seguir", args: [id, indice, cuerpo], senal }); return corriente(siguiente()); },
    recuperar: (id, desde, senal) => { llamadas.push({ metodo: "recuperar", args: [id, desde], senal }); return corriente(siguiente()); },
  };
  return { cliente, llamadas };
}

function almacenEnMemoria() {
  const datos = new Map<string, string>();
  return { datos, storage: { setItem: (k: string, v: string) => void datos.set(k, v), removeItem: (k: string) => void datos.delete(k) } };
}

const OPCIONES = normalizarOpciones({ tenantId: "tnt_a", projectId: "proj_b", backendUrl: "https://chat.test", usuario: { id: "u1", rol: "admin", nombre: "Ana" }, contexto: { versionApp: "3.1" } });
const VENTANA = { location: { href: "https://app.cliente.com/cuenta?token=secreto#x" }, navigator: { userAgent: "UA-de-prueba" } };

function crear(guiones: Guion[], extra: Partial<OpcionesDelControlador> = {}) {
  const { cliente, llamadas } = clienteGuionado(guiones);
  const { datos, storage } = almacenEnMemoria();
  const alError = vi.fn();
  const subir = vi.fn(async (..._args: Parameters<typeof subirAdjunto>): Promise<ResultadoDeSubida> => ({ ok: true, evidenciaId: "evd_1" }));
  const c = new ControladorDelChat({ cliente, opciones: OPCIONES, almacen: { storage, clave: "k" }, alError, subir, ventana: VENTANA, ...extra });
  return { c, llamadas, datos, alError, subir };
}
const SESION: EventoDelWidget = { v: 1, t: "sesion", id: "s1", indice: 0 };
const ESPERA = (indice: number): EventoDelWidget => ({ v: 1, t: "espera", indice });
const textos = (c: ControladorDelChat) => c.estado().chat.mensajes.map((m) => (m.rol === "desenlace" ? "[desenlace]" : `${m.rol}: ${m.texto}`));

describe("enviar", () => {
  it("sin sesión abre una con el primer mensaje y el contexto del navegador (URL sin query ni hash, versión, usuario); el usuario se ve YA y queda `ocupado` hasta el borde", async () => {
    const { c, llamadas } = crear([[SESION, { v: 1, t: "usuario", texto: "hola" }, { v: 1, t: "asistente", texto: "Hola." }, ESPERA(4)]]);
    const termino = c.enviar("hola");
    expect(c.estado().chat.ocupado).toBe(true);
    expect(textos(c)).toEqual(["usuario: hola"]); // optimista, antes de cualquier evento
    await termino;
    expect(llamadas[0]).toMatchObject({ metodo: "abrir", args: ["hola", { url: "https://app.cliente.com/cuenta", agente_usuario: "UA-de-prueba", version_app: "3.1", usr_id: "u1", usr_rol: "admin" }] });
    expect(JSON.stringify(llamadas[0].args)).not.toContain("Ana"); // el nombre NO sale del navegador
    expect(textos(c)).toEqual(["usuario: hola", "asistente: Hola."]);
    expect(c.estado().chat).toMatchObject({ ocupado: false, cursor: { id: "s1", indice: 4 } });
  });

  it("con sesión sigue: manda el índice del cursor y NO repite el contexto del primer turno", async () => {
    const { c, llamadas } = crear([[SESION, ESPERA(3)], [ESPERA(7)]]);
    await c.enviar("uno");
    await c.enviar("dos");
    expect(llamadas[1]).toMatchObject({ metodo: "seguir", args: ["s1", 3, { mensaje: "dos" }] });
    expect(c.estado().chat.cursor).toEqual({ id: "s1", indice: 7 });
  });

  it("ignora un texto vacío o un envío mientras hay un turno en vuelo: nunca dos pedidos a la vez", async () => {
    const { c, llamadas } = crear([[SESION, ESPERA(1)]]);
    await c.enviar("");
    const primero = c.enviar("uno");
    await c.enviar("dos"); // ocupado: se ignora
    await primero;
    expect(llamadas.map((l) => l.metodo)).toEqual(["abrir"]);
    expect(textos(c)).toEqual(["usuario: uno"]);
  });

  it("guarda el cursor donde se le dijo cada vez que cambia, y lo borra cuando la sesión termina", async () => {
    const { c, datos } = crear([[SESION, ESPERA(2)], [{ v: 1, t: "fin" }]]);
    await c.enviar("uno");
    expect(JSON.parse(datos.get("k")!)).toEqual({ id: "s1", indice: 2 });
    await c.enviar("dos");
    expect(datos.has("k")).toBe(false);
  });

  it("un stream que se corta sin borde igual termina el turno (`ocupado` vuelve a false) y cierra la burbuja abierta", async () => {
    const { c } = crear([[SESION, { v: 1, t: "texto", delta: "Hol" }]]);
    await c.enviar("hola");
    expect(c.estado().chat.ocupado).toBe(false);
    expect(c.estado().chat.mensajes.every((m) => !m.abierto)).toBe(true);
  });

  it("una excepción del stream se vuelve el error `red` no terminal y se le cuenta al desarrollador UNA vez", async () => {
    const { c, alError } = crear([[SESION, new Error("se cortó")]]);
    await c.enviar("hola");
    expect(c.estado().chat.error).toEqual({ codigo: "red", mensaje: "se cortó", terminal: false });
    expect(c.estado().chat.ocupado).toBe(false);
    expect(alError).toHaveBeenCalledTimes(1);
    expect(alError).toHaveBeenCalledWith({ codigo: "red", mensaje: "se cortó", terminal: false });
  });
});

describe("responder", () => {
  const PREGUNTA: EventoDelWidget = { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "¿Lo mando?", opciones: [{ id: "approve", label: "Sí", style: "primary" }, { id: "cancel", label: "No", style: "default" }], libre: false };
  it("manda la respuesta por `seguir` con el índice del cursor, y marca ocupado", async () => {
    const { c, llamadas } = crear([[SESION, PREGUNTA, ESPERA(5)], [{ v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "approved", optionId: "approve" }, ESPERA(8)]]);
    await c.enviar("reportá esto");
    expect(c.estado().chat.pregunta?.requestId).toBe("r1");
    const r: Respuesta = { requestId: "r1", optionId: "approve" };
    const termino = c.responder(r);
    expect(c.estado().chat.ocupado).toBe(true);
    await termino;
    expect(llamadas[1]).toMatchObject({ metodo: "seguir", args: ["s1", 5, { respuesta: r }] });
    expect(c.estado().chat.pregunta).toBeNull();
  });
  it("sin sesión, o con un turno en vuelo, no hace nada", async () => {
    const { c, llamadas } = crear([]);
    await c.responder({ requestId: "r1", optionId: "approve" });
    expect(llamadas).toEqual([]);
  });
});

describe("reanudar y reintentar", () => {
  it("con un cursor guardado rebobina desde CERO (no desde el índice del cursor) y está `ocupado` antes del primer evento", async () => {
    const { c, llamadas } = crear([[{ v: 1, t: "usuario", texto: "hola" }, { v: 1, t: "asistente", texto: "Hola." }, ESPERA(6)]], { cursorInicial: { id: "s1", indice: 6 } });
    const termino = c.reanudar();
    expect(c.estado().chat.ocupado).toBe(true);
    await termino;
    expect(llamadas).toMatchObject([{ metodo: "recuperar", args: ["s1", 0] }]);
    expect(textos(c)).toEqual(["usuario: hola", "asistente: Hola."]);
    expect(c.estado().chat.cursor).toEqual({ id: "s1", indice: 6 });
  });
  it("sin cursor guardado reanudar no hace nada", async () => {
    const { c, llamadas } = crear([]);
    await c.reanudar();
    expect(llamadas).toEqual([]);
  });
  it("reintentar con sesión RECUPERA desde el cursor: si el POST llegó y la red se cortó después, volver a mandarlo duplicaría el turno", async () => {
    const { c, llamadas } = crear([[SESION, new Error("red caída")], [{ v: 1, t: "asistente", texto: "Acá estoy." }, ESPERA(5)]]);
    await c.enviar("hola");
    expect(c.estado().chat.error).not.toBeNull();
    await c.reintentar();
    expect(llamadas[1]).toMatchObject({ metodo: "recuperar", args: ["s1", 0] });
    expect(c.estado().chat.error).toBeNull();
    expect(textos(c)).toEqual(["usuario: hola", "asistente: Acá estoy."]);
  });
  it("reintentar sin sesión (falló el primer `abrir`) vuelve a abrir con el MISMO texto y el contexto del primer turno", async () => {
    const { c, llamadas } = crear([[{ v: 1, t: "error", codigo: "red", mensaje: "x", terminal: false }], [SESION, ESPERA(2)]]);
    await c.enviar("hola");
    await c.reintentar();
    expect(llamadas.map((l) => l.metodo)).toEqual(["abrir", "abrir"]);
    expect(llamadas[1].args[0]).toBe("hola");
    expect((llamadas[1].args[1] as Record<string, string>).url).toBe("https://app.cliente.com/cuenta");
    expect(c.estado().chat.cursor).toEqual({ id: "s1", indice: 2 });
  });
  it("reintentar sin nada que reintentar sólo apaga el `ocupado`", async () => {
    const { c, llamadas } = crear([]);
    await c.reintentar();
    expect(llamadas).toEqual([]);
    expect(c.estado().chat.ocupado).toBe(false);
  });
  it("nuevaConversacion borra el cursor (y su copia guardada), deja los mensajes a la vista y el próximo envío abre otra sesión; con un turno en vuelo no hace nada", async () => {
    const { c, llamadas, datos } = crear([[SESION, ESPERA(2)], [{ v: 1, t: "sesion", id: "s2", indice: 0 }, ESPERA(1)]]);
    await c.enviar("uno");
    c.nuevaConversacion();
    expect(c.estado().chat.cursor).toBeNull();
    expect(datos.has("k")).toBe(false);
    expect(textos(c)).toEqual(["usuario: uno"]);
    await c.enviar("dos");
    expect(llamadas.map((l) => l.metodo)).toEqual(["abrir", "abrir"]);
    expect(c.estado().chat.cursor?.id).toBe("s2");
  });
});

describe("adjuntos", () => {
  it("lo adjuntado antes de que exista la sesión queda `pendiente` y se sube apenas llega `sesion`, con el id de la sesión", async () => {
    const { c, subir } = crear([[SESION, ESPERA(1)]]);
    c.agregarCaptura(IMAGEN);
    expect(c.estado().adjuntos.adjuntos[0]).toMatchObject({ estado: "pendiente" });
    expect(subir).not.toHaveBeenCalled();
    await c.enviar("hola");
    await Promise.resolve();
    expect(subir).toHaveBeenCalledTimes(1);
    expect(subir.mock.calls[0]!.slice(0, 3)).toMatchObject([OPCIONES, "s1", { tipo: "captura" }]);
    await vi.waitFor(() => expect(c.estado().adjuntos.adjuntos[0]).toMatchObject({ estado: "listo", evidenciaId: "evd_1" }));
  });
  it("la subida lleva el `fetch` y el `x-supcoflow-sdk` que se le dieron al controlador", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const { c, subir } = crear([[SESION, ESPERA(1)]], { fetchFn, sdk: "core/9.9.9" });
    await c.enviar("hola");
    c.agregarCaptura(IMAGEN);
    await vi.waitFor(() => expect(subir).toHaveBeenCalled());
    expect(subir.mock.calls[0]![3]).toEqual({ sdk: "core/9.9.9", fetchFn, senal: expect.any(AbortSignal) });
  });
  it("destruir corta las subidas en vuelo: la señal que reciben queda abortada, y su resultado tardío no toca nada (revisión 1, P2-2)", async () => {
    const { c, subir, alError } = crear([[SESION, ESPERA(1)]]);
    let senal: AbortSignal | undefined;
    subir.mockImplementationOnce(async (_o, _s, _a, deps) => { senal = deps?.senal; await new Promise((r) => setTimeout(r, 10)); return { ok: false, motivo: "cancelado", reintentable: false }; });
    await c.enviar("hola");
    c.agregarCaptura(IMAGEN);
    await vi.waitFor(() => expect(senal).toBeDefined());
    c.destruir();
    expect(senal!.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(alError).not.toHaveBeenCalled();
    expect(c.estado().adjuntos.adjuntos[0]).toMatchObject({ estado: "subiendo" }); // destruido: nadie escribe más
  });
  it("con sesión ya abierta se sube en el momento de adjuntar, y nunca dos veces el mismo", async () => {
    const { c, subir } = crear([[SESION, ESPERA(1)]]);
    await c.enviar("hola");
    c.agregarElemento(ELEMENTO);
    c.agregarCaptura(IMAGEN);
    await vi.waitFor(() => expect(c.estado().adjuntos.adjuntos.every((a) => a.estado === "listo")).toBe(true));
    expect(subir).toHaveBeenCalledTimes(2);
  });
  it("una subida que falla queda `fallo` con su motivo, se le cuenta al desarrollador, y reintentarla la vuelve a subir", async () => {
    const { c, subir, alError } = crear([[SESION, ESPERA(1)]]);
    subir.mockResolvedValueOnce({ ok: false, motivo: "red", reintentable: true });
    await c.enviar("hola");
    c.agregarCaptura(IMAGEN);
    await vi.waitFor(() => expect(c.estado().adjuntos.adjuntos[0]).toMatchObject({ estado: "fallo", motivo: "red", reintentable: true }));
    expect(alError).toHaveBeenCalledWith({ codigo: "evidencia_red", mensaje: "", terminal: false });
    c.reintentarAdjunto(1);
    await vi.waitFor(() => expect(c.estado().adjuntos.adjuntos[0]).toMatchObject({ estado: "listo" }));
    expect(subir).toHaveBeenCalledTimes(2);
  });
  it("quitar saca un adjunto pendiente; el tope es 4", async () => {
    const { c } = crear([]);
    for (let i = 0; i < 5; i++) c.agregarCaptura(IMAGEN);
    expect(c.estado().adjuntos.adjuntos).toHaveLength(4);
    c.quitarAdjunto(2);
    expect(c.estado().adjuntos.adjuntos.map((a) => a.clave)).toEqual([1, 3, 4]);
  });
  it("lo adjuntado viaja al modelo SÓLO como un resumen de texto en el `contexto` del turno: ni ids, ni bytes", async () => {
    const { c, llamadas } = crear([[SESION, ESPERA(1)], [ESPERA(2)]]);
    c.agregarCaptura(IMAGEN);
    await c.enviar("uno");
    await vi.waitFor(() => expect(c.estado().adjuntos.adjuntos[0].estado).toBe("listo"));
    await c.enviar("dos");
    const ctx = (llamadas[1].args[2] as { contexto?: Record<string, string> }).contexto;
    // desde chat-v16 la página y el usuario viajan en CADA mensaje (el servidor los pone en una nota de sistema de cada turno); la evidencia es lo único que el modelo no recibe como ids ni bytes
    expect(ctx).toEqual({ agente_usuario: "UA-de-prueba", evidencia_capturas: "1", url: "https://app.cliente.com/cuenta", usr_id: "u1", usr_rol: "admin", version_app: "3.1" });
    expect(ctx).not.toHaveProperty("evidencia");
    expect(JSON.stringify(llamadas)).not.toContain("evd_1");
    expect(JSON.stringify(llamadas)).not.toContain(IMAGEN.base64);
  });
  it("cuando la sesión termina la barra arranca vacía, pero la numeración NO se reinicia (una subida tardía no marca el adjunto nuevo)", async () => {
    const { c } = crear([[SESION, ESPERA(1)], [{ v: 1, t: "fin" }]]);
    await c.enviar("uno");
    c.agregarCaptura(IMAGEN);
    c.agregarCaptura(IMAGEN);
    await vi.waitFor(() => expect(c.estado().adjuntos.adjuntos.every((a) => a.estado === "listo")).toBe(true));
    await c.enviar("dos"); // `fin`
    expect(c.estado().adjuntos).toEqual({ adjuntos: [], siguienteClave: 3 });
  });
  it("al llegar el desenlace `reportado` lo ya subido queda sellado como «fue con el reporte»; lo que sube después, no", async () => {
    const { c } = crear([[SESION, ESPERA(1)], [{ v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" }, ESPERA(2)]]);
    await c.enviar("uno");
    c.agregarCaptura(IMAGEN);
    await vi.waitFor(() => expect(c.estado().adjuntos.adjuntos[0].estado).toBe("listo"));
    await c.enviar("reportá");
    expect(c.estado().chat.reportado).toBe(true);
    expect(c.estado().adjuntos.adjuntos[0].enReporte).toBe(true);
  });
  it("sin DOM, señalar/capturar/adjuntar una imagen contestan «no_disponible» en vez de lanzar; con la barra llena, «tope»", async () => {
    const { c } = crear([]);
    expect(c.puedeCapturar).toBe(false);
    expect(c.senalar({ ignorar: null, alElegir: () => {}, alCancelar: () => {} })).toBe("no_disponible");
    expect(await c.capturar({ recorte: null, ocultar: () => {}, mostrar: () => {} })).toBe("no_disponible");
    expect(await c.adjuntarImagen({ type: "image/png" } as File)).toBe("no_disponible");
    for (let i = 0; i < 4; i++) c.agregarCaptura(IMAGEN);
    expect(c.senalar({ ignorar: null, alElegir: () => {}, alCancelar: () => {} })).toBe("tope");
    expect(await c.capturar({ recorte: null, ocultar: () => {}, mostrar: () => {} })).toBe("tope");
    expect(await c.adjuntarImagen({ type: "image/png" } as File)).toBe("tope");
  });
});

describe("suscripción, avisos y destrucción", () => {
  it("suscribir avisa de cada cambio de estado hasta que se da de baja", async () => {
    const { c } = crear([[SESION, ESPERA(1)]]);
    const oyente = vi.fn();
    const baja = c.suscribir(oyente);
    await c.enviar("hola");
    const veces = oyente.mock.calls.length;
    expect(veces).toBeGreaterThan(2);
    baja();
    c.nuevaConversacion();
    expect(oyente).toHaveBeenCalledTimes(veces);
  });
  it("el estado es inmutable: cada cambio es un objeto nuevo y el anterior no se toca", async () => {
    const { c } = crear([[SESION, ESPERA(1)]]);
    const antes = c.estado();
    await c.enviar("hola");
    expect(c.estado()).not.toBe(antes);
    expect(antes.chat.mensajes).toEqual([]);
  });
  it("onEvento recibe `enviado` y `respondido` (lo que se MANDÓ) además de cada evento del stream, y un callback que lanza no tumba el chat", async () => {
    const eventos: EventoDelPreview[] = [];
    let lanzar = true;
    const onEvento = (e: EventoDelPreview): void => { eventos.push(e); if (lanzar) throw new Error("callback roto"); };
    const { c } = crear([[SESION, { v: 1, t: "pregunta", requestId: "r1", kind: "question", prompt: "¿Cuál?", opciones: [], libre: true }, ESPERA(2)], [ESPERA(3)]], { opciones: { ...OPCIONES, onEvento } });
    await c.enviar("hola");
    await c.responder({ requestId: "r1", text: "esa" });
    lanzar = false;
    expect(eventos.map((e) => e.t)).toEqual(["enviado", "sesion", "pregunta", "espera", "respondido", "espera"]);
    expect(eventos[0]).toMatchObject({ t: "enviado", texto: "hola" });
    expect(c.estado().chat.ocupado).toBe(false);
  });
  it("destruir corta el pedido en vuelo (señal de cancelación), deja de avisar y de guardar el cursor", async () => {
    const { c, llamadas, datos } = crear([[SESION, ESPERA(1)]]);
    const oyente = vi.fn();
    c.suscribir(oyente);
    const termino = c.enviar("hola");
    c.destruir();
    const llamadasAlDestruir = oyente.mock.calls.length;
    await termino;
    expect(llamadas[0].senal?.aborted).toBe(true);
    expect(oyente).toHaveBeenCalledTimes(llamadasAlDestruir);
    expect(datos.has("k")).toBe(false);
  });
});

// Revisión 1, P2-1: `espera` apaga `ocupado` y avisa SINCRÓNICAMENTE; un oyente puede mandar el mensaje siguiente en ese mismo instante (una cola que se vacía al
// quedar libre el chat). El cierre del consumo anterior no puede tocar el turno nuevo.
describe("reentrada: el turno siguiente se manda desde un oyente", () => {
  /** Un cliente cuyo SEGUNDO pedido devuelve un stream que se queda abierto hasta que se lo suelta. */
  function clienteConSegundoAbierto() {
    let soltar!: () => void;
    const abierto = new Promise<void>((r) => { soltar = r; });
    const llamadas: unknown[][] = [];
    let n = 0;
    const turno = (): AsyncIterable<EventoDelWidget> => {
      const esElSegundo = ++n === 2;
      return (async function* () {
        if (n === 1 || !esElSegundo) { yield { v: 1, t: "sesion", id: "s1", indice: 0 } as EventoDelWidget; yield { v: 1, t: "espera", indice: 2 } as EventoDelWidget; return; }
        await abierto; // el servidor todavía no contestó
      })();
    };
    const cliente: ClienteDelChat = {
      abrir: (...a) => { llamadas.push(a); return turno(); },
      seguir: (...a) => { llamadas.push(a); return turno(); },
      recuperar: (...a) => { llamadas.push(a); return turno(); },
    };
    return { cliente, llamadas, soltar };
  }

  it("el `finally` del primer consumo NO cierra el mensaje ni el `ocupado` del segundo, y un tercer envío sigue bloqueado", async () => {
    const { cliente, llamadas, soltar } = clienteConSegundoAbierto();
    const c = new ControladorDelChat({ cliente, opciones: OPCIONES });
    let segundo: Promise<void> | null = null;
    c.suscribir(() => {
      const e = c.estado().chat;
      if (!e.ocupado && e.cursor !== null && segundo === null) segundo = c.enviar("second");
    });
    await c.enviar("first");
    expect(llamadas).toHaveLength(2);
    expect(c.estado().chat.ocupado).toBe(true); // el segundo sigue en vuelo
    expect(c.estado().chat.mensajes.at(-1)).toMatchObject({ rol: "usuario", texto: "second", abierto: true });
    await c.enviar("third"); // sigue habiendo un turno en vuelo: se ignora
    expect(llamadas).toHaveLength(2);
    soltar();
    await segundo;
    expect(c.estado().chat.ocupado).toBe(false);
    c.destruir();
  });

  it("un cuerpo que sigue abierto DESPUÉS de `espera` no retiene el turno: el borde termina el consumo", async () => {
    let cerrar!: () => void;
    const seguiAbierto = new Promise<void>((r) => { cerrar = r; });
    const cliente: ClienteDelChat = {
      abrir: () => (async function* () { yield { v: 1, t: "sesion", id: "s1", indice: 0 } as EventoDelWidget; yield { v: 1, t: "espera", indice: 2 } as EventoDelWidget; await seguiAbierto; yield { v: 1, t: "texto", delta: "tarde" } as EventoDelWidget; })(),
      seguir: () => corriente([ESPERA(4)]),
      recuperar: () => corriente([]),
    };
    const c = new ControladorDelChat({ cliente, opciones: OPCIONES });
    await c.enviar("hola"); // resuelve en el borde aunque el cuerpo siga abierto
    expect(c.estado().chat).toMatchObject({ ocupado: false, cursor: { id: "s1", indice: 2 } });
    cerrar();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.estado().chat.mensajes.some((m) => m.rol === "asistente")).toBe(false); // lo que llega tarde no se dibuja
    c.destruir();
  });

  it("responder reentrante: una respuesta mandada desde un oyente tampoco queda cerrada por el consumo anterior", async () => {
    const pregunta: EventoDelWidget = { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "¿?", opciones: [{ id: "approve", label: "Sí", style: "primary" }], libre: false };
    let soltar!: () => void;
    const abierto = new Promise<void>((r) => { soltar = r; });
    let n = 0;
    const cliente: ClienteDelChat = {
      abrir: () => corriente([SESION, pregunta, ESPERA(3)]),
      seguir: () => { n++; return (async function* () { await abierto; yield ESPERA(9); })(); },
      recuperar: () => corriente([]),
    };
    const c = new ControladorDelChat({ cliente, opciones: OPCIONES });
    let respuesta: Promise<void> | null = null;
    c.suscribir(() => {
      const e = c.estado().chat;
      if (!e.ocupado && e.pregunta !== null && respuesta === null) respuesta = c.responder({ requestId: e.pregunta.requestId, optionId: "approve" });
    });
    await c.enviar("reportá");
    expect(n).toBe(1);
    expect(c.estado().chat.ocupado).toBe(true);
    soltar();
    await respuesta;
    expect(c.estado().chat).toMatchObject({ ocupado: false, cursor: { indice: 9 } });
    c.destruir();
  });
});

// Revisión 2, P1-1: recuperar/rebobinar es OTRA cosa que un turno nuevo. El GET de recuperación trae los `espera` de los turnos HISTÓRICOS y sigue; sólo termina al
// llegar a la cola durable. Cortar en el primer borde dejaba la charla truncada en el primer turno (y el cursor guardado con el índice del primero).
describe("rebobinado de una charla de varios turnos", () => {
  const PREG: EventoDelWidget = { v: 1, t: "pregunta", requestId: "req-actual", kind: "tool-approval", prompt: "¿Lo mando?", opciones: [{ id: "approve", label: "Sí", style: "primary" }, { id: "cancel", label: "No", style: "default" }], libre: false };
  const HISTORIA: EventoDelWidget[] = [
    { v: 1, t: "usuario", texto: "uno" }, { v: 1, t: "asistente", texto: "Respuesta uno." }, ESPERA(3),
    { v: 1, t: "usuario", texto: "dos" }, { v: 1, t: "asistente", texto: "Respuesta dos." }, ESPERA(6),
    { v: 1, t: "usuario", texto: "tres" }, { v: 1, t: "paso", que: "resumen_preparado" }, PREG, ESPERA(9),
  ];

  it("reanudar reconstruye TODOS los turnos, deja la confirmación vigente pendiente y el cursor en el índice del último borde", async () => {
    const { c, datos } = crear([HISTORIA], { cursorInicial: { id: "s1", indice: 9 } });
    await c.reanudar();
    expect(textos(c)).toEqual(["usuario: uno", "asistente: Respuesta uno.", "usuario: dos", "asistente: Respuesta dos.", "usuario: tres", "asistente: ¿Lo mando?"]);
    expect(c.estado().chat).toMatchObject({ ocupado: false, pregunta: { requestId: "req-actual" }, cursor: { id: "s1", indice: 9 } });
    expect(JSON.parse(datos.get("k")!)).toEqual({ id: "s1", indice: 9 });
  });

  it("durante el rebobinado el chat NO queda libre en los bordes históricos: ningún aviso intermedio dice `ocupado: false` (un oyente que mandara o aprobara ahí lo haría sobre una charla a medio reconstruir)", async () => {
    const { c, llamadas } = crear([HISTORIA], { cursorInicial: { id: "s1", indice: 9 } });
    const ocupadoEnCadaAviso: boolean[] = [];
    c.suscribir(() => ocupadoEnCadaAviso.push(c.estado().chat.ocupado));
    await c.reanudar();
    expect(ocupadoEnCadaAviso.length).toBeGreaterThan(6);
    expect(ocupadoEnCadaAviso.slice(0, -1).every(Boolean)).toBe(true); // ni siquiera en los `espera` de los turnos 1 y 2
    expect(ocupadoEnCadaAviso.at(-1)).toBe(false); // recién al terminar queda libre
    expect(llamadas.map((l) => l.metodo)).toEqual(["recuperar"]);
    c.destruir();
  });

  it("una charla cuyo último turno ya se resolvió: la pregunta histórica queda resuelta y el reporte, cerrado", async () => {
    const { c } = crear([[
      ...HISTORIA.slice(0, 9),
      { v: 1, t: "pregunta_resuelta", requestId: "req-actual", outcome: "approved", optionId: "approve" }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" }, ESPERA(13),
    ]], { cursorInicial: { id: "s1", indice: 13 } });
    await c.reanudar();
    expect(c.estado().chat).toMatchObject({ pregunta: null, reportado: true, cursor: { indice: 13 } });
  });

  it("una charla terminada (`fin` al final) rebobina entera y sin cursor", async () => {
    const { c } = crear([[...HISTORIA.slice(0, 6), { v: 1, t: "fin" }]], { cursorInicial: { id: "s1", indice: 6 } });
    await c.reanudar();
    expect(textos(c)).toEqual(["usuario: uno", "asistente: Respuesta uno.", "usuario: dos", "asistente: Respuesta dos."]);
    expect(c.estado().chat).toMatchObject({ cursor: null, ocupado: false });
  });

  it("reintentar con sesión también rebobina todo lo que el servidor trae, no sólo hasta el primer borde", async () => {
    const { c } = crear([[SESION, new Error("red caída")], HISTORIA]);
    await c.enviar("uno");
    await c.reintentar();
    expect(c.estado().chat.mensajes.map((m) => (m.rol === "desenlace" ? "d" : m.texto)).slice(-2)).toEqual(["tres", "¿Lo mando?"]);
    expect(c.estado().chat.cursor?.indice).toBe(9);
  });
});

describe("cuerpo abandonado en el borde de un turno", () => {
  it("el cierre del turno anterior cancela SU cuerpo y no el del turno siguiente que un oyente arrancó en ese borde", async () => {
    const enc = new TextEncoder();
    const estados: { cancelado: boolean }[] = [];
    const respuesta = (lineas: string): Response => {
      const e = { cancelado: false };
      estados.push(e);
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(lineas)); }, cancel() { e.cancelado = true; } }), { headers: { "content-type": "application/x-ndjson" } });
    };
    const cuerpos = [
      respuesta('{"v":1,"t":"sesion","id":"s1","indice":0}\n{"v":1,"t":"espera","indice":2}\n'), // se queda abierto tras el borde
      respuesta('{"v":1,"t":"usuario","texto":"second"}\n'), // el segundo: sigue en vuelo, sin borde
    ];
    const { crearCliente } = await import("../cliente");
    const cliente = crearCliente(OPCIONES, (async () => cuerpos.shift()!) as unknown as typeof fetch);
    const c = new ControladorDelChat({ cliente, opciones: OPCIONES });
    let segundo: Promise<void> | null = null;
    c.suscribir(() => { if (!c.estado().chat.ocupado && c.estado().chat.cursor !== null && segundo === null) segundo = c.enviar("second"); });
    await c.enviar("first");
    await vi.waitFor(() => expect(estados[0]!.cancelado).toBe(true)); // el primero se cerró de verdad
    expect(estados[1]!.cancelado).toBe(false); // el segundo sigue vivo
    expect(c.estado().chat.ocupado).toBe(true);
    c.destruir(); // (el fetch de prueba ignora la señal: no se espera a `segundo`, que seguiría leyendo su cuerpo abierto)
    expect(segundo).not.toBeNull();
  });
});

// A1 (sello de la sesión, 2026-10-30): el `id` del evento `sesion` es el id SELLADO que firma el backend. El núcleo lo trata como un string
// opaco: lo guarda en el cursor, lo manda en seguir/recuperar y se lo pasa a la subida de evidencia, sin leerlo ni armarlo.
describe("el id sellado de la sesión (A1)", () => {
  const SELLADO = `ss1.mh3k2x1.${"A".repeat(43)}.wrun_01M674JG3TYJXKTXSYXXVWJYC3`;
  const SESION_SELLADA: EventoDelWidget = { v: 1, t: "sesion", id: SELLADO, indice: 0 };

  it("lo guarda tal cual, lo manda en el seguimiento y se lo da a la subida de evidencia", async () => {
    const { c, llamadas, datos, subir } = crear([[SESION_SELLADA, ESPERA(2)], [ESPERA(5)]]);
    await c.enviar("hola");
    expect(JSON.parse(datos.get("k")!)).toEqual({ id: SELLADO, indice: 2 });
    await c.enviar("sigo");
    expect(llamadas[1]).toMatchObject({ metodo: "seguir", args: [SELLADO, 2, { mensaje: "sigo" }] });
    c.agregarCaptura(IMAGEN);
    await vi.waitFor(() => expect(subir).toHaveBeenCalled());
    expect(subir.mock.calls[0]![1]).toBe(SELLADO);
  });
  it("tras una recarga recupera con el id sellado guardado", async () => {
    const { c, llamadas } = crear([[ESPERA(6)]], { cursorInicial: { id: SELLADO, indice: 6 } });
    await c.reanudar();
    expect(llamadas).toMatchObject([{ metodo: "recuperar", args: [SELLADO, 0] }]);
  });
  it("un `sesion_vencida` terminal (sello vencido, revocado o ajeno) borra el cursor guardado: el usuario empieza de nuevo al escribir", async () => {
    const { c, datos } = crear([[{ v: 1, t: "error", codigo: "sesion_vencida", mensaje: "The session is no longer active.", terminal: true }]], { cursorInicial: { id: SELLADO, indice: 6 } });
    await c.reanudar();
    expect(c.estado().chat.cursor).toBeNull();
    expect(datos.get("k")).toBeUndefined();
  });
});

// Privacidad 1B (T0.5/T0.6, spec 2026-10-28 §12.3): el acuerdo de datos del proyecto. Es comodidad que además ahorra mandar lo que el backend tiraría; el control es del
// backend (`contextoParaEve`), que se prueba aparte. Acá: qué NO sale del navegador y qué se rechaza cuando el acuerdo dice que no.
describe("el acuerdo de datos (permisos)", () => {
  const CERRADO = { capturas: false, elementos: false, paginaYNavegador: false };
  const contextoDe = (llamadas: { args: unknown[] }[], i = 0) => llamadas[i]!.args[1] as Record<string, string> | undefined;

  it("sin permiso de página y navegador, el primer mensaje no lleva la URL ni el navegador; sí la versión y el usuario declarado (esos pide otro permiso del backend)", async () => {
    const { c, llamadas } = crear([[SESION, ESPERA(1)]], { permisos: { capturas: true, elementos: true, paginaYNavegador: false } });
    await c.enviar("hola");
    const ctx = contextoDe(llamadas)!;
    expect(ctx).not.toHaveProperty("url");
    expect(ctx).not.toHaveProperty("agente_usuario");
    expect(ctx).toMatchObject({ version_app: "3.1", usr_id: "u1", usr_rol: "admin" });
  });

  it("sin permiso de elementos, señalar contesta «no_permitido» sin abrir el selector; sin capturas, capturar y adjuntar imagen también, sin agregar nada", async () => {
    const { c } = crear([], { permisos: CERRADO });
    expect(c.senalar({ ignorar: null, alElegir: () => {}, alCancelar: () => {} })).toBe("no_permitido");
    expect(await c.capturar({ recorte: null, ocultar: () => {}, mostrar: () => {} })).toBe("no_permitido");
    expect(await c.adjuntarImagen(new File([""], "a.png", { type: "image/png" }))).toBe("no_permitido");
    expect(c.estado().adjuntos.adjuntos).toEqual([]);
  });

  it("lo que ya estaba adjunto cuando el permiso cambió no viaja al modelo: ni el elemento, ni su página, ni la cuenta de capturas", async () => {
    const { c, llamadas } = crear([[SESION, ESPERA(1)]]);
    c.agregarElemento(ELEMENTO);
    c.agregarCaptura(IMAGEN);
    c.fijarPermisos(CERRADO);
    await c.enviar("hola");
    const ctx = contextoDe(llamadas)!;
    expect(Object.keys(ctx).filter((k) => k.startsWith("evidencia"))).toEqual([]);
    expect(JSON.stringify(ctx)).not.toContain("cuenta"); // la página del elemento
  });

  it("fijarPermisos avisa a los oyentes sólo cuando algo cambia", () => {
    const { c } = crear([]);
    const oyente = vi.fn();
    c.suscribir(oyente);
    c.fijarPermisos({ capturas: true, elementos: true, paginaYNavegador: true });
    expect(oyente).not.toHaveBeenCalled();
    c.fijarPermisos({ capturas: false, elementos: true, paginaYNavegador: true });
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(c.estado().permisos.capturas).toBe(false);
  });

  describe("el sondeo (núcleo público)", () => {
    it("antes del primer mensaje se averigua UNA vez; el usuario se ve YA y el contexto del turno ya sale sin lo prohibido", async () => {
      const sondear = vi.fn(async () => ({ capturas: true, elementos: true, paginaYNavegador: false }));
      const { c, llamadas } = crear([[SESION, ESPERA(1)], [ESPERA(2)]], { sondearPermisos: sondear });
      const termino = c.enviar("hola");
      expect(textos(c)).toEqual(["usuario: hola"]); // optimista: no espera al sondeo
      expect(llamadas).toHaveLength(0); // y el pedido todavía no salió
      await termino;
      expect(contextoDe(llamadas)).not.toHaveProperty("url");
      await c.enviar("otra");
      expect(sondear).toHaveBeenCalledTimes(1);
    });
    it("dos acciones seguidas esperan el MISMO sondeo (no mandan antes de saber)", async () => {
      let resolver!: (p: { capturas: boolean; elementos: boolean; paginaYNavegador: boolean }) => void;
      const sondear = vi.fn(() => new Promise<{ capturas: boolean; elementos: boolean; paginaYNavegador: boolean }>((r) => { resolver = r; }));
      const { c, llamadas } = crear([[SESION, ESPERA(1)]], { sondearPermisos: sondear });
      const envio = c.enviar("hola");
      const adjuntar = c.adjuntarImagen(new File([""], "a.png", { type: "image/png" }));
      await Promise.resolve();
      expect(llamadas).toHaveLength(0);
      resolver(CERRADO);
      expect(await adjuntar).toBe("no_permitido");
      await envio;
      expect(sondear).toHaveBeenCalledTimes(1);
      expect(contextoDe(llamadas)).not.toHaveProperty("url");
    });
    it("un sondeo que falla (null) deja todo permitido y no se reintenta: el servidor filtra igual", async () => {
      const sondear = vi.fn(async () => null);
      const { c, llamadas } = crear([[SESION, ESPERA(1)], [ESPERA(2)]], { sondearPermisos: sondear });
      await c.enviar("hola");
      await c.enviar("otra");
      expect(sondear).toHaveBeenCalledTimes(1);
      expect(contextoDe(llamadas)).toHaveProperty("url");
      expect(c.estado().permisos).toEqual({ capturas: true, elementos: true, paginaYNavegador: true });
    });
    it("con los permisos ya sabidos (el widget los lee antes de dibujar) no se sondea nada", async () => {
      const sondear = vi.fn(async () => CERRADO);
      const { c } = crear([[SESION, ESPERA(1)]], { sondearPermisos: sondear, permisos: { capturas: true, elementos: true, paginaYNavegador: true } });
      await c.enviar("hola");
      expect(sondear).not.toHaveBeenCalled();
    });
    it("destruir mientras se sondea: el mensaje no sale", async () => {
      let resolver!: (p: null) => void;
      const { c, llamadas } = crear([[SESION, ESPERA(1)]], { sondearPermisos: () => new Promise((r) => { resolver = r; }) });
      const termino = c.enviar("hola");
      c.destruir();
      resolver(null);
      await termino;
      expect(llamadas).toHaveLength(0);
    });
  });
});
