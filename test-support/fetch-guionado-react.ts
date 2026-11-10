// Un `fetch` guionado para las pruebas de la interfaz de React (el hook y los componentes copiables): ninguna habla con un backend. Cada ruta tiene una
// cola de respuestas; una ruta sin cola contesta un borde `espera` vacío. Lo que se MANDÓ queda en `llamadas`, con el cuerpo ya parseado.

export const NDJSON = { "content-type": "application/x-ndjson" };

/** Una línea por evento, todas v1. */
export const nd = (...eventos: object[]): string => eventos.map((e) => JSON.stringify({ v: 1, ...e })).join("\n") + "\n";

export interface Llamada {
  metodo: string;
  url: string;
  ruta: string;
  cuerpo?: unknown;
  signal?: AbortSignal | null;
}

export type Respuesta = string | Response | (() => string | Response | Promise<string | Response>);

export const ESTADO_OK = JSON.stringify({ ok: true, motivo: null, marca: null });

export function fetchGuionado(rutas: Record<string, Respuesta[]>): { fn: typeof fetch; llamadas: Llamada[]; restantes: () => number } {
  const llamadas: Llamada[] = [];
  const fn = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const u = new URL(url);
    llamadas.push({ metodo: init?.method ?? "GET", url, ruta: u.pathname + u.search, ...(typeof init?.body === "string" ? { cuerpo: JSON.parse(init.body) } : {}), signal: init?.signal });
    // La ruta más específica gana (`/api/chat/sesion/s1/eventos` antes que `/api/chat/sesion`).
    const clave = Object.keys(rutas).filter((k) => url.includes(k)).sort((a, b) => b.length - a.length)[0];
    if (clave === undefined) throw new Error(`fetch inesperado: ${url}`);
    const siguiente = rutas[clave]!.shift();
    const r = typeof siguiente === "function" ? await siguiente() : siguiente;
    if (r instanceof Response) return r;
    if (r === undefined) return new Response(nd({ t: "espera", indice: 99 }), { status: 200, headers: NDJSON });
    return new Response(r, { status: 200, headers: NDJSON });
  }) as typeof fetch;
  return { fn, llamadas, restantes: () => Object.values(rutas).reduce((n, c) => n + c.length, 0) };
}

/** Deja correr las promesas y los timers pendientes: lo que React y el núcleo resuelven en microtareas. */
export async function tick(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
