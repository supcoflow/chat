// El overlay para señalar un elemento (§3.1 del diseño), trasladado de `grab-guest-overlay-script`
// y `grab-guest-selection-scripts` de Orca (MIT, LICENSES/orca.txt). Se inyecta en la PÁGINA del
// cliente, fuera de nuestro shadow root, como hace Orca: tiene que cubrir la página, no el panel.
// Host a pantalla completa con `pointer-events: all` que atrapa el clic (la página no lo recibe),
// shadow root CERRADO con el resaltado y la etiqueta, y hit-test con `elementFromPoint` apagando
// el `pointer-events` del host un instante.
//
// Diferencias con Orca, a propósito: no hay menú contextual ni "freeze" (acá el clic elige y listo,
// la miniatura se ve en la barra de adjuntos); Esc cancela desde acá (Orca lo hacía desde Electron);
// y nuestro propio widget (`ignorar`) no se puede elegir — señalar el chat de ayuda no es un bug
// del sitio del cliente.

export const ID_DEL_SELECTOR = "supcoflow-chat-selector";

export interface SelectorActivo {
  /** Lo cierra en silencio: quien lo llama ya sabe que lo cerró. */
  cancelar(): void;
  /** Lo cierra porque OTRO selector (quizá de otro chat de la misma página) ocupa su lugar, y se lo avisa a su dueño (`alReemplazar`). */
  reemplazar(): void;
}

let activo: SelectorActivo | null = null;

export function iniciarSelector(o: {
  documento: Document;
  ignorar: Element | null;
  alElegir: (el: Element) => void;
  alCancelar: () => void;
  /** Otro selector tomó su lugar. Sin esto quien espera la elección quedaría esperando para siempre, porque el overlay ya no existe. */
  alReemplazar?: () => void;
}): SelectorActivo {
  // Nunca dos overlays: el anterior se va y, si pidió que le avisen, se entera.
  activo?.reemplazar();

  const doc = o.documento;
  const host = doc.createElement("div");
  host.id = ID_DEL_SELECTOR;
  host.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:all;cursor:crosshair;";
  const shadow = host.attachShadow({ mode: "closed" });

  const capa = doc.createElement("div");
  capa.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;";
  // Borde blanco con sombra oscura: se lee sobre fondos claros y oscuros (Orca).
  const marco = doc.createElement("div");
  marco.style.cssText = "position:fixed;border:2px solid rgba(255,255,255,0.9);border-radius:3px;pointer-events:none;transition:all 0.05s ease-out;display:none;background:rgba(255,255,255,0.08);box-shadow:0 0 0 1px rgba(0,0,0,0.3),0 2px 8px rgba(0,0,0,0.15);";
  const etiqueta = doc.createElement("div");
  etiqueta.style.cssText = "position:fixed;padding:3px 8px;background:rgba(30,30,30,0.92);color:#e5e5e5;font:11px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;border-radius:4px;pointer-events:none;white-space:nowrap;display:none;max-width:300px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,0.3);";
  capa.append(marco, etiqueta);
  shadow.appendChild(capa);
  doc.documentElement.appendChild(host);

  let actual: Element | null = null;
  let vivo = true;

  const elegible = (el: Element | null): el is Element => {
    if (el === null || el === doc.documentElement || el === doc.body) return false;
    if (o.ignorar !== null && (el === o.ignorar || o.ignorar.contains(el))) return false;
    return el !== host;
  };

  const resaltar = (el: Element | null): void => {
    if (!elegible(el)) {
      marco.style.display = "none";
      etiqueta.style.display = "none";
      actual = null;
      return;
    }
    actual = el;
    const r = el.getBoundingClientRect();
    marco.style.left = `${r.x}px`;
    marco.style.top = `${r.y}px`;
    marco.style.width = `${r.width}px`;
    marco.style.height = `${r.height}px`;
    marco.style.display = "block";
    const partes = [el.tagName.toLowerCase()];
    const role = el.getAttribute("role");
    if (role) partes.push(`role=${role}`);
    const texto = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (texto) partes.push(`"${texto.length > 40 ? `${texto.slice(0, 37)}...` : texto}"`);
    partes.push(`${Math.round(r.width)}x${Math.round(r.height)}`);
    etiqueta.textContent = partes.join("  ");
    let y = r.bottom + 6;
    if (y + 28 > doc.defaultView!.innerHeight) y = r.top - 28;
    etiqueta.style.left = `${Math.max(4, r.x)}px`;
    etiqueta.style.top = `${y}px`;
    etiqueta.style.display = "block";
  };

  const alMover = (e: MouseEvent): void => {
    // Esconder el host un instante para ver qué hay debajo del puntero.
    host.style.pointerEvents = "none";
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    host.style.pointerEvents = "all";
    resaltar(el);
  };
  const alClic = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (actual === null) return; // sin nada resaltado, el usuario sigue eligiendo
    const elegido = actual;
    desmontar();
    o.alElegir(elegido);
  };
  const alTecla = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    desmontar();
    o.alCancelar();
  };
  // Al hacer scroll o cambiar de tamaño el rect viejo queda desfasado: se apaga hasta el próximo movimiento.
  const alDesfasar = (): void => resaltar(null);

  function desmontar(): void {
    if (!vivo) return;
    vivo = false;
    host.removeEventListener("mousemove", alMover);
    host.removeEventListener("click", alClic, true);
    doc.removeEventListener("keydown", alTecla, true);
    doc.defaultView?.removeEventListener("scroll", alDesfasar, true);
    doc.defaultView?.removeEventListener("resize", alDesfasar);
    host.remove();
    if (activo === selector) activo = null;
  }

  host.addEventListener("mousemove", alMover);
  host.addEventListener("click", alClic, true);
  doc.addEventListener("keydown", alTecla, true);
  doc.defaultView?.addEventListener("scroll", alDesfasar, true);
  doc.defaultView?.addEventListener("resize", alDesfasar);

  const selector: SelectorActivo = {
    cancelar: desmontar,
    reemplazar() {
      if (!vivo) return;
      desmontar();
      o.alReemplazar?.();
    },
  };
  activo = selector;
  return selector;
}
