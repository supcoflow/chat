import { claveDeSesion, guardarSesion } from "../sesion-guardada";
import type { Scenario } from "./escenario";

/**
 * Un almacén en memoria con la conversación que el escenario dice que la pestaña ya tenía guardada (los de recarga: `reload-with-pending-confirmation`,
 * `reload-of-many-turns`). Se le da al núcleo como `storage` y, al crearse, rebobina esa conversación contra el backend falso.
 * Es el único lugar fuera del núcleo que sabe cómo se guarda el registro: quien arma una interfaz no lo escribe ni lo lee (P11).
 */
export function storageWithSavedConversation(scenario: Scenario, ids: { tenantId: string; projectId: string }): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  if (scenario.saved === undefined) throw new Error(`The scenario "${scenario.name}" has no saved conversation: only the reload scenarios do.`);
  const datos = new Map<string, string>();
  const almacen = {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
  guardarSesion(almacen, claveDeSesion(ids.tenantId, ids.projectId), { id: scenario.saved.id, indice: scenario.saved.index });
  return almacen;
}
