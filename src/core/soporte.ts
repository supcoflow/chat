import { crearCliente } from "../cliente";
import { diagnosticoDesdeRespuesta, permisosDesdeRespuesta } from "../estado-del-widget";
import { normalizarOpciones, type UsuarioDelChat } from "../opciones";
import { claveDeSesion, leerSesion, storageSeguro } from "../sesion-guardada";
import { ControladorDelChat, type ResultadoDeAdjuntar } from "./controlador";
import { consultarDisponibilidad } from "./disponibilidad";
import { estadoPublico, eventoPublico, permisosPublicos } from "./traducir";
import type { AttachResult, Availability, ChatCapabilities, ChatEvent, ChatState, ChatUser, PickResult, SupportChat, SupportChatOptions } from "./tipos";
import { cabeceraDelSdk } from "./version";

// El núcleo público: `createSupportChat` le pone nombres en inglés y una forma de almacén (getState/subscribe) al `ControladorDelChat`,
// que es el MISMO motor que usa el widget. Nada de dibujo: ni preact, ni react, ni CSS. Sirve en el navegador y, sin adjuntos ni
// almacenamiento, en Node (tests, SSR).

const CLAVES_RESERVADAS: ReadonlySet<string> = new Set(["id", "role", "name"]);

function usuario(u: ChatUser | undefined): UsuarioDelChat {
  // Whitelist: sólo `id`, `role` y `attributes` salen de acá (a `id`/`rol`/`atributos` del cable). Un llamador en JS puede pasar `name`
  // o lo que quiera: lo que no se nombra no viaja. No hay forma de declarar el nombre porque no tiene a dónde ir; y una clave de atributo
  // `name` tampoco (`normalizarUsuario` ya frena `id`, `rol` y `nombre`; acá se suman los nombres en inglés que la documentación promete).
  if (typeof u !== "object" || u === null) return {};
  const atributos = typeof u.attributes === "object" && u.attributes !== null ? Object.fromEntries(Object.entries(u.attributes).filter(([k]) => !CLAVES_RESERVADAS.has(k.trim()))) : undefined;
  return { id: u.id, rol: u.role, atributos };
}

/** El idioma de la app como viaja: un texto corto y legible, o nada. Lo que no lo es se descarta acá (el servidor igual lo trataría como inglés). */
function idiomaDeLaApp(locale: unknown): string | undefined {
  if (typeof locale !== "string") return undefined;
  const l = locale.trim();
  return l === "" || l.length > 35 || !/^[A-Za-z0-9_-]+$/.test(l) ? undefined : l;
}

/** Lo declarado por la app, tal como viaja: sólo cuenta lo que es EXACTAMENTE `true` (salvo `newConversation`, que vale `true` mientras no se diga `false`), y la captura necesita un navegador que pueda capturar. */
export function capacidadesOfrecidas(declaradas: ChatCapabilities | undefined, puedeCapturar: boolean): Record<"pickElement" | "screenshot" | "attachImage" | "newConversation", boolean> {
  const d = typeof declaradas === "object" && declaradas !== null ? declaradas : {};
  return { pickElement: d.pickElement === true, screenshot: d.screenshot === true && puedeCapturar, attachImage: d.attachImage === true, newConversation: d.newConversation !== false };
}

function almacen(s: SupportChatOptions["storage"]): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (s === "none") return null;
  if (s === undefined || s === "session") return storageSeguro();
  return s;
}

/** Un oyente que lanza no tumba el chat ni a los demás: su error se reporta como cualquier otro no capturado (`reportError`). */
function avisarA<T>(oyentes: Iterable<(x: T) => void>, x: T): void {
  for (const o of [...oyentes]) {
    try {
      o(x);
    } catch (e) {
      (typeof reportError === "function" ? reportError : console.error)(e);
    }
  }
}

