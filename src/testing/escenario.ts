// La FORMA de un escenario del banco de pruebas (`@supcoflow/chat/testing`), en inglés como el resto de la API pública, y el adaptador desde la
// grabación en JSON (`core/contrato/*.json`, con claves en castellano: es el archivo que ya usa el test de contrato del núcleo y no se renombra
// por dentro). Un escenario es DATOS: lo que contesta el servidor, en orden, y lo que la persona hace para recorrerlo. Quien necesite un caso
// que el catálogo no tiene arma el objeto a mano con esta misma forma (`docs/testing.md`).

/** Una línea del stream: un evento del protocolo v1 (`docs/protocol-v1.md`) o un texto suelto, para probar lo que no es v1. */
export type ScriptLine = object | string;

/** Una respuesta HTTP que no es un stream: `{ ok: false, motivo }` en un fallo, como la admisión del backend. */
export interface HttpResponse {
  http: number;
  body: object;
}

/** Lo que el servidor contesta a UN pedido de la sesión: un stream NDJSON que termina en su borde (`espera`, `fin` o un `error` terminal), o un fallo HTTP. */
export type ScriptedResponse = { stream: ScriptLine[] } | HttpResponse;

/** Lo que hace la persona (o la interfaz) para recorrer el escenario. Los nombres son los métodos del núcleo. */
export type ScenarioAction =
  | { send: string }
  | { answer: { optionId?: string; text?: string } }
  /** `true`: la confirmación que la interfaz tiene a la vista AHORA. Un texto: el id de una confirmación vieja que quedó guardada (la pantalla vieja). */
  | { confirmReport: true | string }
  | { reviseReport: true | string }
  | { retry: true }
  | { newConversation: true }
  /** Esperar a que termine el rebobinado de una conversación guardada (`ready`). */
  | { waitForRewind: true }
  | { checkAvailability: true }
  /** Señalar un elemento de la página. Necesita un DOM. */
  | { pickElement: true };

export interface Scenario {
  /** Kebab-case, en inglés: es lo que se pide a `createFakeBackend("…")` y a `npx supcoflow-chat-fake …`. */
  name: string;
  /** En inglés, para el developer: qué muestra y por qué importa. */
  description: string;
  /** Los puntos del contrato de presentación (`contract.json`) que este escenario deja ver o comprobar. */
  covers: readonly string[];
  /** Lo que la persona hace, en orden, para llegar al estado final del escenario. */
  script: readonly ScenarioAction[];
  /** Las respuestas del servidor a los pedidos de la sesión (abrir, seguir, recuperar), en el orden en que llegan los pedidos. */
  responses: readonly ScriptedResponse[];
  /** Las respuestas a `POST /api/evidencias`, en orden. Sin ellas (o agotadas) cada subida sale bien con un id propio. */
  evidence?: readonly HttpResponse[];
  /** Lo que contesta `GET /api/chat/estado`. Sin esto: activo, sin restricciones del acuerdo de datos. */
  availability?: { status?: number; body: object };
  /** Para los escenarios de recarga: la conversación que la pestaña ya tenía guardada (`storageWithSavedConversation`). */
  saved?: { id: string; index: number };
}

// --- la grabación en JSON ------------------------------------------------------------------------------------------------------------------

type AccionGrabada =
  | { send: string }
  | { answer: { optionId?: string; text?: string } }
  | { confirmReport: true | string }
  | { reviseReport: true | string }
  | { retry: true }
  | { newConversation: true }
  | { esperarRebobinado: true }
  | { checkAvailability: true }
  | { pickElement: true };
type RespuestaGrabada = { stream: ScriptLine[] } | { http: number; cuerpo: object };

/** El archivo tal como está en `core/contrato/`. `esperado` es de los tests del núcleo y no sale al banco de pruebas. */
export interface Grabacion {
  descripcion: string;
  guardado?: { id: string; indice: number };
  permite?: { capturas: boolean; elementos: boolean; pagina_y_navegador: boolean };
  disponibilidad?: { status?: number; cuerpo: object };
  acciones: AccionGrabada[];
  respuestas: RespuestaGrabada[];
  evidencias?: { http: number; cuerpo: object }[];
  esperado?: unknown;
}

const http = (r: { http: number; cuerpo: object }): HttpResponse => ({ http: r.http, body: r.cuerpo });
const respuesta = (r: RespuestaGrabada): ScriptedResponse => ("http" in r ? http(r) : { stream: r.stream });
const accion = (a: AccionGrabada): ScenarioAction => ("esperarRebobinado" in a ? { waitForRewind: true } : a);

/** Congela hasta el fondo: un escenario es un dato compartido, y uno que se toca no tiene que cambiar el de los demás. */
export function congelar<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) congelar(v);
  }
  return x;
}

export function escenarioDesdeGrabacion(g: Grabacion, ficha: { name: string; description: string; covers: readonly string[] }): Scenario {
  const disponibilidad = g.disponibilidad !== undefined
    ? { ...(g.disponibilidad.status === undefined ? {} : { status: g.disponibilidad.status }), body: g.disponibilidad.cuerpo }
    : g.permite !== undefined ? { body: { ok: true, motivo: null, marca: null, permite: g.permite } } : undefined;
  return congelar({
    name: ficha.name,
    description: ficha.description,
    covers: [...ficha.covers],
    script: g.acciones.map(accion),
    responses: g.respuestas.map(respuesta),
    ...(g.evidencias === undefined ? {} : { evidence: g.evidencias.map(http) }),
    ...(disponibilidad === undefined ? {} : { availability: disponibilidad }),
    ...(g.guardado === undefined ? {} : { saved: { id: g.guardado.id, index: g.guardado.indice } }),
  });
}
