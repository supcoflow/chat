// El contrato del NAVEGADOR con el backend del chat (protocolo v1), escrito UNA vez. Hasta acá los nombres de los encabezados estaban a mano en tres archivos del widget, en el CORS del backend, en su
// admisión, en el servidor de prueba del widget y en los tests, y los topes del usuario declarado en tres archivos más («literal a propósito: paquetes separados»). El widget y el backend del chat se desarrollan
// juntos y el backend ya depende de `@supcoflow/chat` (por tipo en muchos archivos): lo que se copia es el contrato con el MOTOR, que sí es otro repo; éste no.
//
// SIN imports: es un archivo de constantes que el widget importa por ruta relativa y el backend del chat lo importa por VALOR desde su fuente. NO se exporta en ninguna entrada
// del paquete publicado: no es API ni lo documenta `docs/`; la entrada principal trae React y `next build` la rechaza en una route del backend. Estos valores SON el protocolo v1: un sitio con el widget
// instalado manda estos nombres; cambiar uno lo rompe. `contrato-del-chat.test.ts` los clava y `contrato-unico.test.ts` (backend) comprueba que el CORS y la admisión los toman de acá.

/** Los encabezados que el navegador manda al backend del chat. El par de proyecto va en todo pedido; los demás, cuando corresponde. */
export const ENCABEZADOS_DEL_CHAT = Object.freeze({
  /** El inquilino y el proyecto del chat (en `/api/chat/sesion*` y `/api/evidencias`; en `estado` van en la query). */
  tenant: "x-supcoflow-tenant",
  project: "x-supcoflow-project",
  /** El token de la consola para el PREVIEW (§1 del diseño de la marca): el backend lo reenvía al motor sin mirarlo. Hace que el GET de `estado` tenga preflight. */
  preview: "x-supcoflow-preview",
  /** La versión del cliente (`core/2.3.1`, `widget/2.3.1`); el backend no decide nada con ella. */
  sdk: "x-supcoflow-sdk",
  /** El idioma de la app: elige las palabras fijas de la confirmación del reporte. */
  locale: "x-supcoflow-locale",
  /** Lo que la interfaz ofrece de verdad (T7): una lista de `CAPACIDADES_DEL_CHAT` separada por coma, o `none`. */
  capacidades: "x-supcoflow-capabilities",
} as const);

/** Lo que el CORS del backend nombra en `access-control-allow-headers`. Un encabezado custom dispara preflight, y si no está nombrado el navegador corta antes del POST sin decir por qué: por eso la lista
 * se DERIVA de `ENCABEZADOS_DEL_CHAT` y un encabezado nuevo no puede quedar afuera. */
export const ENCABEZADOS_PERMITIDOS_EN_CORS: readonly string[] = Object.freeze(["content-type", ...Object.values(ENCABEZADOS_DEL_CHAT)]);

/** Los nombres cerrados de lo que una interfaz puede ofrecer, en el orden en que viajan en `x-supcoflow-capabilities` y en que los lee el modelo. */
export const CAPACIDADES_DEL_CHAT = Object.freeze(["pickElement", "screenshot", "attachImage", "newConversation"] as const);

/** Cotas del usuario declarado (§4.1 del diseño de la marca), espejadas en el motor (`src/schemas/contexto.ts`). El widget RECORTA a esto y el backend vuelve a recortar al reenviar. */
export const TOPES_DEL_USUARIO = Object.freeze({
  id: 100,
  rol: 60,
  /** Cuántos atributos como máximo. */
  atributos: 8,
  claveDeAtributo: 40,
  valorDeAtributo: 200,
} as const);

/** El largo máximo de una CLAVE del `contexto` de un turno: el backend rechaza el turno entero con una de más. El widget lo usa para no mandar `usr_attr_<clave>` que lo pase. */
export const MAX_LARGO_DE_CLAVE_DEL_CONTEXTO = 48;
