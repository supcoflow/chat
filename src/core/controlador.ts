import type { ClienteDelChat, ErrorDeRechazo, Respuesta } from "../cliente";
import { resumenDeContexto } from "../contexto";
import { PERMISOS_COMO_HOY, type PermisosDelWidget } from "../estado-del-widget";
import { alEnviar, alNuevaConversacion, alReenviar, alReintentar, alResponder, alTerminarStream, estadoInicial, reducir, type ErrorVisible, type EstadoDelChat } from "../estado";
import { agregarCaptura, agregarElemento, marcar, pendientes, puedeAgregar, quitar, sellarReporte, sinAdjuntos, type EstadoDeAdjuntos } from "../evidencia/adjuntos";
import { capturarOcultando } from "../evidencia/capturar-con-chat-oculto";
import { capturarPantalla, codificarConCanvas, imagenDesdeArchivo, prepararImagen, puedeCapturarPantalla, type Codificar, type ImagenLista } from "../evidencia/captura";
import type { ElementoSeleccionado, RectDelElemento } from "../evidencia/elemento";
import { acotarElemento, extraerElemento } from "../evidencia/extraer-elemento";
import { contextoDeEvidencia } from "../evidencia/resumen-de-evidencia";
import { iniciarSelector, type SelectorActivo } from "../evidencia/selector-de-elementos";
import { subirAdjunto } from "../evidencia/subida";
import type { OpcionesResueltas } from "../opciones";
import { esBorde, type CursorDeSesion, type EventoDelPreview, type EventoDelWidget } from "../protocolo";
import { guardarSesion } from "../sesion-guardada";

// El motor del núcleo (plan de las tres formas, §4), sin interfaz: todo lo que en la 2.x vivía dentro de `Widget.tsx` y que NO es
// dibujo —mandar, responder, reconectar al recargar, reintentar sin duplicar, subir adjuntos cuando hay sesión, guardar el cursor,
// avisar los errores—. Lo usan el widget (Preact) y el núcleo público (`createSupportChat`, que le pone nombres en inglés).
//
// Es un almacén con suscripción: `estado()` devuelve un objeto NUEVO por cada cambio (nunca se muta), `suscribir` avisa. No importa
// ni preact ni react ni el CSS: el bundle de `@supcoflow/chat/core` no los arrastra (lo comprueba `build.mjs`).

/** Todo lo que cambia mientras se conversa: la charla y la barra de adjuntos. */
export interface EstadoDelNucleo {
  chat: EstadoDelChat;
  adjuntos: EstadoDeAdjuntos;
  /** Lo que el acuerdo de datos del proyecto deja ofrecer (de `GET /api/chat/estado`). Comodidad que además ahorra mandar lo que el backend
   * tiraría; el control es del backend (`contextoParaEve`) y del motor. Sin saber, como hoy: todo. */
  permisos: PermisosDelWidget;
}

/** Lo que `senalar`, `capturar` y `adjuntarImagen` contestan en vez de dibujar un aviso: el texto es de quien dibuja. */
export type ResultadoDeAdjuntar = "ok" | "tope" | "sin_captura" | "imagen_invalida" | "ocupado" | "no_disponible" | "no_permitido";

export interface OpcionesDelControlador {
  cliente: ClienteDelChat;
  opciones: OpcionesResueltas;
  cursorInicial?: CursorDeSesion | null;
  /** Lo que el acuerdo de datos deja ofrecer, si ya se sabe (el widget lo lee del estado antes de dibujar). Después se cambia con `fijarPermisos`. */
  permisos?: PermisosDelWidget;
  /** Cómo averiguar los permisos si todavía no se saben (el núcleo público no los lee antes de dibujar, como el widget). Devuelve `null` si no pudo: queda «todo» y NO se reintenta (el servidor filtra igual). */
  sondearPermisos?: () => Promise<PermisosDelWidget | null>;
  /** Dónde se guarda el cursor (la clave la arma quien llama). Sin almacén, la charla dura lo que dura la página. */
  almacen?: { storage: Pick<Storage, "setItem" | "removeItem">; clave: string } | null;
  /** Un error que el desarrollador que instala tiene que poder ver (la subida de una evidencia que falla también cuenta). */
  alError?: (e: ErrorVisible) => void;
  /** `x-supcoflow-sdk` para la subida de evidencia (el cliente ya lleva el suyo). */
  sdk?: string;
  /** El `fetch` de la subida de evidencia (el del cliente ya viene adentro). Default: el global. */
  fetchFn?: typeof fetch;
  /** Inyectable para testear sin red. */
  subir?: typeof subirAdjunto;
  /** Dónde mirar la URL y el navegador para el contexto del primer turno. Default: `globalThis`. */
  ventana?: { location?: { href: string }; navigator?: { userAgent: string } };
  /** El DOM, sólo para señalar, capturar y adjuntar imágenes. Sin él esas tres contestan `no_disponible`. Default: `globalThis`. */
  documento?: Document;
  ventanaDelDom?: Window;
}

