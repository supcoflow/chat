import { TEMA_POR_DEFECTO, TITULO_POR_DEFECTO, type OpcionesDelChat, type TemaDelChat } from "./opciones";
import { TEXTOS } from "./textos";

// §3.3 del diseño de la marca (2026-09-08): la apariencia se resuelve en TRES niveles, de abajo
// hacia arriba — defaults del widget → marca del motor (lo que el cliente guardó desde la consola)
// → opciones del código del cliente. El código gana porque un deploy es una decisión más
// deliberada que un formulario, y porque es lo que hace que el preview del PR 3 muestre lo que hay
// en el formulario y no lo guardado. `variablesDelTema` no cambia: sólo cambia qué tema recibe, y
// su regla contra `;{}` sigue aplicando al resultado (un valor malo de la marca cae al default).
//
// El saludo se resuelve desde la 2.2.0, cuando la pantalla de inicio lo dibuja (§5 de la marca).

/** La marca tal cual la manda el backend (`GET /api/chat/estado`, snake_case). Todo opcional: un
 * backend viejo no la manda y el widget usa sus defaults — nunca se adivina, como con `motivo`. */
export interface MarcaDelMotor {
  logo_url?: string | null;
  titulo?: string | null;
  saludo?: string | null;
  tema?: Partial<TemaDelChat> | null;
}

export interface Apariencia {
  titulo: string;
  saludo: string;
  logoUrl: string | null;
  tema: TemaDelChat;
}

const CLAVES_DEL_TEMA: (keyof TemaDelChat)[] = ["acento", "fondo", "texto", "textoSuave", "radio", "fuente"];

function temaDeLaMarca(t: unknown): Partial<TemaDelChat> {
  if (typeof t !== "object" || t === null) return {};
  const r: Partial<TemaDelChat> = {};
  for (const k of CLAVES_DEL_TEMA) {
    const v = (t as Record<string, unknown>)[k];
    if (typeof v === "string" && v !== "") r[k] = v;
  }
  return r;
}

/** El motor sólo escribe URLs de Blob, pero esto termina en el `src` de un `<img>` dentro del
 * sitio de un tercero: sólo https, y punto. */
function logoAdmisible(u: unknown): string | null {
  return typeof u === "string" && /^https:\/\//.test(u) ? u : null;
}

export function resolverApariencia(o: Pick<OpcionesDelChat, "titulo" | "saludo" | "tema">, marca: unknown): Apariencia {
  const m = (typeof marca === "object" && marca !== null ? marca : {}) as MarcaDelMotor;
  const tituloDeLaMarca = typeof m.titulo === "string" && m.titulo.trim() !== "" ? m.titulo : undefined;
  const saludoDeLaMarca = typeof m.saludo === "string" && m.saludo.trim() !== "" ? m.saludo : undefined;
  return {
    titulo: o.titulo ?? tituloDeLaMarca ?? TITULO_POR_DEFECTO,
    saludo: o.saludo ?? saludoDeLaMarca ?? TEXTOS.saludoPorDefecto,
    logoUrl: logoAdmisible(m.logo_url),
    tema: { ...TEMA_POR_DEFECTO, ...temaDeLaMarca(m.tema), ...(o.tema ?? {}) },
  };
}
