// El elemento que el usuario señaló (§3.1 del diseño): el `BrowserGrabPayload` de Orca
// (github.com/stablyai/orca, MIT, © Lovecast Inc. — LICENSES/orca.txt) sin `screenshot` (la
// captura viaja aparte, §3.2), sin `reactComponents` ni `sourceFile` (dependen de dev tools del
// sitio y no le sirven al agente de fix, que trabaja sobre el repo). Espeja campo a campo el
// `ElementoSeleccionadoSchema` del motor (`src/schemas/evidencia.ts`): lo que el motor rechaza
// no tiene por qué salir del navegador.

export interface RectDelElemento {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaginaDelElemento {
  sanitizedUrl: string;
  title: string;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
  capturedAt: string;
}

export interface AccesibilidadDelElemento {
  role: string | null;
  accessibleName: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
}

export interface ObjetivoDelElemento {
  tagName: string;
  selector: string;
  elementPath: string;
  fullPath: string;
  cssClasses: string;
  nearbyElements: string[];
  selectedText: string | null;
  isFixed: boolean;
  textSnippet: string;
  htmlSnippet: string;
  attributes: Record<string, string>;
  accessibility: AccesibilidadDelElemento;
  rectViewport: RectDelElemento;
  rectPage: RectDelElemento;
  computedStyles: Record<string, string>;
}

export interface ElementoSeleccionado {
  page: PaginaDelElemento;
  target: ObjetivoDelElemento;
  nearbyText: string[];
  ancestorPath: string[];
}