export class ControladorDelChat {
  private e: EstadoDelNucleo;
  private readonly oyentes = new Set<() => void>();
  private readonly aborto = new AbortController();
  private destruido = false;
  /** El número del turno que está consumiendo un stream. Un consumo sólo toca el estado mientras siga siendo el vigente (revisión 1, P2-1). */
  private turno = 0;
  /** Último texto intentado sin sesión todavía: `mensaje.abierto` no sirve porque `alTerminarStream` cierra TODO `abierto`, haya fallado o no. */
  private ultimoIntentoSinSesion: string | null = null;
  /** (El preview, `onEvento`, ve cada intento: hubo dos POST.) Cómo volver a mandar el pedido de sesión que el servidor RECHAZÓ con un HTTP y su motivo (el turno no corrió). `reintentar` lo usa en vez de recuperar; cualquier consumo nuevo lo borra. */
  private reenvio: (() => Promise<void>) | null = null;
  private readonly enVuelo = new Set<number>();
  private selector: SelectorActivo | null = null;
  private capturaEnCurso = { current: false };
  // Un permiso de pantalla que venció por tiempo sigue pendiente en el navegador: esto lo recuerda entre toques.
  private permisoPendiente = { current: false };
  private codificar: Codificar | null = null;
  private readonly subir: typeof subirAdjunto;
  /** ¿Se sabe qué deja ofrecer el acuerdo de datos? Verdadero si el widget lo leyó antes de dibujar o si `fijarPermisos` ya corrió. */
  private permisosSabidos: boolean;
  private sondeo: Promise<void> | null = null;
  private sondeoIntentado = false;

  constructor(private readonly d: OpcionesDelControlador) {
    this.e = { chat: estadoInicial(d.cursorInicial ?? null), adjuntos: sinAdjuntos(), permisos: d.permisos ?? PERMISOS_COMO_HOY };
    this.subir = d.subir ?? subirAdjunto;
    this.permisosSabidos = d.permisos !== undefined;
  }

  // ── Lectura y suscripción ────────────────────────────────────────────────────
  estado(): EstadoDelNucleo {
    return this.e;
  }

  /** Lo que el acuerdo deja ofrecer. Un cambio de permisos no toca lo que ya está adjunto: lo prohibido nuevo no se agrega, pero lo viejo se quita con `quitarAdjunto`. */
  fijarPermisos(p: PermisosDelWidget): void {
    this.permisosSabidos = true;
    const a = this.e.permisos;
    if (a.capturas === p.capturas && a.elementos === p.elementos && a.paginaYNavegador === p.paginaYNavegador) return;
    this.cambiar((e) => ({ ...e, permisos: { ...p } }));
  }

  /** Antes de la primera acción que podría mandar algo, averigua los permisos (UNA vez, sin gastar tope). `null` si ya se saben, ya se intentó o no hay con qué averiguarlos: ahí la acción sigue
   * sin esperar. Un sondeo que falla deja «todo» (como en la 2.2.1: el servidor filtra igual) y no se reintenta; `fijarPermisos` (el widget, `checkAvailability()`) lo corrige después. */
  asegurarPermisos(): Promise<void> | null {
    if (this.permisosSabidos || this.d.sondearPermisos === undefined || this.destruido) return null;
    if (this.sondeoIntentado) return this.sondeo; // en curso (otra acción llegó mientras tanto: espera lo mismo) o ya terminó (`null`)
    this.sondeoIntentado = true;
    this.sondeo = this.d
      .sondearPermisos()
      .then((p) => { if (p !== null && !this.destruido) this.fijarPermisos(p); })
      .catch(() => {})
      .finally(() => { this.sondeo = null; });
    return this.sondeo;
  }

  /** Avisa de cada cambio hasta que se llama a la función que devuelve. No manda el estado: se lee con `estado()`. */
  suscribir(oyente: () => void): () => void {
    this.oyentes.add(oyente);
    return () => void this.oyentes.delete(oyente);
  }

