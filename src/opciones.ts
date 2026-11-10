import { normalizarBackendUrl } from "./estado-del-widget";
import type { EventoDelPreview } from "./protocolo";
import { MAX_LARGO_DE_CLAVE_DEL_CONTEXTO, TOPES_DEL_USUARIO } from "./contrato-del-chat";

/** Las variables CSS del tema (§2.1). Cada una termina como `--scf-<nombre>` en el host. */
export interface TemaDelChat {
  acento: string;
  fondo: string;
  texto: string;
  textoSuave: string;
  radio: string;
  fuente: string;
}

/** Lo que el widget le cuenta al desarrollador que lo instala (§2.5). */
export interface Diagnostico {
  visible: boolean;
  status: number;
  motivo: string | null;
}

/** Quién es el usuario según la app del cliente (§4 del diseño de la marca). DECLARADO, no
 * verificado: el rol no da permisos a nada, es contexto de diagnóstico (la mitad de los «no me
 * aparece el botón» son permisos). `id`, `rol` y `atributos` viajan al modelo y al reporte.
 * `nombre` (desde la 2.2.0) lo usa SÓLO el saludo de la pantalla de inicio y nunca sale del
 * navegador: es PII de un usuario final de OTRA empresa y el reporte termina en un issue de GitHub. */
export interface UsuarioDelChat {
  id?: string;
  nombre?: string;
  rol?: string;
  atributos?: Record<string, string>;
}

// Cotas del §4.1, espejadas en el motor (`src/schemas/contexto.ts`) y escritas UNA vez en `contrato-del-chat.ts`, que el backend también importa. Se RECORTA en vez de lanzar:
// el widget vive en el sitio de otra empresa y un rol largo no es motivo para no montarse.
export const MAX_USUARIO_ID = TOPES_DEL_USUARIO.id;
export const MAX_USUARIO_ROL = TOPES_DEL_USUARIO.rol;
export const MAX_ATRIBUTOS = TOPES_DEL_USUARIO.atributos;
export const MAX_ATRIBUTO_CLAVE = TOPES_DEL_USUARIO.claveDeAtributo;
// 2.3.0: el atributo viaja al modelo como `usr_attr_<clave>` y el backend rechaza el turno ENTERO
// con una clave de más de 48 (`MAX_LARGO_DE_CLAVE_DEL_CONTEXTO`, del contrato). 48 − 9 = 39: una clave de 40 que el motor aceptaría
// no se manda, con aviso, en vez de tumbar la conversación.
export const MAX_ATRIBUTO_CLAVE_EN_EL_CONTEXTO = MAX_LARGO_DE_CLAVE_DEL_CONTEXTO - "usr_attr_".length;
export const MAX_ATRIBUTO_VALOR = TOPES_DEL_USUARIO.valorDeAtributo;
export const MAX_USUARIO_NOMBRE = 80;
// 140 es MAX_SALUDO_CHARS del motor, `src/schemas/marca.ts`; literal a propósito, paquetes
// separados.
export const MAX_SALUDO = 140;

export interface OpcionesDelChat {
  tenantId: string;
  projectId: string;
  /** Default: producción. Se acepta con o sin barra final. */
  backendUrl?: string;
  modo?: "burbuja" | "inline";
  posicion?: "derecha" | "izquierda";
  titulo?: string;
  /** La segunda línea de la pantalla de inicio (2.2.0). Gana sobre la marca, como `titulo`. */
  saludo?: string;
  /** El panel arranca abierto (2.2.0). En `modo: "inline"` no aplica. Default false. */
  abierto?: boolean;
  tema?: Partial<TemaDelChat>;
  contexto?: { versionApp?: string };
  /** URL y navegador al primer mensaje (§3.4). Default true; errores de consola NUNCA. */
  contextoAutomatico?: boolean;
  onDiagnostico?: (d: Diagnostico) => void;
  usuario?: UsuarioDelChat;
  /** INTERNA (§5.3): la usa la consola de Supcoflow para el preview; en tu sitio no hace nada útil.
   * Manda el header `x-supcoflow-preview`, apaga la subida de evidencias y muestra el rótulo. */
  previewToken?: string;
  /** INTERNA (2.2.0): cada evento v1 que el widget consume, más `enviado`/`respondido` con lo que
   * mandó. La usa la consola de Supcoflow para la columna «actividad» del preview; en tu sitio no
   * hace nada útil. Sin `data-*`. Un callback que lanza no tumba el chat. */
  onEvento?: (e: EventoDelPreview) => void;
}

