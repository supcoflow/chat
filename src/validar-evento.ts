import type { EventoDelWidget } from "./protocolo";

// La FORMA de cada evento del cable v1, como dato: es la fuente única de dos cosas —el validador de abajo (entrada no confiable) y el control de
// `docs/protocol-v1.md` (`core/docs.test.ts` compara nombres de campos y cuáles son opcionales con la primera línea de forma de cada evento)—.
// Dentro de v1 sólo se agregan campos: uno nuevo se ignora acá (el validador no mira lo que no conoce) y entra en esta tabla cuando se documenta.

export type TipoDeCampo = "string" | "string?" | "number" | "boolean" | "string|null?" | "opciones" | "reporte?";

export const FORMA_V1: Readonly<Record<EventoDelWidget["t"], Readonly<Record<string, TipoDeCampo>>>> = {
  sesion: { id: "string", indice: "number" },
  usuario: { texto: "string" },
  texto: { delta: "string" },
  asistente: { texto: "string" },
  pregunta: { requestId: "string", kind: "string", prompt: "string", opciones: "opciones", libre: "boolean", reporte: "reporte?" },
  pregunta_resuelta: { requestId: "string", outcome: "string", optionId: "string?", text: "string?" },
  herramienta: { nombre: "string", resumen: "string", resultado: "string?" },
  actividad: { que: "string" },
  paso: { que: "string", seccion: "string?" },
  desenlace: { que: "string", reporte: "string|null?" },
  espera: { indice: "number" },
  fin: {},
  error: { codigo: "string", mensaje: "string", terminal: "boolean" },
};

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function cumple(tipo: TipoDeCampo, valor: unknown): boolean {
  switch (tipo) {
    case "string": return typeof valor === "string";
    case "string?": return valor === undefined || typeof valor === "string";
    case "number": return typeof valor === "number" && Number.isFinite(valor);
    case "boolean": return typeof valor === "boolean";
    case "string|null?": return valor === undefined || valor === null || typeof valor === "string";
    case "reporte?": return valor === undefined || (esObjeto(valor) && typeof valor.titulo === "string" && typeof valor.cuerpo === "string");
    case "opciones": return Array.isArray(valor) && valor.every((o) => esObjeto(o) && typeof o.id === "string" && typeof o.label === "string" && typeof o.style === "string");
  }
}

/** El evento tal cual si está bien formado o es de un `t` que no se conoce (compatibilidad: un v1 futuro no tumba a un cliente viejo); `null` si es
 * un evento conocido al que le falta un campo o lo trae de otro tipo. Los campos de más se dejan: nadie los lee. */
export function normalizarEvento(x: unknown): EventoDelWidget | null {
  if (!esObjeto(x) || typeof x.t !== "string") return null;
  if (!Object.hasOwn(FORMA_V1, x.t)) return x as unknown as EventoDelWidget;
  const forma = FORMA_V1[x.t as EventoDelWidget["t"]];
  for (const [campo, tipo] of Object.entries(forma)) if (!cumple(tipo, x[campo])) return null;
  return x as unknown as EventoDelWidget;
}