  /** Corta lo que esté en vuelo (pedidos, selector de elementos) y deja de avisar y de guardar. */
  destruir(): void {
    if (this.destruido) return;
    this.destruido = true;
    this.aborto.abort();
    this.selector?.cancelar();
    this.selector = null;
    this.oyentes.clear();
  }

  // ── La charla ────────────────────────────────────────────────────────────────
  /** Recarga de pestaña con cursor: se reconstruye la charla desde el stream durable. Desde CERO y no desde el índice del cursor: ese
   * índice es el ÚLTIMO consumido, así que rebobinar desde ahí devolvía sólo el borde y la lista quedaba vacía mientras el agente seguía la
   * charla con memoria (hallazgo 3 del spec del 2026-09-11). `ocupado` se marca ANTES de arrancar el consumo, para que un envío en esa
   * ventana no duplique la burbuja del usuario (hallazgo 2 de la revisión final de esa rama). */
  reanudar(): Promise<void> {
    const cursor = this.d.cursorInicial ?? null;
    if (cursor === null) return Promise.resolve();
    this.cambiar((e) => ({ ...e, chat: alReintentar(e.chat) }));
    return this.consumir(this.d.cliente.recuperar(cursor.id, 0, this.aborto.signal), "rebobinado");
  }

  /** Un mensaje del usuario. Sin sesión abre una con el contexto del primer turno; con sesión sigue. Devuelve cuando el turno termina. */
  enviar(texto: string): Promise<void> {
    const actual = this.e.chat;
    if (texto === "" || actual.ocupado) return Promise.resolve();
    this.cambiar((e) => ({ ...e, chat: alEnviar(e.chat, texto) }));
    const cursor = actual.cursor;
    if (cursor === null) this.ultimoIntentoSinSesion = texto;
    // El mensaje del usuario ya se ve (`alEnviar`); si hay que averiguar los permisos, el contexto del turno se arma DESPUÉS, con ellos.
    const mandar = (): Promise<void> => {
      if (this.destruido) return Promise.resolve();
      if (cursor === null) {
        const contexto = this.contextoDelTurno();
        this.avisar({ t: "enviado", texto, contexto });
        return this.consumir(this.d.cliente.abrir(texto, contexto, this.aborto.signal));
      }
      const contexto = this.contextoDelTurno();
      const cuerpo = contexto === undefined ? { mensaje: texto } : { mensaje: texto, contexto };
      const seguir = (): Promise<void> => {
        this.avisar({ t: "enviado", texto, contexto });
        return this.consumir(this.d.cliente.seguir(cursor.id, cursor.indice, cuerpo, this.aborto.signal), "turno", () => {
          this.cambiar((e) => ({ ...e, chat: alReenviar(e.chat, texto) }));
          return seguir();
        });
      };
      return seguir();
    };
    const listos = this.asegurarPermisos();
    return listos === null ? mandar() : listos.then(mandar);
  }

  /** La respuesta a la pregunta pendiente (incluida la confirmación del reporte). Sin sesión o con un turno en vuelo no hace nada. */
  responder(r: Respuesta): Promise<void> {
    const actual = this.e.chat;
    if (actual.ocupado || actual.cursor === null) return Promise.resolve();
    this.cambiar((e) => ({ ...e, chat: alResponder(e.chat) }));
    const { id, indice } = actual.cursor;
    const responder = (): Promise<void> => {
      this.avisar({ t: "respondido", requestId: r.requestId, optionId: r.optionId, text: r.text });
      return this.consumir(this.d.cliente.seguir(id, indice, { respuesta: r }, this.aborto.signal), "turno", () => {
        this.cambiar((e) => ({ ...e, chat: alReenviar(e.chat) }));
        return responder();
      });
    };
    return responder();
  }

  /** Reintentar: si el servidor RECHAZÓ el último pedido con un HTTP y su motivo (el tope de mensajes, por ejemplo: el turno NO corrió), lo REENVÍA igual que estaba; el mensaje
   * ya está en la lista y no se duplica. Si no, con sesión RECUPERA —si el POST llegó y la red se cortó después, el turno corrió igual y volverlo a mandar lo
   * duplicaría—; sin sesión (falló el primer `abrir`), vuelve a abrir. */
  reintentar(): Promise<void> {
    const actual = this.e.chat;
    if (actual.ocupado) return Promise.resolve();
    const reenvio = this.reenvio;
    if (reenvio !== null && actual.cursor !== null) {
      this.reenvio = null;
      return reenvio();
    }
    this.cambiar((e) => ({ ...e, chat: alReintentar(e.chat) }));
    if (actual.cursor !== null) return this.consumir(this.d.cliente.recuperar(actual.cursor.id, actual.cursor.indice, this.aborto.signal), "rebobinado");
    const texto = this.ultimoIntentoSinSesion;
    if (texto === null) {
      this.cambiar((e) => ({ ...e, chat: alTerminarStream(e.chat) }));
      return Promise.resolve();
    }
    return this.consumir(this.d.cliente.abrir(texto, this.contextoDelTurno(), this.aborto.signal));
  }

