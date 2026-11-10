import type { CursorDeSesion, EventoDelWidget, OpcionDePregunta, ReporteDeLaConfirmacion } from "./protocolo";
import { TEXTOS } from "./textos";

// TODO el estado del chat, en puro: los componentes dibujan `EstadoDelChat` y llaman a estas
// funciones. Lo que en la 1.x era el reducer de partes de Eve acá son nueve `case`, porque el
// backend ya digirió el stream (§1.5 del diseño).

/** 2.3.0: lo que el widget dibuja como ítem fijo al cerrar un camino (spec §6 de la etapa 1). */
export type Desenlace = { que: "reportado"; reporte: string | null } | { que: "respondida" };

/** Un paso que el agente dio y el widget dibuja como una línea sobre la respuesta que sigue («Read the guide · Billing»). Es el
 * evento `paso` ya validado: el vocabulario es cerrado y lo que no se conoce no se dibuja. */
export type Paso = { que: "guia_leida"; seccion: string } | { que: "resumen_preparado" } | { que: "pregunta_anotada" };

/** Cuántos pasos lleva una respuesta como máximo, y cuántos caracteres tiene el nombre de una sección: el texto de la guía es del
 * cliente y la línea tiene que seguir siendo una línea. */
const MAX_PASOS = 5;
const MAX_SECCION = 60;

export type Mensaje =
  | {
      clave: number;
      rol: "usuario" | "asistente";
      texto: string;
      /** asistente: todavía llegan deltas. usuario: mandado y todavía no confirmado por `usuario`. */
      abierto: boolean;
      /** asistente: lo que el agente hizo en el turno de esta respuesta (la toma la próxima burbuja nueva, o la última del turno al cerrarse). */
      pasos?: Paso[];
      /** asistente (T6): este mensaje es la copia de la confirmación del reporte (el prompt de una `tool-approval`). Se dibuja como texto plano, también después de contestarla: lo que la persona lee es lo que se manda. */
      copiaDelReporte?: true;
    }
  | { clave: number; rol: "desenlace"; desenlace: Desenlace; abierto: false };

/** Lo que el agente está haciendo y el widget dice en lugar de «Typing…» (2.3.0). */
export type Actividad = "leyendo_la_guia";

/** El texto fijo de un paso (en inglés, como el resto del widget). La sección va después de un punto medio, como en la landing. */
export function textoDelPaso(p: Paso): string {
  switch (p.que) {
    case "guia_leida":
      return `${TEXTOS.guiaLeida} · ${p.seccion}`;
    case "resumen_preparado":
      return TEXTOS.resumenPreparado;
    case "pregunta_anotada":
      return TEXTOS.preguntaAnotada;
  }
}

export interface PreguntaPendiente {
  requestId: string;
  /** De qué es la pregunta: `tool-approval` es la confirmación del reporte (el widget le agrega lo que acompaña al envío). */
  kind: string;
  opciones: OpcionDePregunta[];
  libre: boolean;
  /** T3: el título y el cuerpo exactos de la confirmación del reporte, si el backend los manda. */
  reporte?: ReporteDeLaConfirmacion;
}

export interface ErrorVisible {
  codigo: string;
  mensaje: string;
  terminal: boolean;
}

export interface EstadoDelChat {
  mensajes: Mensaje[];
  pregunta: PreguntaPendiente | null;
  ocupado: boolean;
  error: ErrorVisible | null;
  /** `null` = el próximo mensaje abre una sesión nueva. */
  cursor: CursorDeSesion | null;
  siguienteClave: number;
  /** 2.3.0: vive hasta el próximo texto del asistente (o el fin del turno). */
  actividad: Actividad | null;
  /** Pasos que llegaron y todavía no tienen la respuesta a la que pegarse: la próxima burbuja NUEVA del asistente los toma o, si no llega ninguna, al cerrarse el turno se pegan a la última del turno. No cruzan turnos. */
  pasos: Paso[];
  /** 2.3.1: la sesión ACTUAL ya tiene su reporte (llegó el desenlace `reportado`). El motor enlaza la evidencia al crearlo, así que desde acá no se ofrece adjuntar más. Una sesión nueva
   * (`sesion`) o «New conversation» lo apagan. */
  reportado: boolean;
}

