import type { CursorDeSesion } from "./protocolo";

// §2.5 del diseño: la conversación sobrevive una recarga DE LA PESTAÑA. sessionStorage y no
// localStorage a propósito: el `id` que guarda es el id SELLADO que entrega el backend (desde el
// 2026-10-30 una capacidad firmada al portador, no el id de Eve pelado), y acotarlo a la pestaña
// que lo abrió es la contención más barata que hay. Para el widget es un string opaco. El storage se inyecta para testear
// sin DOM y para que uno que lanza (modo privado, iframe con cookies bloqueadas) no tire abajo
// el sitio del cliente.

export function claveDeSesion(tenantId: string, projectId: string): string {
  return `supcoflow-chat/${tenantId}/${projectId}`;
}

export function leerSesion(storage: Pick<Storage, "getItem">, clave: string): CursorDeSesion | null {
  try {
    const crudo = storage.getItem(clave);
    if (crudo === null) return null;
    const v = JSON.parse(crudo) as Partial<CursorDeSesion>;
    if (typeof v.id !== "string" || typeof v.indice !== "number") return null;
    return { id: v.id, indice: v.indice };
  } catch {
    return null;
  }
}

export function guardarSesion(storage: Pick<Storage, "setItem" | "removeItem">, clave: string, cursor: CursorDeSesion | null): void {
  try {
    if (cursor === null) storage.removeItem(clave);
    else storage.setItem(clave, JSON.stringify(cursor));
  } catch {
    // Best-effort: sin storage, la conversación dura lo que dura la página.
  }
}

/** `sessionStorage` si el navegador lo deja usar; `null` si no hay (SSR, Node) o lanza (modo privado, iframe con cookies bloqueadas). */
export function storageSeguro(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