  /** Después de un reporte (T0.7, D2): borra el cursor y deja los mensajes; el próximo envío abre otra sesión. */
  nuevaConversacion(): void {
    if (this.e.chat.ocupado) return;
    this.reenvio = null;
    this.cambiar((e) => ({ ...e, chat: alNuevaConversacion(e.chat) }));
  }

  // ── Adjuntos ─────────────────────────────────────────────────────────────────
  agregarElemento(el: ElementoSeleccionado): void {
    this.cambiar((e) => ({ ...e, adjuntos: agregarElemento(e.adjuntos, el) }));
  }
  agregarCaptura(imagen: ImagenLista): void {
    this.cambiar((e) => ({ ...e, adjuntos: agregarCaptura(e.adjuntos, imagen) }));
  }
  quitarAdjunto(clave: number): void {
    this.cambiar((e) => ({ ...e, adjuntos: quitar(e.adjuntos, clave) }));
  }
  reintentarAdjunto(clave: number): void {
    this.cambiar((e) => ({ ...e, adjuntos: marcar(e.adjuntos, clave, { estado: "pendiente" }) }));
  }

  get puedeCapturar(): boolean {
    const v = this.ventanaDelDom();
    return v !== null && puedeCapturarPantalla(v);
  }

  /** Señalar un elemento de la PÁGINA (§3.1). `alElegir` / `alCancelar` son para que quien dibuja pliegue y vuelva a abrir su panel. */
  senalar(o: { ignorar: Element | null; alElegir: () => void; alCancelar: () => void }): "iniciado" | "tope" | "no_disponible" | "no_permitido" {
    if (!this.e.permisos.elementos) return "no_permitido";
    if (!puedeAgregar(this.e.adjuntos)) return "tope";
    const documento = this.documento();
    const ventana = this.ventanaDelDom();
    if (documento === null || ventana === null) return "no_disponible";
    this.selector = iniciarSelector({
      documento,
      ignorar: o.ignorar,
      alElegir: (el) => {
        this.selector = null;
        this.agregarElemento(acotarElemento(extraerElemento(el, ventana)));
        o.alElegir();
      },
      alCancelar: () => {
        this.selector = null;
        o.alCancelar();
      },
      // Otro selector (quizá de otro chat de la misma página) tomó su lugar: para quien dibuja es una cancelación.
      alReemplazar: () => {
        this.selector = null;
        o.alCancelar();
      },
    });
    return "iniciado";
  }

  /** Capturar la pantalla (§3.2). `ocultar` / `mostrar` rodean SÓLO la toma del frame: la captura es de la página, no de la interfaz del chat,
   * y `mostrar` corre siempre (2.3.1). */
  async capturar(o: { recorte: RectDelElemento | null; ocultar: () => void; mostrar: () => void }): Promise<ResultadoDeAdjuntar> {
    await this.asegurarPermisos();
    if (!this.e.permisos.capturas) return "no_permitido";
    if (!puedeAgregar(this.e.adjuntos)) return "tope";
    const ventana = this.ventanaDelDom();
    const codificar = this.codificador();
    if (ventana === null || codificar === null) return "no_disponible";
    const r = await capturarOcultando<ImagenLista>({
      enCurso: this.capturaEnCurso,
      ocultar: o.ocultar,
      mostrar: o.mostrar,
      capturar: ({ antesDelFrame }) =>
        capturarPantalla(ventana, o.recorte, codificar, {
          permisoPendiente: this.permisoPendiente,
          antesDelFrame: async () => {
            antesDelFrame();
            await new Promise((resolver) => ventana.requestAnimationFrame(() => ventana.requestAnimationFrame(resolver)));
          },
        }),
    });
    if (r.tipo === "ocupado") return "ocupado";
    if (r.imagen === null) return "sin_captura"; // permiso denegado, cancelado, vencido, o no entró
    this.agregarCaptura(r.imagen);
    return "ok";
  }