export function estadoInicial(cursor: CursorDeSesion | null): EstadoDelChat {
  return { mensajes: [], pregunta: null, ocupado: false, error: null, cursor, siguienteClave: 1, actividad: null, pasos: [], reportado: false };
}

type SinClave<T> = T extends unknown ? Omit<T, "clave"> : never;

function agregar(e: EstadoDelChat, m: SinClave<Mensaje>): EstadoDelChat {
  // Una burbuja NUEVA del asistente toma los pasos que esperaban; lo demás (usuario, desenlace) los deja para la próxima.
  const toma = m.rol === "asistente" && e.pasos.length > 0;
  const nuevo = { ...m, ...(toma ? { pasos: e.pasos } : {}), clave: e.siguienteClave } as Mensaje;
  return { ...e, mensajes: [...e.mensajes, nuevo], siguienteClave: e.siguienteClave + 1, ...(toma ? { pasos: [] } : {}) };
}

/** El evento `paso` validado contra el vocabulario cerrado; `null` si no se conoce o viene mal formado. */
function pasoValido(ev: Extract<EventoDelWidget, { t: "paso" }>): Paso | null {
  const raw = ev as { que?: unknown; seccion?: unknown };
  if (raw.que === "resumen_preparado" || raw.que === "pregunta_anotada") return { que: raw.que };
  if (raw.que === "guia_leida" && typeof raw.seccion === "string") {
    const nombre = Array.from(raw.seccion.replace(/\s+/g, " ").trim());
    if (nombre.length === 0) return null;
    return { que: "guia_leida", seccion: nombre.length <= MAX_SECCION ? nombre.join("") : `${nombre.slice(0, MAX_SECCION - 1).join("").trimEnd()}…` };
  }
  return null;
}

function agregarPaso(e: EstadoDelChat, p: Paso): EstadoDelChat {
  if (e.pasos.length >= MAX_PASOS) return e;
  if (e.pasos.some((x) => x.que === p.que && (x.que !== "guia_leida" || (p.que === "guia_leida" && x.seccion === p.seccion)))) return e;
  return { ...e, pasos: [...e.pasos, p] };
}

function ultimo(e: EstadoDelChat): Mensaje | undefined {
  return e.mensajes[e.mensajes.length - 1];
}

function reemplazarUltimo(e: EstadoDelChat, m: Mensaje): EstadoDelChat {
  return { ...e, mensajes: [...e.mensajes.slice(0, -1), m] };
}

function cerrarAbiertos(e: EstadoDelChat): EstadoDelChat {
  return e.mensajes.some((m) => m.abierto) ? { ...e, mensajes: e.mensajes.map((m) => (m.abierto ? { ...m, abierto: false } : m)) } : e;
}

/** Un turno del usuario que llega del stream (`usuario`, o la etiqueta de `pregunta_resuelta`):
 * confirma el optimista si es el mismo texto; si no, es historia recuperada y se agrega. */
function turnoDelUsuario(e: EstadoDelChat, texto: string): EstadoDelChat {
  const u = ultimo(e);
  if (u !== undefined && u.rol === "usuario" && u.abierto && u.texto === texto) return reemplazarUltimo(e, { ...u, abierto: false });
  return agregar(e, { rol: "usuario", texto, abierto: false });
}

/** Optimista: lo que el usuario escribió se ve ya, y `usuario` lo confirma después (§2.4: nunca
 * se pierde lo escrito). */
export function alEnviar(e: EstadoDelChat, texto: string): EstadoDelChat {
  return { ...agregar(e, { rol: "usuario", texto, abierto: true }), ocupado: true, error: null, actividad: null, pasos: [] };
}

