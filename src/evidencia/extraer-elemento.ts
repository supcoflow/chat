// Traslado a TypeScript de los scripts de grab de Orca — `grab-guest-foundation-script`,
// `-content-script`, `-element-context-script` y la `extractPayload` de `-react-script`
// (github.com/stablyai/orca, src/main/browser/, MIT, © 2026 Lovecast Inc.; licencia completa en
// LICENSES/orca.txt). Mismos presupuestos, misma allowlist de atributos, misma redacción de
// secretos, misma construcción del selector. Lo que cambia, a propósito (§3.1 y §7.1 del diseño):
//   - sin `reactComponents` ni `sourceFile` (dev tools del sitio; al agente de fix no le sirven);
//   - sin `file:` entre los protocolos seguros (un widget no corre en file:);
//   - el HTML del elemento se limpia de `value` de input/textarea/select y de <script>: Orca sólo
//     sacaba los scripts. Un `value` es lo que el usuario escribió, y NUNCA entra al payload.
//
// Recibe el `Element` y la `Window`: es una función de datos, sin overlay, y se testea entera
// sobre un DOM de fixture. El overlay vive en selector-de-elementos.ts.

import type { ElementoSeleccionado, RectDelElemento } from "./elemento";

/** Cota del motor sobre el JSON entero (`MAX_ELEMENTO_CHARS` en src/schemas/evidencia.ts). */
export const MAX_ELEMENTO_CHARS = 16_000;

const PRESUPUESTO = {
  textSnippet: 200,
  nearbyTextEntry: 200,
  nearbyTextEntries: 10,
  htmlSnippet: 4096,
  ancestorPathEntries: 10,
  nearbyElementsEntries: 6,
  nearbyElement: 160,
  selector: 700,
  path: 900,
  cssClasses: 500,
  selectedText: 500,
  // Cotas del motor que Orca no tenía (sus campos venían de un Electron confiable): título de la
  // página, cada atributo, cada entrada del ancestro, el nombre accesible.
  title: 500,
  attribute: 600,
  ancestorEntry: 80,
  accessibleName: 300,
} as const;
const LIMITE_NODOS_DE_TEXTO = 80;
const LIMITE_HERMANOS = 80;

const ATRIBUTOS_SEGUROS = new Set(["id", "class", "name", "type", "role", "href", "src", "alt", "title", "placeholder", "for", "action", "method"]);
const PATRONES_DE_SECRETO = ["access_token", "auth_token", "api_key", "apikey", "client_secret", "oauth_state", "x-amz-", "session_id", "sessionid", "csrf", "secret", "password", "passwd"];
const PROTOCOLOS_SEGUROS = new Set(["http:", "https:"]);
const PROPIEDADES_DE_ESTILO = ["display", "position", "width", "height", "margin", "padding", "color", "backgroundColor", "border", "borderRadius", "fontFamily", "fontSize", "fontWeight", "lineHeight", "textAlign", "zIndex"];

