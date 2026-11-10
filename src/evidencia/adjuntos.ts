import type { ImagenLista } from "./captura";
import type { ElementoSeleccionado } from "./elemento";

// Lo que el usuario adjuntó en esta conversación, en puro (el idioma de estado.ts). Cuatro
// estados porque la subida es asíncrona y puede fallar, y porque se puede adjuntar ANTES de que
// exista la sesión (Revisión 2 punto 2): un adjunto nace `pendiente` y Widget.tsx lo sube cuando
// hay cursor. El componente sólo dibuja esto.

/** El motor cuenta 5 evidencias por sesión, de cualquier tipo, y el `contexto` que reenvía `abrir`
 * ocupa una (Revisión 2 punto 4). Cuatro acá, antes que un quinto que siempre rebota con 429. */
export const MAX_ADJUNTOS = 4;

export type EstadoDeSubida = "pendiente" | "subiendo" | "listo" | "fallo";

interface AdjuntoBase {
  clave: number;
  estado: EstadoDeSubida;
  evidenciaId: string | null;
  motivo: string | null;
  /** Con `fallo`: si vale la pena ofrecer «reintentar» (red, motor caído) o no (tope, rechazo). */
  reintentable: boolean;
  /** Ya estaba subido cuando se creó el reporte (`sellarReporte`): fue con él. Lo que sube después no va con ningún reporte. */
  enReporte: boolean;
}

export type Adjunto =
  | (AdjuntoBase & { tipo: "elemento"; elemento: ElementoSeleccionado; etiqueta: string })
  | (AdjuntoBase & { tipo: "captura"; imagen: ImagenLista });

export interface EstadoDeAdjuntos {
  adjuntos: Adjunto[];
  siguienteClave: number;
}

export function sinAdjuntos(): EstadoDeAdjuntos {
  return { adjuntos: [], siguienteClave: 1 };
}

export function puedeAgregar(e: EstadoDeAdjuntos): boolean {
  return e.adjuntos.length < MAX_ADJUNTOS;
}

const BASE = { estado: "pendiente" as const, evidenciaId: null, motivo: null, reintentable: true, enReporte: false };

// `Omit<Adjunto, keyof AdjuntoBase>` no alcanza: `keyof` de una unión sólo da las claves
// compartidas, así que tira `elemento`/`etiqueta`/`imagen`. Este condicional distribuye sobre
// cada miembro de la unión antes de omitir, y sí los conserva.
type SinBase<T> = T extends unknown ? Omit<T, keyof AdjuntoBase> : never;

function agregar(e: EstadoDeAdjuntos, a: SinBase<Adjunto>): EstadoDeAdjuntos {
  if (!puedeAgregar(e)) return e;
  return { adjuntos: [...e.adjuntos, { ...BASE, ...a, clave: e.siguienteClave } as Adjunto], siguienteClave: e.siguienteClave + 1 };
}

/** «button «Guardar»»: lo que el chip muestra. El nombre accesible antes que el texto, y corto. */
export function etiquetaDelElemento(el: ElementoSeleccionado): string {
  const texto = (el.target.accessibility.accessibleName ?? el.target.textSnippet ?? "").replace(/ \(truncated\)$/, "").trim();
  const corto = texto.length > 36 ? `${texto.slice(0, 33)}…` : texto;
  return corto === "" ? el.target.tagName : `${el.target.tagName} «${corto}»`;
}

export function agregarElemento(e: EstadoDeAdjuntos, elemento: ElementoSeleccionado): EstadoDeAdjuntos {
  return agregar(e, { tipo: "elemento", elemento, etiqueta: etiquetaDelElemento(elemento) });
}

export function agregarCaptura(e: EstadoDeAdjuntos, imagen: ImagenLista): EstadoDeAdjuntos {
  return agregar(e, { tipo: "captura", imagen });
}

export function quitar(e: EstadoDeAdjuntos, clave: number): EstadoDeAdjuntos {
  if (!e.adjuntos.some((a) => a.clave === clave)) return e;
  return { ...e, adjuntos: e.adjuntos.filter((a) => a.clave !== clave) };
}

export function marcar(
  e: EstadoDeAdjuntos,
  clave: number,
  cambio: { estado: EstadoDeSubida; evidenciaId?: string; motivo?: string; reintentable?: boolean },
): EstadoDeAdjuntos {
  return {
    ...e,
    adjuntos: e.adjuntos.map((a) =>
      a.clave !== clave
        ? a
        : ({
            ...a,
            estado: cambio.estado,
            evidenciaId: cambio.evidenciaId ?? a.evidenciaId,
            motivo: cambio.motivo ?? null,
            reintentable: cambio.reintentable ?? a.reintentable,
          } as Adjunto),
    ),
  };
}

export function pendientes(e: EstadoDeAdjuntos): Adjunto[] {
  return e.adjuntos.filter((a) => a.estado === "pendiente");
}

export function ultimoElemento(e: EstadoDeAdjuntos): Extract<Adjunto, { tipo: "elemento" }> | null {
  for (let i = e.adjuntos.length - 1; i >= 0; i--) {
    const a = e.adjuntos[i];
    if (a.tipo === "elemento") return a;
  }
  return null;
}

/** Se creó el reporte: lo que está `listo` en este momento FUE con él (el motor enlaza la evidencia al crearlo). */
export function sellarReporte(e: EstadoDeAdjuntos): EstadoDeAdjuntos {
  if (!e.adjuntos.some((a) => a.estado === "listo" && !a.enReporte)) return e;
  return { ...e, adjuntos: e.adjuntos.map((a) => (a.estado === "listo" ? ({ ...a, enReporte: true } as Adjunto) : a)) };
}