export interface OpcionesResueltas {
  tenantId: string;
  projectId: string;
  backendUrl: string;
  modo: "burbuja" | "inline";
  posicion: "derecha" | "izquierda";
  titulo: string;
  saludo: string | undefined;
  abierto: boolean;
  tema: TemaDelChat;
  contexto: { versionApp?: string };
  contextoAutomatico: boolean;
  onDiagnostico: ((d: Diagnostico) => void) | undefined;
  usuario: UsuarioDelChat;
  previewToken: string | null;
  onEvento: ((e: EventoDelPreview) => void) | undefined;
}

function textoAcotado(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const limpio = v.trim().slice(0, max);
  return limpio === "" ? undefined : limpio;
}

/** Whitelist, no blacklist: sólo `id`, `nombre`, `rol` y `atributos` salen de acá. Un cliente en JS
 * puede pasar cualquier cosa, y lo que no se nombra no viaja. `id`, `rol` y `nombre` no valen como
 * atributo: los dos primeros se confundirían con el id y el rol del usuario (en la 2.2.1 los
 * pisaban), y `nombre` rompería la promesa de que no viaja. Desde la 2.3.0 se descartan con un
 * aviso en la consola del navegador, para que quien instala sepa por qué no llegan. */
const ATRIBUTOS_RESERVADOS: ReadonlySet<string> = new Set(["id", "rol", "nombre"]);

export function normalizarUsuario(u: unknown): UsuarioDelChat {
  if (typeof u !== "object" || u === null) return {};
  const crudo = u as Record<string, unknown>;
  const r: UsuarioDelChat = {};
  const id = textoAcotado(crudo.id, MAX_USUARIO_ID);
  const rol = textoAcotado(crudo.rol, MAX_USUARIO_ROL);
  const nombre = textoAcotado(crudo.nombre, MAX_USUARIO_NOMBRE);
  if (id !== undefined) r.id = id;
  if (rol !== undefined) r.rol = rol;
  if (nombre !== undefined) r.nombre = nombre;
  if (typeof crudo.atributos === "object" && crudo.atributos !== null) {
    const atributos: Record<string, string> = {};
    for (const [k, v] of Object.entries(crudo.atributos as Record<string, unknown>)) {
      if (Object.keys(atributos).length >= MAX_ATRIBUTOS) break;
      const clave = k.trim();
      if (clave === "" || clave.length > MAX_ATRIBUTO_CLAVE) continue;
      if (ATRIBUTOS_RESERVADOS.has(clave)) {
        console.warn(`[supcoflow/chat] the user attribute "${clave}" is reserved and is not sent. Use \`usuario.id\` or \`usuario.rol\`; the name never leaves the browser.`);
        continue;
      }
      if (clave.length > MAX_ATRIBUTO_CLAVE_EN_EL_CONTEXTO) {
        console.warn(`[supcoflow/chat] the user attribute "${clave}" is longer than ${MAX_ATRIBUTO_CLAVE_EN_EL_CONTEXTO} characters and is not sent.`);
        continue;
      }
      const valor = textoAcotado(v, MAX_ATRIBUTO_VALOR);
      if (valor !== undefined) atributos[clave] = valor;
    }
    if (Object.keys(atributos).length > 0) r.atributos = atributos;
  }
  return r;
}