function acotar(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max)} (truncated)`;
}

// El título de la página es el único campo con una cota DURA, sin el sufijo " (truncated)": el
// motor lo valida con un `max(500)` exacto, y el sufijo de `acotar` lo pasaría de largo.
function acotarDuro(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max);
}

export function contieneSecreto(v: string): boolean {
  const bajo = v.toLowerCase();
  return PATRONES_DE_SECRETO.some((p) => bajo.includes(p));
}

export function sanearUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!PROTOCOLOS_SEGUROS.has(u.protocol)) return "";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

// ── Texto ─────────────────────────────────────────────────────────────────────
// Un acumulador que normaliza espacios sin concatenar el texto entero primero: Orca lo hace así
// para que un elemento con 2 MB de texto no cueste 2 MB antes de recortarse.

function esEspacio(codigo: number): boolean {
  return codigo === 32 || (codigo >= 9 && codigo <= 13) || codigo === 160 || codigo === 5760 || (codigo >= 8192 && codigo <= 8202) || codigo === 8232 || codigo === 8233 || codigo === 8239 || codigo === 8287 || codigo === 12288 || codigo === 65279;
}

function textoAcotado(raiz: Node, max: number, doc: Document): string {
  const limite = max + 20;
  let texto = "";
  let espacioPendiente = false;
  const agregar = (valor: string): void => {
    for (let i = 0; i < valor.length && texto.length < limite; i++) {
      if (esEspacio(valor.charCodeAt(i))) {
        if (texto.length > 0) espacioPendiente = true;
        continue;
      }
      if (espacioPendiente) {
        texto += " ";
        espacioPendiente = false;
        if (texto.length >= limite) break;
      }
      texto += valor.charAt(i);
    }
  };
  try {
    const walker = doc.createTreeWalker(raiz, 4 /* NodeFilter.SHOW_TEXT */);
    let inspeccionados = 0;
    let nodo = walker.nextNode();
    while (nodo !== null && texto.length < limite && inspeccionados < LIMITE_NODOS_DE_TEXTO) {
      inspeccionados++;
      // Lo que está adentro de un <script> o <style> no es texto de la pantalla, y lo que está
      // adentro de un <textarea> es lo que el usuario escribió: NUNCA entra al payload (§7.1).
      const padre = nodo.parentElement?.tagName.toLowerCase();
      if (padre !== "script" && padre !== "style" && padre !== "textarea") {
        if (texto.length > 0) espacioPendiente = true;
        agregar((nodo.nodeValue ?? "").slice(0, limite - texto.length));
      }
      nodo = walker.nextNode();
    }
  } catch {
    return "";
  }
  return acotar(texto, max);
}

function textoSeleccionado(ventana: Window): string | null {
  try {
    const sel = ventana.getSelection?.();
    if (!sel || sel.rangeCount === 0) return null;
    const crudo = sel.toString().slice(0, PRESUPUESTO.selectedText + 20).replace(/\s+/g, " ").trim();
    return crudo === "" ? null : acotar(crudo, PRESUPUESTO.selectedText);
  } catch {
    return null;
  }
}

// ── HTML y atributos ──────────────────────────────────────────────────────────

function htmlDelElemento(el: Element): string {
  const clon = el.cloneNode(true) as Element;
  for (const s of clon.querySelectorAll("script, style")) s.remove();
  // Lo que el usuario escribió no viaja (§7.1): ni el atributo `value`, ni el texto de un
  // textarea, ni la opción elegida de un select. Más fuerte que Orca a propósito.
  const campos = [clon, ...clon.querySelectorAll("input, textarea, select, option")];
  for (const c of campos) {
    if (!(c instanceof Element)) continue;
    const tag = c.tagName.toLowerCase();
    if (tag === "input" || tag === "option") c.removeAttribute("value");
    if (tag === "option") c.removeAttribute("selected");
    if (tag === "textarea") c.textContent = "";
  }
  return acotar(clon.outerHTML ?? "", PRESUPUESTO.htmlSnippet);
}

function atributosSeguros(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    const nombre = a.name.toLowerCase();
    if (!ATRIBUTOS_SEGUROS.has(nombre) && !nombre.startsWith("aria-")) continue;
    if (contieneSecreto(a.value)) attrs[nombre] = "[redacted]";
    else if ((nombre === "href" || nombre === "src" || nombre === "action") && a.value) attrs[nombre] = acotar(sanearUrl(a.value), PRESUPUESTO.attribute);
    else if (nombre === "class") attrs[nombre] = acotar(a.value, 200);
    else attrs[nombre] = acotar(a.value, PRESUPUESTO.attribute);
  }
  return attrs;
}

function accesibilidad(el: Element, doc: Document) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role") || tag;
  const ariaLabel = el.getAttribute("aria-label");
  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  let accessibleName: string | null = null;
  if (ariaLabel) accessibleName = ariaLabel;
  else if (ariaLabelledBy) {
    const nombres = ariaLabelledBy.split(/\s+/).slice(0, 32).map((id) => doc.getElementById(id)).filter((r): r is HTMLElement => r !== null).map((r) => textoAcotado(r, 100, doc));
    if (nombres.length > 0) accessibleName = nombres.join(" ");
  } else if (tag === "button" || tag === "a" || tag === "label") accessibleName = textoAcotado(el, 100, doc);
  else if (el.getAttribute("title")) accessibleName = el.getAttribute("title");
  else if (el.getAttribute("alt")) accessibleName = el.getAttribute("alt");
  return {
    role: acotar(role, 60) || null,
    accessibleName: accessibleName === null ? null : acotar(accessibleName, PRESUPUESTO.accessibleName),
    ariaLabel: ariaLabel === null ? null : acotar(ariaLabel, PRESUPUESTO.accessibleName),
    ariaLabelledBy: ariaLabelledBy === null ? null : acotar(ariaLabelledBy, PRESUPUESTO.accessibleName),
  };
}

// ── Selector y rutas ──────────────────────────────────────────────────────────

function escapar(v: string, ventana: Window): string {
  const css = (ventana as Window & { CSS?: { escape?: (s: string) => string } }).CSS;
  if (css && typeof css.escape === "function") return css.escape(v);
  return v.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function pareceHash(v: string): boolean {
  return /^[A-Za-z0-9_-]{12,}$/.test(v) && /\d/.test(v) && /[A-Z]/.test(v);
}

function clasesEstables(el: Element, max: number): string[] {
  const r: string[] = [];
  for (const c of Array.from(el.classList)) {
    if (r.length >= max) break;
    if (!c || c.length > 60 || contieneSecreto(c)) continue;
    if (/^css-[a-z0-9]+$/i.test(c) || pareceHash(c)) continue;
    r.push(c);
  }
  return r;
}

function parteDelSelector(el: Element, ventana: Window): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && !contieneSecreto(el.id)) return `${tag}#${escapar(el.id, ventana)}`;
  const clases = clasesEstables(el, 2);
  return clases.length > 0 ? tag + clases.map((c) => `.${escapar(c, ventana)}`).join("") : tag;
}

