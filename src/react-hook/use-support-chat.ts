import { useEffect, useRef, useState } from "react";
import { createSupportChat, type Availability, type ChatState, type SupportChat, type SupportChatOptions } from "@supcoflow/chat/core";

// `useSupportChat` (`@supcoflow/chat/react`): el núcleo público (`createSupportChat`) hecho hook para React, y NADA más: no dibuja, no trae CSS ni componentes. Las reglas
// —mandar, reconectar, reintentar sin duplicar, subir adjuntos, la confirmación del reporte— viven en el núcleo y llegan con `npm update`; quien dibuja (el developer o su
// agente de código) escribe la interfaz con los componentes de su app. Acá se resuelve lo que es de React: cuándo se crea el chat, cuándo se destruye, y qué hay mientras
// no hay chat o mientras se sondea si está activo.
//
// Una sola copia del núcleo: este archivo importa `@supcoflow/chat/core` y el build lo deja externo, así el hook y el `createSupportChat` que el developer importe por su
// cuenta son el mismo módulo (un chat por proyecto y por pestaña, P12 del contrato).

export interface UseSupportChatOptions extends SupportChatOptions {
  /** Called once with the answer of the availability check (`GET /api/chat/estado`): the way to learn WHY the chat does not appear. On `localhost` the reason is also logged to the console. The latest function you pass is the one called. */
  onAvailability?: (availability: Availability) => void;
}

export interface UseSupportChat {
  /** The core's `SupportChat`. `null` on the server and in the first render (it is created when the component mounts): do not use it before `available`. */
  chat: SupportChat | null;
  /** What to draw: always the core's latest state. `EMPTY_CHAT_STATE` while there is no chat. */
  state: ChatState;
  /** The answer of the availability check, or `null` until it arrives. */
  availability: Availability | null;
  /** The chat of this project is active for this origin. Until it is `true`, draw nothing (P1 of the presentation contract). */
  available: boolean;
  /** The saved conversation, if there was one, has been rewound from the server (`chat.ready`). Until it is `true`, do not show an empty conversation: the person would see an empty chat that fills in later (P14). Also `false` while there is no chat. */
  ready: boolean;
}

/** The state of a chat that does not exist yet (the same object on the server and in the first render). Frozen all the way down. */
export const EMPTY_CHAT_STATE: ChatState = Object.freeze({
  messages: Object.freeze([]) as unknown as ChatState["messages"],
  pendingQuestion: null,
  busy: false,
  error: null,
  activity: null,
  hasSession: false,
  reported: false,
  attachments: Object.freeze([]) as unknown as ChatState["attachments"],
  canAttachMore: true,
  allows: Object.freeze({ screenshots: true, elements: true, pageAndBrowser: true }),
});

/** Lo que fija qué chat es: otro proyecto o otro backend es OTRO chat. El resto de las opciones (usuario, versión de la app, almacén, idioma) se lee al crearlo, como en `ChatDeIntake`: cambiarlas exige remontar con una `key`. */
function claveDelChat(o: UseSupportChatOptions): string {
  return JSON.stringify([o.tenantId, o.projectId, o.backendUrl ?? ""]);
}

function enLocalhost(): boolean {
  const h = globalThis.location?.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export function useSupportChat(options: UseSupportChatOptions): UseSupportChat {
  const opcionesRef = useRef(options);
  // Las últimas opciones se anotan después de dibujar, no durante el render: un render que React descarta no puede dejar opciones que nunca se confirmaron.
  useEffect(() => {
    opcionesRef.current = options;
  });
  const [chat, setChat] = useState<SupportChat | null>(null);
  // La clave del chat que hay en `chat`: al cambiar de proyecto, el render que sigue al cambio todavía trae el chat anterior; con esto no se le muestra a nadie.
  const [claveDelVivo, setClaveDelVivo] = useState<string | null>(null);
  const [state, setState] = useState<ChatState>(EMPTY_CHAT_STATE);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [ready, setReady] = useState(false);
  const clave = claveDelChat(options);

  useEffect(() => {
    const { onAvailability: _fuera, ...opcionesDelNucleo } = opcionesRef.current;
    void _fuera;
    // Se crea acá y no al renderizar: crear el chat lee `sessionStorage` y arranca la recarga de una charla guardada, y un render puede ocurrir en el servidor, dos veces (StrictMode) o descartarse.
    const nuevo = createSupportChat(opcionesDelNucleo);
    let vivo = true;
    setChat(nuevo);
    setClaveDelVivo(clave);
    setAvailability(null);
    setReady(false);
    // Lo que cambió entre la creación y la suscripción (la recarga ya está rebobinando) no se pierde.
    setState(nuevo.getState());
    const darDeBaja = nuevo.subscribe((s) => {
      if (vivo) setState(s);
    });
    // Si la recarga falla, el núcleo lo deja en `state.error`: igual terminó, y `ready` no puede quedar colgado en `false`.
    const listo = (): void => {
      if (vivo) setReady(true);
    };
    void nuevo.ready.then(listo, listo);
    void nuevo.checkAvailability().then((a) => {
      if (!vivo) return;
      setAvailability(a);
      if (!a.available && enLocalhost()) console.warn("[supcoflow/chat]", a);
      try {
        opcionesRef.current.onAvailability?.(a);
      } catch (e) {
        // El callback es del developer: si lanza, no tumba el chat.
        (typeof reportError === "function" ? reportError : console.error)(e);
      }
    });
    return () => {
      vivo = false;
      darDeBaja();
      // Destruir corta lo que esté en vuelo (turno, recarga, subidas) y libera el selector de elementos: en StrictMode el primer chat no deja nada vivo.
      nuevo.destroy();
      setChat(null);
      setClaveDelVivo(null);
      setState(EMPTY_CHAT_STATE);
      setAvailability(null);
      setReady(false);
    };
  }, [clave]);

  if (chat === null || claveDelVivo !== clave) return { chat: null, state: EMPTY_CHAT_STATE, availability: null, available: false, ready: false };
  return { chat, state, availability, available: availability?.available === true, ready };
}