  /** «Adjuntar imagen», el camino universal (§3.2). */
  async adjuntarImagen(archivo: File): Promise<ResultadoDeAdjuntar> {
    await this.asegurarPermisos();
    if (!this.e.permisos.capturas) return "no_permitido";
    if (!puedeAgregar(this.e.adjuntos)) return "tope";
    const ventana = this.ventanaDelDom();
    const codificar = this.codificador();
    if (ventana === null || codificar === null) return "no_disponible";
    const fuente = await imagenDesdeArchivo(archivo, ventana);
    const imagen = fuente === null ? null : await prepararImagen(fuente.fuente, { x: 0, y: 0, ancho: fuente.ancho, alto: fuente.alto }, codificar);
    if (imagen === null) return "imagen_invalida";
    this.agregarCaptura(imagen);
    return "ok";
  }

  // ── Por dentro ───────────────────────────────────────────────────────────────
  private documento(): Document | null {
    return this.d.documento ?? (typeof document === "undefined" ? null : document);
  }
  private ventanaDelDom(): Window | null {
    return this.d.ventanaDelDom ?? (typeof window === "undefined" ? null : window);
  }
  private codificador(): Codificar | null {
    const documento = this.documento();
    if (documento === null) return null;
    this.codificar ??= codificarConCanvas(documento);
    return this.codificar;
  }

  /** El `contexto` del turno: en TODOS, URL/navegador/versión/usuario declarado (§3.4) y el resumen acumulado de la evidencia (§3.3) si hay algo que contar. Un adjunto en `fallo` no cuenta.
   * Hasta la 2.3.x la URL sólo salía con el primer mensaje; el servidor la usaba en una sola llamada al modelo del turno y la perdía (diagnóstico «chat-contexto-ciego»). Ahora el servidor
   * la pone en una nota de sistema de CADA turno, así que la página actual tiene que viajar en cada mensaje (la persona puede cambiar de página a mitad de la charla). El reenvío al motor
   * como evidencia `contexto` sigue siendo sólo del primer turno (lo hace el backend). */
  private contextoDelTurno(): Record<string, string> | undefined {
    const ventana = this.d.ventana ?? { location: globalThis.location, navigator: globalThis.navigator };
    const base = resumenDeContexto(this.d.opciones, ventana, this.e.permisos);
    const evidencia = contextoDeEvidencia(this.e.adjuntos.adjuntos, this.e.permisos);
    if (evidencia === undefined) return base;
    return { ...(base ?? {}), ...evidencia };
  }

  private avisar(ev: EventoDelPreview): void {
    try {
      this.d.opciones.onEvento?.(ev);
    } catch {
      // el callback es del llamador (2.2.0): uno que lanza no tumba el chat
    }
  }

  /** Dos maneras de consumir un stream, que NO son lo mismo:
   *  · `turno` (abrir / seguir): la respuesta a UN mensaje. Termina en su borde; lo que el cuerpo mande después (o su demora en cerrarse) no retiene al chat.
   *  · `rebobinado` (recuperar): la HISTORIA de la conversación. Trae los bordes de los turnos viejos (`espera`) y sigue; sólo termina al llegar a la cola durable o al
   *    borde del turno vivo, y entonces el servidor cierra el cuerpo (revisión 2, P1-1). Durante ese tramo el chat NO queda libre en un borde histórico: un oyente que
   *    mandara o aprobara ahí lo haría sobre una charla a medio reconstruir. */
  private async consumir(eventos: AsyncIterable<EventoDelWidget>, modo: "turno" | "rebobinado" = "turno", reenvio?: () => Promise<void>): Promise<void> {
    // `espera` apaga `ocupado` y avisa a los oyentes ANTES de que este consumo termine: uno puede mandar el turno siguiente en ese mismo instante. Cada consumo
    // lleva su número y sólo escribe mientras siga siendo el vigente; si no, el `finally` de éste le cerraría el mensaje y el `ocupado` al turno nuevo.
    const mio = ++this.turno;
    this.reenvio = null;
    try {
      for await (const ev of eventos) {
        if (this.destruido || this.turno !== mio) return;
        if (reenvio !== undefined && ev.t === "error" && (ev as Partial<ErrorDeRechazo>).rechazado === true) this.reenvio = reenvio;
        this.avisar(ev);
        this.cambiar((e) => {
          const chat = reducir(e.chat, ev);
          return { ...e, chat: modo === "rebobinado" && ev.t === "espera" ? { ...chat, ocupado: true } : chat };
        });
        if (modo === "turno" && esBorde(ev)) break;
      }
    } catch (err) {
      if (!this.destruido && this.turno === mio) this.cambiar((e) => ({ ...e, chat: reducir(e.chat, { v: 1, t: "error", codigo: "red", mensaje: err instanceof Error ? err.message : String(err), terminal: false }) }));
    } finally {
      if (!this.destruido && this.turno === mio) this.cambiar((e) => ({ ...e, chat: alTerminarStream(e.chat) }));
    }
  }