// Un pedido nuevo arranca sin actividad: la de un stream anterior no es de este turno.
export function alResponder(e: EstadoDelChat): EstadoDelChat {
  return { ...e, ocupado: true, error: null, actividad: null, pasos: [] };
}

export function alReintentar(e: EstadoDelChat): EstadoDelChat {
  return { ...e, ocupado: true, error: null, actividad: null, pasos: [] };
}

/** Reenviar un mensaje que el servidor RECHAZÓ antes de correr el turno: vuelve a quedar «pendiente» (`abierto`) el mismo mensaje del usuario, para que el `usuario` que el
 * servidor mande al aceptarlo lo CONFIRME en vez de agregarlo de nuevo. Sin `texto` (se reenvía la respuesta a una pregunta) no hay mensaje que reabrir. */
export function alReenviar(e: EstadoDelChat, texto?: string): EstadoDelChat {
  const u = ultimo(e);
  const base = texto !== undefined && u !== undefined && u.rol === "usuario" && !u.abierto && u.texto === texto ? reemplazarUltimo(e, { ...u, abierto: true }) : e;
  return alReintentar(base);
}

/** T0.7 (D2): después de un reporte, el usuario puede empezar otra conversación sin recargar (recargar
 * retoma la MISMA sesión y lo dejaba trabado). Se borra el cursor —el widget lo saca de sessionStorage— y
 * los mensajes quedan a la vista; el próximo envío llama a *abrir*. */
export function alNuevaConversacion(e: EstadoDelChat): EstadoDelChat {
  return { ...e, cursor: null, pregunta: null, error: null, actividad: null, pasos: [], ocupado: false, reportado: false };
}

/** El cuerpo HTTP terminó, con borde o sin él: nada más va a llegar por este stream. */
export function alTerminarStream(e: EstadoDelChat): EstadoDelChat {
  return { ...cerrarAbiertos(e), ocupado: false, actividad: null, pasos: [] };
}

/** Los eventos que apagan la actividad: texto del asistente, una pregunta, o el fin del turno. Lista
 * POSITIVA (revisión de F0, hallazgo 1): un `t` de un v1 futuro tiene que dejar el estado intacto. */
const APAGAN_LA_ACTIVIDAD: ReadonlySet<string> = new Set(["texto", "asistente", "pregunta", "espera", "fin", "error"]);

/** El id que se muestra en la tarjeta: `rep_` + 16 hex hoy (spec §7). Se acepta cualquier texto
 * corto, para no atar el widget al formato; lo que no es texto o pasa de 64 queda en `null` y la
 * tarjeta dice sólo la frase. */
function idDeReporte(r: unknown): string | null {
  return typeof r === "string" && r !== "" && r.length <= 64 ? r : null;
}

/** Los eventos que cierran el turno o lo reinician: los pasos que no encontraron respuesta no se arrastran al siguiente. */
const SOLTAR_LOS_PASOS: ReadonlySet<string> = new Set(["usuario", "espera", "fin"]);

/** Al cerrarse el turno (`espera`/`fin`), los pasos que llegaron DESPUÉS de la respuesta se pegan a la última burbuja del asistente DE ESTE turno
 * (la que viene después del último mensaje del usuario). Es el orden habitual del modelo: escribe y recién después anota la pregunta con `resolver`
 * (revisión de la vuelta 1, P2-1). Sin burbuja en el turno no se pegan a nada: no cruzan al turno anterior. */
function pegarALaUltimaBurbuja(e: EstadoDelChat): EstadoDelChat {
  const desdeUsuario = e.mensajes.map((m) => m.rol).lastIndexOf("usuario");
  for (let i = e.mensajes.length - 1; i > desdeUsuario; i--) {
    const m = e.mensajes[i]!;
    if (m.rol !== "asistente") continue;
    let pasos = m.pasos ?? [];
    for (const p of e.pasos) pasos = agregarPaso({ ...e, pasos }, p).pasos;
    return { ...e, mensajes: e.mensajes.map((x, j) => (j === i ? { ...m, pasos } : x)) };
  }
  return e;
}