function esUnico(selector: string, doc: Document): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function sufijoNthOfType(el: Element): string {
  let indice = 1;
  let h = el.previousElementSibling;
  while (h) {
    if (h.tagName === el.tagName) indice++;
    h = h.previousElementSibling;
  }
  if (indice > 1) return `:nth-of-type(${indice})`;
  h = el.nextElementSibling;
  while (h) {
    if (h.tagName === el.tagName) return ":nth-of-type(1)";
    h = h.nextElementSibling;
  }
  return "";
}

function construirSelector(el: Element, ventana: Window, doc: Document): string {
  const partes: string[] = [];
  let actual: Element | null = el;
  while (actual && actual !== doc.body && partes.length < 10) {
    let parte = parteDelSelector(actual, ventana);
    const padre: Element | null = actual.parentElement;
    if (padre && !esUnico([parte, ...partes].join(" > "), doc)) parte += sufijoNthOfType(actual);
    partes.unshift(parte);
    const selector = partes.join(" > ");
    if (esUnico(selector, doc)) return acotar(selector, PRESUPUESTO.selector);
    actual = padre;
  }
  return acotar(partes.join(" > ") || el.tagName.toLowerCase(), PRESUPUESTO.selector);
}

function rutaLegible(el: Element, ventana: Window, doc: Document): string {
  const partes: string[] = [];
  let actual: Element | null = el;
  while (actual && actual !== doc.documentElement && partes.length < 6) {
    const tag = actual.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;
    let etiqueta = tag;
    const aria = actual.getAttribute("aria-label");
    const role = actual.getAttribute("role");
    const clases = clasesEstables(actual, 1);
    const idEstable = actual.id && !contieneSecreto(actual.id);
    if (idEstable) etiqueta = `#${escapar(actual.id, ventana)}`;
    else if (aria && !contieneSecreto(aria)) etiqueta = `${tag}[aria-label="${acotar(aria, 40).replace(/"/g, '\\"')}"]`;
    else if (role && !contieneSecreto(role)) etiqueta = `${tag}[role="${acotar(role, 30).replace(/"/g, '\\"')}"]`;
    else if (clases.length > 0) etiqueta = `.${escapar(clases[0], ventana)}`;
    partes.unshift(etiqueta);
    // Un id estable ya ancla el elemento de forma inequívoca (como en `construirSelector`):
    // seguir subiendo por encima no agrega nada, así que la ruta se corta acá.
    if (idEstable) break;
    actual = actual.parentElement;
  }
  return acotar(partes.join(" > "), PRESUPUESTO.path);
}

