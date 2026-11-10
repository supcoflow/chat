// Todos los textos fijos del widget en un solo lugar (§11 del diseño: i18n barata después). Desde
// la 2.3.0, SIEMPRE en inglés (decisión 2 del dueño, 2026-10-28: sin selector por proyecto); el
// idioma de las RESPUESTAS lo decide el agente según quien escribe. Esto es sólo el marco, y su
// inventario exacto está en textos.test.ts.
export const TEXTOS = Object.freeze({
  abrir: "Open the help chat",
  cerrar: "Close",
  minimizar: "Minimize",
  placeholder: "Ask or tell us what happened…",
  enviar: "Send",
  pensando: "Thinking…",
  errorDeEnvio: "Couldn't send. Try again.",
  sesionVencida: "The previous conversation expired. Write to start a new one.",
  reintentar: "Retry",
  respuestaLibre: "Type your answer…",
  responder: "Reply",
  esUnaMaquina: "You're talking to an automated assistant.",
  preview: "Preview",
  // Evidencia (§3)
  senalar: "Pick an element",
  seleccionando: "Click the element that isn't working. Esc to cancel.",
  adjuntar: "Attach",
  capturarPantalla: "Take a screenshot",
  capturarElemento: "Capture this element",
  adjuntarImagen: "Attach an image",
  quitar: "Remove",
  pendiente: "Pending",
  subiendo: "Uploading…",
  adjuntado: "Attached",
  // 2.4.0: lo que el control dice es lo que hace. Una evidencia YA subida se enlaza al reporte aunque se quite de la lista (el motor no tiene operación para
  // retirarla), así que no se ofrece «Remove» sobre ella: se dice qué pasa con ella, y la pregunta de confirmación lista lo que acompaña al envío.
  adjuntadoYaEnviado: "Attached. It goes with your report if you send one.",
  // Una vez enviado el reporte ya no se le agrega nada (el motor enlaza la evidencia al crearlo): lo ya subido dice que FUE con él, y no se ofrece adjuntar más.
  adjuntadoYaFueAlReporte: "Attached. It was sent with your report.",
  acompanaAlReporte: "Your attachments that go with it:",
  aunNoAdjunto: "Not attached yet:",
  falloDeSubida: "Couldn't attach.",
  reintentarSubida: "Retry",
  sinCaptura: "No screenshot. The element is attached anyway.",
  topeDeAdjuntos: "Up to 4 attachments per conversation.",
  imagenInvalida: "That file isn't an image, or it's too large.",
  elementoSenalado: "Pointed element",
  // 2.2.0: la pantalla de inicio (§5 de la marca) y el pie
  hola: "Hi",
  saludoPorDefecto: "How can we help?",
  oEscribi: "or type below",
  asistenteAutomatico: "Automated assistant",
  atribucion: "Supcoflow",
  enviarAria: "Send the message",
  // 2.3.0: los eventos `actividad` y `desenlace` (spec §6 de la etapa 1). Los dibuja el widget,
  // no el modelo: la promesa del reporte deja de depender del prompt.
  leyendoLaGuia: "Reading the support guide…",
  // 2.4.0: sin promesa sobre lo que hará el equipo (el chat no puede cumplirla) y con lo que el chat SÍ sabe: el reporte quedó cerrado.
  reportado: "Report sent.",
  reporteCerrado: "Nothing written here from now on is added to it.",
  reporte: "Report",
  respondida: "Answered · no issue",
  // Los pasos reales: una línea sobre la respuesta, escrita por el widget. Cada una dice un hecho que el
  // código vio (nunca lo que el modelo "cree" haber hecho) y ninguna nombra una herramienta.
  guiaLeida: "Read the guide",
  resumenPreparado: "Summarized the report",
  preguntaAnotada: "Noted your question",
  // 2.4.0: el texto pegado que supera el límite (`isLongPaste`, núcleo) se dibuja colapsado y se manda completo.
  textoPegado: "[pasted text]",
  linea: "line",
  lineas: "lines",
  caracteres: "characters",
  pegadoRecortadoA: "Only the first",
  pegadoRecortadoB: "characters of the pasted text fit in one message.",
  pegadoNoEntra: "The pasted text doesn't fit: the message is full.",
  // 2.3.0 (T0.7): la salida después de un reporte. Recargar la página retoma la MISMA sesión.
  nuevaConversacion: "New conversation",
  // 2.3.0 (T0.2): un texto propio por código de error conocido; el `mensaje` del backend no se
  // dibuja, así el idioma de un error no depende de quién lo escribió.
  limiteDeSesion: "This conversation reached its limit. Write to start a new one.",
  topeDeMensajes: "The chat can't take more messages right now. Try again later.",
  chatNoDisponible: "The chat isn't available on this site right now.",
  // Tanda 10, P4: `ia_no_disponible` / `ia_sin_configurar` (la IA del chat es del cliente y no anda: clave rechazada, sin saldo, sin configurar…). Es la MISMA frase neutra que manda el backend
  // en inglés (`TEXTOS_NEUTROS_PARA_EL_USUARIO.en`, agent/lib/errores-de-ia.ts): nada de la clave, del proveedor ni de la plata.
  asistenteNoDisponible: "The assistant isn't available right now. Please try again later.",
  // 2.3.0 (A2): la respuesta a una confirmación vieja (el usuario escribió después, o se pidió otra): la
  // política del backend la rechaza y el pedido vigente sigue esperando.
  confirmacionVencida: "That confirmation is out of date. Check the latest summary and answer that one.",
});

/** Los dos arranques de la pantalla de inicio (§5.2 de la marca): cada uno manda su `mensaje`
 * como PRIMER mensaje del usuario, por el mismo camino que escribir. Son dos porque son las dos
 * tools del agente; un tercero («tengo una idea») no tiene destino. No configurables por proyecto. */
export const ARRANQUES: readonly { titulo: string; detalle: string; mensaje: string }[] = Object.freeze([
  { titulo: "Report a bug", detalle: "Something isn't working right", mensaje: "I want to report a bug" },
  { titulo: "I have a usage question", detalle: "How to do something in the product", mensaje: "I have a question about how to use the product" },
]);

/** El avatar cuando el proyecto no subió logo: las iniciales del título. Filtra tokens de ≤2 caracteres
 * (artículos, preposiciones como "de", "la", "el") porque la especificación literal de Task 5 (2026-09-11)
 * no hacía esta distinción y fallaba su propio test ("Ayuda de Turnera" esperaba "AT", el código daba "AD").
 * Este es un heurístico mínimo: no es una lista explícita de artículos, sino un corte de longitud que
 * en la práctica descarta los más cortos. */
export function inicialesDe(titulo: string): string {
  const palabras = titulo.trim().split(/\s+/).filter((p) => p.length > 2);
  if (palabras.length === 0) return "S";
  const letras = palabras.length >= 2 ? palabras[0]![0]! + palabras[1]![0]! : palabras[0]!.slice(0, 2);
  return letras.toUpperCase();
}
