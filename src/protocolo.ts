// El formato v1 entre el backend del chat y el widget (§1.5 del diseño). Una línea JSON por
// evento, `v: 1` en TODAS (un lector que se reengancha a mitad no vio la primera). Vive acá
// una sola vez: el backend lo importa como TIPO y nada más — importar una función de este
// paquete metería el bundle entero del widget en una route de servidor.
//
// Regla de compatibilidad: dentro de v1 sólo se AGREGAN eventos o campos opcionales; nunca se
// renombra ni se quita. Los widgets ya instalados cachean widget.js cinco minutos y la versión
// de npm indefinidamente; a esos los protege el `v`, no el tipo.

/** La versión del formato del cable: el `v` de cada línea. Dentro de la misma versión sólo se agrega. */
export const PROTOCOL_VERSION = 1;

export interface OpcionDePregunta {
  id: string;
  label: string;
  style: "danger" | "default" | "primary";
}

/** Lo que se manda si la persona confirma: título y cuerpo tal cual los escribió el asistente, sin marco ni retoque. */
export interface ReporteDeLaConfirmacion {
  titulo: string;
  cuerpo: string;
}

/** `id` es el sessionId durable de Eve; `indice`, su índice absoluto de eventos. Para el widget
 * son un id y un número que se guardan y se devuelven tal cual. */
export interface CursorDeSesion {
  id: string;
  indice: number;
}

export type EventoDelWidget =
  | { v: 1; t: "sesion"; id: string; indice: number }
  | { v: 1; t: "usuario"; texto: string }
  | { v: 1; t: "texto"; delta: string }
  | { v: 1; t: "asistente"; texto: string }
  | {
      v: 1;
      t: "pregunta";
      requestId: string;
      kind: "question" | "session-limit" | "tool-approval";
      prompt: string;
      opciones: OpcionDePregunta[];
      libre: boolean;
      /** T3 (aditivo en v1): sólo en la confirmación del reporte. El título y el cuerpo EXACTOS que se mandan, por separado (`prompt` los lleva pegados, con un marco). Un backend anterior no lo manda. */
      reporte?: ReporteDeLaConfirmacion;
    }
  | { v: 1; t: "pregunta_resuelta"; requestId: string; outcome: string; optionId?: string; text?: string }
  | {
      v: 1;
      /** 2.2.0: una herramienta que el agente llamó. El backend lo emite SÓLO en sesiones de
       * preview (la regla del sitio ajeno —«se dibuja texto y nada más»— sigue en pie afuera).
       * El reducer lo ignora; lo consume `onEvento`. */
      t: "herramienta";
      nombre: string;
      resumen: string;
      resultado?: string;
    }
  /** 2.3.0 (spec §6 de la etapa 1): vocabulario CERRADO, sin datos del modelo — por eso salen
   * también en el sitio ajeno, a diferencia de `herramienta`. `actividad` la emite el backend al
   * ver la llamada a `orientar`; el widget dice «Reading the support guide…» hasta el próximo texto. */
  | { v: 1; t: "actividad"; que: "leyendo_la_guia" }
  /** Un paso que el agente DIO, de vocabulario cerrado: cada uno sale sólo cuando el código vio el hecho (no el intento) y no lleva
   * argumentos, resultados ni razonamiento. `guia_leida`: `orientar` devolvió el detalle de una sección (`seccion` es el nombre de la
   * guía, no lo que escribió el modelo; no sale si no se leyó ninguna). `resumen_preparado`: el borrador del reporte quedó armado y se
   * le muestra al usuario para que confirme (NO es que se haya enviado: eso es `desenlace`). `pregunta_anotada`: `resolver` anotó
   * una pregunta sin cubrir y el motor lo confirmó. El widget los dibuja como una línea sobre la respuesta que sigue. */
  | { v: 1; t: "paso"; que: "guia_leida"; seccion: string }
  | { v: 1; t: "paso"; que: "resumen_preparado" }
  | { v: 1; t: "paso"; que: "pregunta_anotada" }
  /** 2.3.0: `reportado` sale DESPUÉS de que el motor contestó `ok` (nunca en preview ni en un
   * duplicado), con el id del reporte o `null`; `respondida`, cuando `resolver` anota `resuelta`.
   * El widget dibuja una tarjeta y un chip fijos: el texto es del widget, no del modelo. */
  | { v: 1; t: "desenlace"; que: "reportado"; reporte: string | null }
  | { v: 1; t: "desenlace"; que: "respondida" }
  | { v: 1; t: "espera"; indice: number }
  | { v: 1; t: "fin" }
  | { v: 1; t: "error"; codigo: string; mensaje: string; terminal: boolean };

// Las listas CERRADAS del formato v1, como valores. Cada `Record<..., true>` obliga al compilador a exigir una entrada por miembro de la unión:
// agregar un evento (o un `que`) sin agregarlo acá no compila, y `contrato.test.ts` exige que además esté documentado en
// `docs/protocol-v1.md` y tenga un escenario grabado. Así cambiar el protocolo sin tocar su documento hace fallar un test (plan de las tres formas, B3).
type ConQue<T extends EventoDelWidget["t"]> = Extract<EventoDelWidget, { t: T }> extends { que: infer Q } ? Q & string : never;

export const TIPOS_DE_EVENTO_V1: Readonly<Record<EventoDelWidget["t"], true>> = {
  sesion: true,
  usuario: true,
  texto: true,
  asistente: true,
  pregunta: true,
  pregunta_resuelta: true,
  herramienta: true,
  actividad: true,
  paso: true,
  desenlace: true,
  espera: true,
  fin: true,
  error: true,
};
export const ACTIVIDADES_V1: Readonly<Record<ConQue<"actividad">, true>> = { leyendo_la_guia: true };
export const PASOS_V1: Readonly<Record<ConQue<"paso">, true>> = { guia_leida: true, resumen_preparado: true, pregunta_anotada: true };
export const DESENLACES_V1: Readonly<Record<ConQue<"desenlace">, true>> = { reportado: true, respondida: true };

/** Los códigos de `error` (y de los fallos HTTP, que el cliente vuelve un `error` no terminal con el `motivo` del cuerpo) que la documentación explica.
 * NO es una lista cerrada: un código que no está acá se trata como un fallo genérico (puede aparecer uno nuevo sin cambiar de versión). */
export const CODIGOS_DE_ERROR_V1: readonly string[] = [
  "red",
  "sesion_vencida",
  "limite_de_sesion",
  "tope_de_mensajes",
  "confirmacion_no_vigente",
  "origen_no_admitido",
  "chat_deshabilitado",
  "proyecto_desconocido",
  "motor_inalcanzable",
  "stream_cortado",
  "traductor_fallo",
  "stream_fallo",
];

/** Un borde cierra el stream: `espera`, `fin`, o un `error` terminal. Un error NO terminal
 * (`step.failed`) sigue con `espera`, así que no cierra. */
export function esBorde(e: EventoDelWidget): boolean {
  return e.t === "espera" || e.t === "fin" || (e.t === "error" && e.terminal);
}

/** Lo que `onEvento` entrega (2.2.0): cada evento v1 consumido, más dos sintéticos con lo que el
 * widget MANDÓ — sin ellos la actividad del preview vería las respuestas y no las preguntas. */
export type EventoDelPreview =
  | EventoDelWidget
  | { t: "enviado"; texto: string; contexto?: Record<string, string> }
  | { t: "respondido"; requestId: string; optionId?: string; text?: string };