function rutaCompleta(el: Element, ventana: Window, doc: Document): string {
  const partes: string[] = [];
  let actual: Element | null = el;
  while (actual && actual !== doc.documentElement && partes.length < 20) {
    partes.unshift(parteDelSelector(actual, ventana));
    actual = actual.parentElement;
  }
  return acotar(partes.join(" > "), PRESUPUESTO.path);
}

// ── Contexto alrededor ────────────────────────────────────────────────────────

/** Recorre hermanos hacia los dos lados, alternando, con un tope de inspecciones. */
function hermanos(el: Element, max: number, agregar: (h: Element) => void): void {
  let inspeccionados = 0;
  let previo = el.previousElementSibling;
  let siguiente = el.nextElementSibling;
  let agregados = 0;
  const agregarContando = (h: Element): void => {
    const antes = agregados;
    agregar(h);
    agregados = antes + 1;
  };
  while (agregados < max && inspeccionados < LIMITE_HERMANOS && (previo || siguiente)) {
    if (previo) {
      const h = previo;
      previo = previo.previousElementSibling;
      inspeccionados++;
      agregarContando(h);
    }
    if (siguiente && agregados < max && inspeccionados < LIMITE_HERMANOS) {
      const h = siguiente;
      siguiente = siguiente.nextElementSibling;
      inspeccionados++;
      agregarContando(h);
    }
  }
}

function textoCercano(el: Element, doc: Document): string[] {
  const r: string[] = [];
  hermanos(el, PRESUPUESTO.nearbyTextEntries, (h) => {
    const t = textoAcotado(h, PRESUPUESTO.nearbyTextEntry, doc);
    if (t && r.length < PRESUPUESTO.nearbyTextEntries) r.push(t);
  });
  return r;
}

function elementosCercanos(el: Element, doc: Document): string[] {
  const r: string[] = [];
  hermanos(el, PRESUPUESTO.nearbyElementsEntries, (h) => {
    const rect = h.getBoundingClientRect();
    if ((rect.width === 0 && rect.height === 0) || r.length >= PRESUPUESTO.nearbyElementsEntries) return;
    let etiqueta = h.tagName.toLowerCase();
    const clases = clasesEstables(h, 1);
    if (clases.length > 0) etiqueta += `.${clases[0]}`;
    const t = textoAcotado(h, 50, doc);
    if (t) etiqueta += ` "${acotar(t, 50)}"`;
    r.push(acotar(etiqueta, PRESUPUESTO.nearbyElement));
  });
  return r;
}

function ancestros(el: Element, doc: Document): string[] {
  const r: string[] = [];
  let actual = el.parentElement;
  while (actual && actual !== doc.documentElement && r.length < PRESUPUESTO.ancestorPathEntries) {
    const tag = actual.tagName.toLowerCase();
    const role = actual.getAttribute("role");
    r.push(acotar(role ? `${tag}[role=${role}]` : tag, PRESUPUESTO.ancestorEntry));
    actual = actual.parentElement;
  }
  return r;
}

