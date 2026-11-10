// La versión del cliente que viaja en cada pedido al backend (plan de las tres formas, §4: «Mandar la versión del cliente en un
// encabezado»). Sirve para que Supcoflow sepa cuántas copias viejas andan dando vueltas; el backend NO decide nada con ella. Es una
// constante y no un `import` de package.json porque el bundle del navegador no lee archivos; `version.test.ts` exige que coincida.

import { ENCABEZADOS_DEL_CHAT } from "../contrato-del-chat";

export const ENCABEZADO_SDK = ENCABEZADOS_DEL_CHAT.sdk;

/** Mantener igual a `version` de `package.json` (lo exige `version.test.ts`). */
export const SDK_VERSION = "2.4.0";

/** La huella del build con que se construyó esta salida (`huella-del-build.mjs`: fuente, configuración y dependencias bloqueadas), que `build.mjs` inyecta con `define`. En el fuente y en los tests no está definida: la etiqueta es la versión a secas. */
declare const __SDK_BUILD__: string | undefined;
export const HUELLA_DEL_BUILD: string = typeof __SDK_BUILD__ === "string" ? __SDK_BUILD__ : "";

/** Quién habla: el núcleo sin interfaz (`core`) o el widget que lo usa (`widget`). */
export type Superficie = "core" | "widget";

/** `core/2.3.1+ab12cd34`: la versión del paquete MÁS la huella del build con que se construyó (build metadata de semver). La versión sola no identifica el código: el `<script>` que se sirve desde `main`
 * puede llevar cambios sin publicar bajo la misma versión que npm. Con la huella, la misma etiqueta es el mismo código. Informativa: el backend no decide nada con ella. */
export function cabeceraDelSdk(superficie: Superficie, huella: string | undefined = HUELLA_DEL_BUILD): string {
  return `${superficie}/${SDK_VERSION}${huella === undefined || huella === "" ? "" : `+${huella}`}`;
}