const adjuntar: Record<ResultadoDeAdjuntar, AttachResult> = {
  ok: "ok",
  tope: "limit",
  sin_captura: "no_capture",
  imagen_invalida: "invalid_image",
  ocupado: "busy",
  no_disponible: "unavailable",
  no_permitido: "not_allowed",
};

export function createSupportChat(options: SupportChatOptions): SupportChat {
  if (typeof options.tenantId !== "string" || options.tenantId.trim() === "") throw new Error("createSupportChat: missing `tenantId`.");
  if (typeof options.projectId !== "string" || options.projectId.trim() === "") throw new Error("createSupportChat: missing `projectId`.");

  const oyentesDeEventos = new Set<(e: ChatEvent) => void>();
  const opciones = normalizarOpciones({
    tenantId: options.tenantId,
    projectId: options.projectId,
    backendUrl: options.backendUrl,
    usuario: usuario(options.user),
    contexto: options.appVersion === undefined ? undefined : { versionApp: options.appVersion },
    contextoAutomatico: options.autoContext,
    onEvento: (ev) => {
      if (ev.t === "enviado" || ev.t === "respondido") return; // lo que se MANDÓ es del preview, no un evento del stream
      const e = eventoPublico(ev);
      if (e !== null) avisarA(oyentesDeEventos, e);
    },
  });
  const fetchFn = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sdk = cabeceraDelSdk("core");
  const storage = almacen(options.storage);
  const clave = claveDeSesion(opciones.tenantId, opciones.projectId);
  const guardado = options.resume === false || storage === null ? null : leerSesion(storage, clave);

  const controlador: ControladorDelChat = new ControladorDelChat({
    cliente: crearCliente(opciones, fetchFn, {
      sdk,
      ...(idiomaDeLaApp(options.locale) === undefined ? {} : { locale: idiomaDeLaApp(options.locale)! }),
      // T7: lo que esta interfaz ofrece, leído en cada pedido. La captura sólo si el navegador PUEDE capturar; `newConversation` la exige el contrato (P8): vale `true` salvo que se diga `false`.
      capacidades: () => capacidadesOfrecidas(options.capabilities, controlador.puedeCapturar),
    }),
    opciones,
    cursorInicial: guardado,
    almacen: storage === null ? null : { storage, clave },
    sdk,
    fetchFn,
    // Lo que el acuerdo de datos deja tomar de la página. Se sabe por `checkAvailability()` o, si nadie lo llamó, por UN sondeo de `GET /api/chat/estado` antes de la primera acción que
    // podría mandar algo (enviar, adjuntar, señalar): así el primer mensaje no lleva la URL ni el navegador a un servidor que los va a tirar. Un fallo del sondeo no frena nada (queda «todo»,
    // como en la 2.2.1; el servidor filtra igual) y NO se reintenta.
    sondearPermisos: async () => {
      const r = await consultarDisponibilidad(opciones, fetchFn);
      return !r.huboError && r.cuerpo?.ok === true ? permisosDesdeRespuesta(r.cuerpo) : null;
    },
  });

  let internoPrevio = controlador.estado();
  let publico: ChatState = estadoPublico(internoPrevio);
  const leer = (): ChatState => {
    const interno = controlador.estado();
    if (interno !== internoPrevio) {
      // Primero se traduce y SÓLO si salió bien se adelanta la caché: si la traducción lanzara, no quedaría una instantánea vieja atada al estado nuevo.
      publico = estadoPublico(interno);
      internoPrevio = interno;
    }
    return publico;
  };

  // Una respuesta va atada a la pregunta que el usuario VIO (`id`), no a «la que esté pendiente»: si la pregunta cambió (el borrador que rechazó, y otro nuevo),
  // un botón viejo no manda nada (revisión 1, P1-1). El servidor además sólo acepta la aprobación vigente, pero acá no se le pide que rescate un id sustituido.
  const responder = (id: string, r: { optionId?: string; text?: string }): Promise<void> => {
    const p = controlador.estado().chat.pregunta;
    if (p === null || p.requestId !== id) return Promise.resolve();
    // Se contesta SÓLO lo que se preguntó: una opción que no existe, o texto donde no se admite, no se manda.
    if (r.optionId !== undefined) {
      if (!p.opciones.some((o) => o.id === r.optionId)) return Promise.resolve();
      return controlador.responder({ requestId: p.requestId, optionId: r.optionId });
    }
    if (typeof r.text === "string" && r.text.trim() !== "" && p.libre) return controlador.responder({ requestId: p.requestId, text: r.text.trim() });
    return Promise.resolve();
  };
  const contestarElReporte = (id: string, optionId: "approve" | "cancel"): Promise<void> => {
    const p = controlador.estado().chat.pregunta;
    return p !== null && p.kind === "tool-approval" ? responder(id, { optionId }) : Promise.resolve();
  };

  // El selector de elementos se cancela EN SILENCIO cuando otro lo reemplaza o cuando se destruye el chat: sin esto la promesa de `pickElement` quedaría
  // colgada para siempre. Se guarda cómo resolver la que está esperando y se la resuelve «cancelled» en esos dos casos.
  let cancelarEleccion: (() => void) | null = null;

  return {
    getState: leer,
    subscribe(listener) {
      const baja = controlador.suscribir(() => avisarA([listener], leer()));
      return baja;
    },
    onEvent(listener) {
      oyentesDeEventos.add(listener);
      return () => void oyentesDeEventos.delete(listener);
    },
    ready: options.resume === false ? Promise.resolve() : controlador.reanudar(),

    send: (text) => controlador.enviar(text.trim()),
    answer: responder,
    confirmReport: (id) => contestarElReporte(id, "approve"),
    reviseReport: (id) => contestarElReporte(id, "cancel"),
    retry: () => controlador.reintentar(),
    newConversation: () => controlador.nuevaConversacion(),
    async checkAvailability(): Promise<Availability> {
      const r = await consultarDisponibilidad(opciones, fetchFn);
      const d = diagnosticoDesdeRespuesta(r);
      if (d.visible) controlador.fijarPermisos(permisosDesdeRespuesta(r.cuerpo));
      return { available: d.visible, status: d.status, reason: d.motivo, allows: permisosPublicos(controlador.estado().permisos) };
    },

    canCaptureScreen: () => controlador.puedeCapturar,
    attachImage: async (file) => adjuntar[await controlador.adjuntarImagen(file)],
    attachScreenshot: async (o) => adjuntar[await controlador.capturar({ recorte: o?.crop ?? null, ocultar: o?.hideUi ?? (() => {}), mostrar: o?.showUi ?? (() => {}) })],
    pickElement(o): Promise<PickResult> {
      cancelarEleccion?.();
      const iniciar = (): Promise<PickResult> => {
        cancelarEleccion?.(); // otro `pickElement` pudo arrancar mientras se sondeaba el acuerdo
        return new Promise((resolver) => {
          const r = controlador.senalar({
            ignorar: o?.ignore ?? null,
            alElegir: () => { cancelarEleccion = null; resolver("picked"); },
            alCancelar: () => { cancelarEleccion = null; resolver("cancelled"); },
          });
          if (r === "tope") resolver("limit");
          else if (r === "no_permitido") resolver("not_allowed");
          else if (r === "no_disponible") resolver("unavailable");
          else cancelarEleccion = () => { cancelarEleccion = null; resolver("cancelled"); };
        });
      };
      // Con el acuerdo ya sabido el selector se abre en el acto; si no, después del sondeo (una sola vez).
      const listos = controlador.asegurarPermisos();
      return listos === null ? iniciar() : listos.then(iniciar);
    },
    removeAttachment: (id) => controlador.quitarAdjunto(id),
    retryAttachment: (id) => controlador.reintentarAdjunto(id),

    destroy: () => {
      cancelarEleccion?.();
      controlador.destruir();
    },
  };
}