function estilos(el: Element, ventana: Window): Record<string, string> {
  const cs = ventana.getComputedStyle(el);
  const r: Record<string, string> = {};
  for (const p of PROPIEDADES_DE_ESTILO) {
    r[p] = acotar(cs.getPropertyValue(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)) || "", 200);
  }
  return r;
}

function esFijo(el: Element, ventana: Window, doc: Document): boolean {
  let actual: Element | null = el;
  while (actual && actual !== doc.body) {
    const p = ventana.getComputedStyle(actual).position;
    if (p === "fixed" || p === "sticky") return true;
    actual = actual.parentElement;
  }
  return false;
}

function rect(r: DOMRect, dx = 0, dy = 0): RectDelElemento {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

// ── El payload ────────────────────────────────────────────────────────────────

export function extraerElemento(el: Element, ventana: Window): ElementoSeleccionado {
  const doc = el.ownerDocument;
  const r = el.getBoundingClientRect();
  const clase = el.getAttribute("class") ?? "";
  return {
    page: {
      sanitizedUrl: acotar(sanearUrl(ventana.location.href), 2000),
      title: acotarDuro(doc.title ?? "", PRESUPUESTO.title),
      viewportWidth: ventana.innerWidth,
      viewportHeight: ventana.innerHeight,
      scrollX: ventana.scrollX,
      scrollY: ventana.scrollY,
      devicePixelRatio: ventana.devicePixelRatio || 1,
      capturedAt: new Date().toISOString(),
    },
    target: {
      tagName: acotar(el.tagName.toLowerCase(), 60),
      selector: construirSelector(el, ventana, doc),
      elementPath: rutaLegible(el, ventana, doc),
      fullPath: rutaCompleta(el, ventana, doc),
      cssClasses: contieneSecreto(clase) ? "[redacted]" : acotar(clase, PRESUPUESTO.cssClasses),
      nearbyElements: elementosCercanos(el, doc),
      selectedText: textoSeleccionado(ventana),
      isFixed: esFijo(el, ventana, doc),
      textSnippet: textoAcotado(el, PRESUPUESTO.textSnippet, doc),
      htmlSnippet: htmlDelElemento(el),
      attributes: atributosSeguros(el),
      accessibility: accesibilidad(el, doc),
      rectViewport: rect(r),
      rectPage: rect(r, ventana.scrollX, ventana.scrollY),
      computedStyles: estilos(el, ventana),
    },
    nearbyText: textoCercano(el, doc),
    ancestorPath: ancestros(el, doc),
  };
}

/** El motor rechaza por encima de 16 KB serializado (§3.3) y el widget recorta ANTES de subir.
 * Orden: lo prescindible primero (elementos cercanos, texto cercano, atributos aria), el HTML al
 * final y por mitades; el selector y las rutas —lo que identifica al elemento— nunca. */
export function acotarElemento(e: ElementoSeleccionado): ElementoSeleccionado {
  const largo = (x: ElementoSeleccionado): number => JSON.stringify(x).length;
  if (largo(e) <= MAX_ELEMENTO_CHARS) return e;
  let r: ElementoSeleccionado = { ...e, target: { ...e.target, nearbyElements: [] } };
  if (largo(r) <= MAX_ELEMENTO_CHARS) return r;
  r = { ...r, nearbyText: [] };
  if (largo(r) <= MAX_ELEMENTO_CHARS) return r;
  const sinAria = Object.fromEntries(Object.entries(r.target.attributes).filter(([k]) => !k.startsWith("aria-")));
  r = { ...r, target: { ...r.target, attributes: sinAria } };
  let html = r.target.htmlSnippet;
  while (largo(r) > MAX_ELEMENTO_CHARS && html.length > 64) {
    html = acotar(html.replace(/ \(truncated\)$/, ""), Math.floor(html.length / 2));
    r = { ...r, target: { ...r.target, htmlSnippet: html } };
  }
  return r;
}