export const BACKEND_POR_DEFECTO = "https://chat.supcoflow.dev";

/** El título sin marca ni `titulo` (en inglés desde la 2.3.0, como todos los textos fijos). */
export const TITULO_POR_DEFECTO = "Help";

// Neutro a propósito: el widget vive en el sitio de otra empresa y no puede llegar con una
// marca. `fuente: inherit` toma la del sitio; sin webfonts (§2.1).
export const TEMA_POR_DEFECTO: TemaDelChat = {
  acento: "#1f2937",
  fondo: "#ffffff",
  texto: "#111827",
  textoSuave: "#6b7280",
  // 20 desde la 2.2.0: es el radio del PANEL; las burbujas tienen el suyo en el CSS.
  radio: "20px",
  fuente: "inherit",
};

export function normalizarOpciones(o: OpcionesDelChat): OpcionesResueltas {
  if (typeof o.tenantId !== "string" || o.tenantId.trim() === "") throw new Error("ChatDeIntake: missing `tenantId`.");
  if (typeof o.projectId !== "string" || o.projectId.trim() === "") throw new Error("ChatDeIntake: missing `projectId`.");
  return {
    tenantId: o.tenantId,
    projectId: o.projectId,
    backendUrl: normalizarBackendUrl(o.backendUrl ?? BACKEND_POR_DEFECTO),
    modo: o.modo ?? "burbuja",
    posicion: o.posicion ?? "derecha",
    titulo: o.titulo ?? TITULO_POR_DEFECTO,
    saludo: textoAcotado(o.saludo, MAX_SALUDO),
    abierto: o.abierto === true,
    tema: { ...TEMA_POR_DEFECTO, ...(o.tema ?? {}) },
    contexto: o.contexto ?? {},
    contextoAutomatico: o.contextoAutomatico ?? true,
    onDiagnostico: o.onDiagnostico,
    usuario: normalizarUsuario(o.usuario),
    previewToken: typeof o.previewToken === "string" && o.previewToken !== "" ? o.previewToken : null,
    onEvento: typeof o.onEvento === "function" ? o.onEvento : undefined,
  };
}

/** Los `data-*` del `<script>` del IIFE (§1.2): `data-tenant`, `data-project`, `data-backend`,
 * `data-posicion`, `data-titulo`, `data-saludo`, `data-acento`, `data-version-app`,
 * `data-contexto-automatico`, `data-usuario-id`, `data-usuario-rol`, `data-usuario-nombre`,
 * `data-abierto="true"`. `dataset` ya los entrega en camelCase. Sólo traduce; los defaults son de
 * normalizarOpciones. Sin `data-usuario-atributos` (un <script> no lleva objetos) y sin
 * `previewToken`/`onEvento` (son internas: sin equivalente `data-*`). */
export function opcionesDesdeDataset(d: Record<string, string | undefined>): OpcionesDelChat {
  const o: OpcionesDelChat = { tenantId: d.tenant ?? "", projectId: d.project ?? "" };
  if (d.backend) o.backendUrl = d.backend;
  if (d.posicion === "derecha" || d.posicion === "izquierda") o.posicion = d.posicion;
  if (d.titulo) o.titulo = d.titulo;
  if (d.saludo) o.saludo = d.saludo;
  if (d.abierto === "true") o.abierto = true;
  if (d.acento) o.tema = { acento: d.acento };
  if (d.versionApp) o.contexto = { versionApp: d.versionApp };
  if (d.contextoAutomatico === "false") o.contextoAutomatico = false;
  if (d.usuarioId || d.usuarioRol || d.usuarioNombre) {
    o.usuario = {};
    if (d.usuarioId) o.usuario.id = d.usuarioId;
    if (d.usuarioRol) o.usuario.rol = d.usuarioRol;
    if (d.usuarioNombre) o.usuario.nombre = d.usuarioNombre;
  }
  return o;
}