export function reducir(e: EstadoDelChat, ev: EventoDelWidget): EstadoDelChat {
  let r = reducirEvento(e, ev);
  if (r.actividad !== null && APAGAN_LA_ACTIVIDAD.has(ev.t)) r = { ...r, actividad: null };
  if (r.pasos.length > 0 && (ev.t === "espera" || ev.t === "fin")) r = pegarALaUltimaBurbuja(r);
  if (r.pasos.length > 0 && (SOLTAR_LOS_PASOS.has(ev.t) || (ev.t === "error" && ev.terminal))) r = { ...r, pasos: [] };
  return r;
}

function reducirEvento(e: EstadoDelChat, ev: EventoDelWidget): EstadoDelChat {
  switch (ev.t) {
    case "sesion":
      // `sesion` sólo llega al ABRIR una sesión nueva: el reporte de la anterior no es de ésta.
      return { ...e, cursor: { id: ev.id, indice: ev.indice }, reportado: e.cursor?.id === ev.id ? e.reportado : false };
    case "usuario":
      return turnoDelUsuario(e, ev.texto);
    case "texto": {
      const u = ultimo(e);
      if (u !== undefined && u.rol === "asistente" && u.abierto) return reemplazarUltimo(e, { ...u, texto: u.texto + ev.delta });
      return agregar(e, { rol: "asistente", texto: ev.delta, abierto: true });
    }
    case "asistente": {
      // El texto final reemplaza lo acumulado (o es lo único que hay, al recuperar).
      const u = ultimo(e);
      if (u !== undefined && u.rol === "asistente" && u.abierto) return reemplazarUltimo(e, { ...u, texto: ev.texto, abierto: false });
      return agregar(e, { rol: "asistente", texto: ev.texto, abierto: false });
    }
    case "pregunta":
      // El prompt es un mensaje (así sobrevive a la resolución y a la recarga); los botones, aparte.
      return { ...agregar(cerrarAbiertos(e), { rol: "asistente", texto: ev.prompt, abierto: false, ...(ev.kind === "tool-approval" ? { copiaDelReporte: true as const } : {}) }), pregunta: { requestId: ev.requestId, kind: ev.kind, opciones: ev.opciones, libre: ev.libre, ...(ev.reporte === undefined ? {} : { reporte: ev.reporte }) } };
    case "pregunta_resuelta": {
      const elegida = e.pregunta?.requestId === ev.requestId ? e.pregunta.opciones.find((o) => o.id === ev.optionId) : undefined;
      const texto = elegida?.label ?? ev.text;
      const sinPregunta = { ...e, pregunta: null };
      return texto === undefined ? sinPregunta : turnoDelUsuario(sinPregunta, texto);
    }
    case "actividad":
      // Vocabulario cerrado: lo que no se conoce no se dibuja.
      return ev.que === "leyendo_la_guia" ? { ...e, actividad: ev.que } : e;
    case "paso": {
      // Vocabulario cerrado, como `actividad`: lo que no se conoce no se dibuja.
      const p = pasoValido(ev);
      return p === null ? e : agregarPaso(e, p);
    }
    case "desenlace":
      // Un ítem fijo: cierra la burbuja abierta del asistente, como una pregunta.
      if (ev.que === "reportado") return { ...agregar(cerrarAbiertos(e), { rol: "desenlace", desenlace: { que: "reportado", reporte: idDeReporte(ev.reporte) }, abierto: false }), reportado: true };
      if (ev.que === "respondida") return agregar(cerrarAbiertos(e), { rol: "desenlace", desenlace: { que: "respondida" }, abierto: false });
      return e;
    case "espera":
      return { ...cerrarAbiertos(e), ocupado: false, cursor: e.cursor === null ? null : { id: e.cursor.id, indice: ev.indice } };
    case "fin":
      return { ...cerrarAbiertos(e), ocupado: false, cursor: null };
    case "error": {
      const conError = { ...e, error: { codigo: ev.codigo, mensaje: ev.mensaje, terminal: ev.terminal } };
      return ev.terminal ? { ...cerrarAbiertos(conError), ocupado: false, cursor: null } : conError;
    }
    default:
      // Un `t` de un v1 futuro: se ignora, es la regla de compatibilidad del protocolo.
      return e;
  }
}

