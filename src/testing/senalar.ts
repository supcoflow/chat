import type { PickResult, SupportChat } from "../core/tipos";
import { ID_DEL_SELECTOR } from "../evidencia/selector-de-elementos";

/**
 * Recorre el paso `{ pickElement: true }` de un escenario como lo haría una persona: abre el selector de elementos, mueve el puntero sobre `target` y hace clic.
 * Los escenarios con adjunto (`attachment-failed`, `report-with-attachment`) lo necesitan; quien prueba una interfaz no tiene por qué conocer el id del
 * selector ni cómo se le hace clic. Hace falta un DOM (jsdom, happy-dom, un navegador). Sin `target`, crea un botón en la página.
 * Resuelve lo que contestó `pickElement`: `"picked"`, o por ejemplo `"not_allowed"` si el acuerdo de datos no deja señalar (y entonces no hay selector).
 */
export function completeElementPick(chat: SupportChat, target?: Element): Promise<PickResult>;
/**
 * T6: para probar la interfaz ENTERA, donde no se tiene el `chat` en la mano sino el botón de «señalar» de la propia app: `start` hace el clic en ese botón. Espera a que
 * se abra el selector del núcleo, mueve el puntero sobre `target` y hace clic. Resuelve `true` si el selector se abrió y se hizo clic, `false` si nunca apareció (por ejemplo,
 * el acuerdo de datos no deja señalar).
 */
export function completeElementPick(start: () => unknown, target?: Element): Promise<boolean>;
export async function completeElementPick(chatOrStart: SupportChat | (() => unknown), target?: Element): Promise<PickResult | boolean> {
  const objetivo = target ?? document.body.appendChild(Object.assign(document.createElement("button"), { textContent: "Export" }));
  const elementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => objetivo;
  try {
    let contestado = false;
    const resultado = typeof chatOrStart === "function" ? Promise.resolve(chatOrStart()).then(() => "started" as const) : chatOrStart.pickElement();
    void resultado.then(() => { contestado = true; });
    // Con el chat: el selector se abre cuando el núcleo sabe qué permite el acuerdo de datos (puede sondearlo antes), así que se espera a que aparezca o a que `pickElement`
    // conteste sin abrirlo. Con una función no hay respuesta que esperar: `start` vuelve apenas hizo el clic, y se espera sólo al selector.
    const esFuncion = typeof chatOrStart === "function";
    for (let i = 0; i < 20 && document.getElementById(ID_DEL_SELECTOR) === null && (esFuncion || !contestado); i++) await new Promise((r) => setTimeout(r, 0));
    const overlay = document.getElementById(ID_DEL_SELECTOR);
    if (overlay !== null) {
      overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5, bubbles: true }));
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    if (esFuncion) {
      await new Promise((r) => setTimeout(r, 0));
      return overlay !== null;
    }
    return await (resultado as Promise<PickResult>);
  } finally {
    document.elementFromPoint = elementFromPoint;
  }
}