  /** La única puerta de escritura del estado: aplica el cambio, corre los efectos que dependen de él y avisa. */
  private cambiar(f: (e: EstadoDelNucleo) => EstadoDelNucleo): void {
    if (this.destruido) return;
    const previo = this.e;
    const nuevo = f(previo);
    if (nuevo === previo || (nuevo.chat === previo.chat && nuevo.adjuntos === previo.adjuntos && nuevo.permisos === previo.permisos)) return;
    this.e = nuevo;
    this.efectos(previo, nuevo);
    for (const o of [...this.oyentes]) o();
  }

  private efectos(previo: EstadoDelNucleo, nuevo: EstadoDelNucleo): void {
    const { alError, almacen } = this.d;
    // El cursor a donde se guarda (sessionStorage en el navegador).
    if (nuevo.chat.cursor !== previo.chat.cursor) {
      if (almacen != null) guardarSesion(almacen.storage, almacen.clave, nuevo.chat.cursor);
      if (nuevo.chat.cursor !== null) this.ultimoIntentoSinSesion = null;
    }
    // Un error a mitad de charla también llega al desarrollador (§2.5).
    if (nuevo.chat.error !== previo.chat.error && nuevo.chat.error !== null) alError?.(nuevo.chat.error);

    // Cuando la sesión termina (`fin` o error terminal) la evidencia ya está en el motor o se perdió con ella: la barra arranca vacía para la
    // conversación siguiente. `siguienteClave` NO se reinicia (a diferencia de `sinAdjuntos()`): si el contador volviera a 1, una subida tardía
    // de la sesión anterior marcaría el adjunto NUEVO como subido con el id VIEJO. `enVuelo` se limpia por la misma razón.
    if (previo.chat.cursor !== null && nuevo.chat.cursor === null) {
      this.enVuelo.clear();
      this.cambiar((e) => ({ ...e, adjuntos: { adjuntos: [], siguienteClave: e.adjuntos.siguienteClave } }));
    }
    // El reporte se creó: lo que ya estaba subido FUE con él (el motor enlaza la evidencia al crearlo); lo que sube después, no.
    if (nuevo.chat.reportado && !previo.chat.reportado) this.cambiar((e) => ({ ...e, adjuntos: sellarReporte(e.adjuntos) }));

    this.subirPendientes();
  }

  /** Los adjuntos pendientes se suben cuando hay sesión (Revisión 2 punto 2): en el momento de adjuntar si ya hay cursor, o apenas llega
   * `sesion` si se adjuntó antes del primer mensaje. `enVuelo` evita subir dos veces el mismo entre el cambio de estado y el siguiente. */
  private subirPendientes(): void {
    const sesionId = this.e.chat.cursor?.id ?? null;
    if (sesionId === null) return;
    for (const a of pendientes(this.e.adjuntos)) {
      if (this.enVuelo.has(a.clave)) continue;
      this.enVuelo.add(a.clave);
      this.cambiar((e) => ({ ...e, adjuntos: marcar(e.adjuntos, a.clave, { estado: "subiendo" }) }));
      void this.subir(this.d.opciones, sesionId, a, { senal: this.aborto.signal, ...(this.d.sdk === undefined ? {} : { sdk: this.d.sdk }), ...(this.d.fetchFn === undefined ? {} : { fetchFn: this.d.fetchFn }) }).then((r) => {
        this.enVuelo.delete(a.clave);
        this.cambiar((e) => ({ ...e, adjuntos: marcar(e.adjuntos, a.clave, r.ok ? { estado: "listo", evidenciaId: r.evidenciaId } : { estado: "fallo", motivo: r.motivo, reintentable: r.reintentable }) }));
        // También al desarrollador (§2.5): una subida que falla siempre es un dato para quien instala.
        if (!r.ok && !this.destruido) this.d.alError?.({ codigo: `evidencia_${r.motivo}`, mensaje: "", terminal: false });
      });
    }
  }
}