/** 2.3.0 (T0.2): el texto que se le muestra al usuario por un error. Lo decide el CÓDIGO, nunca el
 * `mensaje` del backend (que puede venir de eve o del motor, en cualquier idioma). Los códigos
 * son los que el backend emite hoy (`src/traductor/`, la admisión del motor); uno desconocido cae
 * a «Couldn't send», que es lo que el widget decía para todo lo que no era `sesion_vencida`. */
export function textoDelError(codigo: string): string {
  switch (codigo) {
    case "sesion_vencida":
      return TEXTOS.sesionVencida;
    case "limite_de_sesion":
      return TEXTOS.limiteDeSesion;
    case "tope_de_mensajes":
      return TEXTOS.topeDeMensajes;
    case "confirmacion_no_vigente":
      return TEXTOS.confirmacionVencida;
    case "ia_no_disponible":
    case "ia_sin_configurar":
      return TEXTOS.asistenteNoDisponible;
    case "origen_no_admitido":
    case "chat_deshabilitado":
    case "proyecto_desconocido":
      return TEXTOS.chatNoDisponible;
    default:
      return TEXTOS.errorDeEnvio;
  }
}

/** ¿Tiene sentido ofrecer «Retry» para este error? No si es terminal, y tampoco para los dos de la IA del cliente (`ia_no_disponible`, `ia_sin_configurar`): el backend los manda NO terminales
 * (la charla sigue). Si el turno falló dentro de eve, «Retry» sólo rebobina desde la `espera`, que ya está DESPUÉS del error: lo borra sin volver a pedir el turno y deja el mensaje sin
 * respuesta. Si fue la admisión la que rechazó el mensaje, «Retry» lo reenviaría, pero el arreglo (clave, saldo, configuración) es del cliente y la frase ya dice «try again later»;
 * escribir de nuevo sigue andando. */
export function reintentarSirve(error: ErrorVisible): boolean {
  return !error.terminal && error.codigo !== "ia_no_disponible" && error.codigo !== "ia_sin_configurar";
}

/** Entre Enviar y el primer token pasan 4-8 s en el peor caso (medido en la 1.x): sin indicador
 * se lee como "se rompió el botón". Se apaga con el primer texto del asistente. */
export function mostrarIndicador(e: EstadoDelChat): boolean {
  if (!e.ocupado) return false;
  const u = ultimo(e);
  return !(u !== undefined && u.rol === "asistente" && u.abierto && u.texto.length > 0);
}

/** 2.2.0, §3.3 del spec: la pantalla de inicio se muestra sólo cuando no hay NADA que mostrar —
 * ni cursor guardado (una charla que sigue) ni mensajes (una charla que terminó y se sigue
 * leyendo, o un optimista en vuelo). Después de `fin` el cursor vuelve a null pero los mensajes
 * quedan: la charla terminada se lee hasta que el usuario escribe de nuevo. */
export function mostrarInicio(e: EstadoDelChat): boolean {
  return e.cursor === null && e.mensajes.length === 0;
}

export interface GrupoDeMensajes {
  rol: Mensaje["rol"];
  mensajes: Mensaje[];
}

/** Consecutivos del mismo rol en un grupo: el avatar va una vez por grupo y la esquina de 6 px
 * sólo en la última burbuja (§3.5 del spec). */
export function agruparMensajes(mensajes: Mensaje[]): GrupoDeMensajes[] {
  const grupos: GrupoDeMensajes[] = [];
  for (const m of mensajes) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo !== undefined && ultimo.rol === m.rol && m.rol !== "desenlace") ultimo.mensajes.push(m);
    else grupos.push({ rol: m.rol, mensajes: [m] });
  }
  return grupos;
}
