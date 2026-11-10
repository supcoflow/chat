import type { PermisosDelWidget } from "./estado-del-widget";
import type { OpcionesResueltas } from "./opciones";

/** §3.4 del diseño: URL (sin query ni hash — pueden llevar tokens) y navegador por defecto, con
 * opt-out; la versión sólo si el cliente la declaró; errores de consola NUNCA. Viaja como
 * `contexto` de `abrir` → clientContext efímero del primer turno de Eve. El camino al reporte
 * (evidencia tipo `contexto`) lo hace el backend al final del primer turno; desde la 2.1.0 lleva
 * también el usuario declarado (§4 del diseño de la marca). */
// El backend valida cada VALOR de `contexto` con tope 1500 (`MAX_LARGO_DE_VALOR`
// en el traductor del backend del chat); sin truncar acá, una URL o UA larga
// hace fallar el POST entero con 400. Acá se recorta más corto, a 500: ninguna URL ni
// user-agent real necesita más.
const TOPE_VALOR = 500;
const MAX_VERSION_APP = 100;

/** El prefijo de un atributo del usuario en el contexto (2.3.0). Su largo cuenta contra las 48 de clave del backend:
 * `MAX_ATRIBUTO_CLAVE_EN_EL_CONTEXTO` (`opciones.ts`) sale de acá. */
export const PREFIJO_DE_ATRIBUTO = "usr_attr_";

export function resumenDeContexto(
  o: OpcionesResueltas,
  ventana: { location?: { href: string }; navigator?: { userAgent: string } },
  // 2.3.0 (T0.5): sin `pagina_y_navegador` en el acuerdo, el automático no sale (comodidad: el backend lo tiraría igual).
  // Sin `permite`, como hoy.
  permite: Pick<PermisosDelWidget, "paginaYNavegador"> = { paginaYNavegador: true },
): Record<string, string> | undefined {
  const r: Record<string, string> = {};
  const automatico = o.contextoAutomatico && permite.paginaYNavegador;
  if (automatico && ventana.location !== undefined) {
    try {
      const u = new URL(ventana.location.href);
      u.search = "";
      u.hash = "";
      r.url = u.toString().replace(/\/$/, "").slice(0, TOPE_VALOR);
    } catch {
      // una URL ilegible no aporta nada
    }
  }
  if (automatico && ventana.navigator !== undefined) r.agente_usuario = ventana.navigator.userAgent.slice(0, TOPE_VALOR);
  // Recortada (revisión de F0, hallazgo 4): sin cota, una versión de más de 1.500 hacía rechazar el
  // POST entero. 100 es lo que el backend guarda al reenviarla al motor (`contexto-como-evidencia.ts`).
  if (typeof o.contexto.versionApp === "string" && o.contexto.versionApp.trim() !== "") r.version_app = o.contexto.versionApp.trim().slice(0, MAX_VERSION_APP);
  // §4.2 del diseño de la marca: el usuario declarado, PLANO — `clientContext` de Eve es un record
  // de strings y el modelo lo lee así. El backend lo vuelve a anidar para el motor
  // (`contexto-como-evidencia.ts`). Sin `nombre` A PROPÓSITO (desde la 2.2.0 SÍ existe en
  // `UsuarioDelChat` y `normalizarUsuario` lo acepta): esta whitelist no lo lee porque es PII de
  // un usuario final de OTRA empresa que sólo usa el saludo de la pantalla de inicio — el mismo
  // motivo que en el docstring de `UsuarioDelChat` (`opciones.ts`), no que la clave no exista.
  //
  // 2.3.0 (T0.6, N5): claves SIN ambigüedad, `usr_id`, `usr_rol` y `usr_attr_<clave>`. Hasta la 2.2.1 eran `usuario_id`,
  // `usuario_rol` y `usuario_<clave>`: un atributo `id` se aplanaba encima del id del usuario y el filtro del acuerdo no podía
  // saber cuál de los dos le llegaba. El backend las traduce a la forma vieja sólo al reenviar al motor, que no cambia.
  const u = o.usuario;
  if (u.id !== undefined) r.usr_id = u.id;
  if (u.rol !== undefined) r.usr_rol = u.rol;
  for (const [k, v] of Object.entries(u.atributos ?? {})) r[`${PREFIJO_DE_ATRIBUTO}${k}`] = v;
  return Object.keys(r).length === 0 ? undefined : r;
}
