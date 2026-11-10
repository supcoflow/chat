import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Respuesta } from "../cliente";
import type { ControladorDelChat, EstadoDelNucleo } from "../core/controlador";
import { mostrarInicio } from "../estado";
import { puedeAgregar, ultimoElemento } from "../evidencia/adjuntos";
import { lineaDeLoQueAcompana } from "../evidencia/lo-que-acompana";
import type { RectDelElemento } from "../evidencia/elemento";
import type { OpcionesResueltas } from "../opciones";
import { TEXTOS } from "../textos";
import { Adjuntos } from "./Adjuntos";
import { expandirPegados, insertarPegado, largoExpandido, MAX_MENSAJE, vigentesDe, type Pegado } from "../pegado";
import { Burbuja } from "./Burbuja";
import { Compositor } from "./Compositor";
import { Inicio } from "./Inicio";
import { Mensajes } from "./Mensajes";
import { Panel } from "./Panel";

// El widget es la INTERFAZ del núcleo: dibuja `EstadoDelNucleo` y llama a `ControladorDelChat`. Las reglas —mandar, reconectar,
// reintentar sin duplicar, subir adjuntos, guardar el cursor— no viven acá sino en `core/controlador.ts`, que es lo mismo que usa
// quien arma su propia interfaz con `@supcoflow/chat/core`. Acá quedan sólo el panel (abierto/cerrado), el texto del compositor y
// los avisos de las acciones de adjuntar, que son del dibujo.

/** El controlador, como estado de Preact: se re-dibuja con cada cambio. */
function useNucleo(controlador: ControladorDelChat): EstadoDelNucleo {
  const [estado, setEstado] = useState<EstadoDelNucleo>(() => controlador.estado());
  useEffect(() => {
    // Lo que cambió entre el primer dibujo y la suscripción (la recarga ya está rebobinando) no se pierde.
    setEstado(controlador.estado());
    return controlador.suscribir(() => setEstado(controlador.estado()));
  }, [controlador]);
  return estado;
}

export default function Widget(props: {
  controlador: ControladorDelChat;
  opciones: OpcionesResueltas;
  /** De la marca del motor (§3.3); `null` = sin logo. */
  logoUrl: string | null;
  /** La segunda línea de la pantalla de inicio (2.2.0, §5 de la marca): opciones del código → marca
   * del motor → default, ya resuelto por `resolverApariencia`. */
  saludo: string;
  /** §2/§5.3 del diseño de la marca: rótulo en la cabecera y la evidencia apagada — en el preview no
   * hay `chat_conversaciones` que la reciba, y una captura de pantalla del modal no tiene que
   * confundirse con el chat real. */
  enPreview: boolean;
  abiertoAlInicio: boolean;
  /** El host de nuestro shadow root: el selector no lo puede elegir (señalar el chat no es un bug del sitio). */
  hostDelWidget: Element | null;
}) {
  const { controlador, opciones } = props;
  const { chat: estado, adjuntos, permisos } = useNucleo(controlador);
  const [abierto, setAbierto] = useState(opciones.modo === "inline" || props.abiertoAlInicio || opciones.abierto);
  const [entrada, setEntrada] = useState("");
  // Los pegados largos viven aparte del textarea (en él queda su marca) y se expanden al enviar: se mandan completos.
  const [pegados, setPegados] = useState<Pegado[]>([]);
  const [avisoDelPegado, setAvisoDelPegado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Mientras se captura, ni el panel ni la burbuja se dibujan: la captura es de la página, no del chat.
  const [capturando, setCapturando] = useState(false);
  const puedeCapturar = controlador.puedeCapturar;

  // Extraído de `enviar` (2.2.0) para que un arranque de la pantalla de inicio pueda mandar su
  // texto directo, sin pasar por `entrada`: si pasara por ahí, el textarea lo mostraría un frame
  // antes de vaciarse de nuevo. `enviar` (el compositor) es el envoltorio de siempre.
  const enviarTexto = useCallback((texto: string) => {
    if (texto === "" || controlador.estado().chat.ocupado) return;
    setEntrada("");
    setPegados([]);
    setAvisoDelPegado(null);
    setAviso(null);
    void controlador.enviar(texto);
  }, [controlador]);

  const enviar = useCallback(() => enviarTexto(expandirPegados(entrada, pegados).trim()), [enviarTexto, entrada, pegados]);
  const pegar = useCallback((p: { texto: string; inicio: number; fin: number }) => {
    const r = insertarPegado(entrada, pegados, p, MAX_MENSAJE);
    // Lo que no entra en el mensaje se corta, pero NO en silencio: la marca no lo muestra, así que se le dice a la persona.
    setAvisoDelPegado(r.entraron === 0 ? TEXTOS.pegadoNoEntra : r.recortado > 0 ? `${TEXTOS.pegadoRecortadoA} ${r.entraron.toLocaleString("en-US")} ${TEXTOS.pegadoRecortadoB}` : null);
    if (r.cursor === null) return undefined; // no cambió nada: no hay cursor que mover
    setEntrada(r.valor);
    setPegados(r.pegados);
    return r.cursor;
  }, [entrada, pegados]);
  const responder = useCallback((r: Respuesta) => void controlador.responder(r), [controlador]);
  // T0.7: borra el cursor y deja los mensajes; el controlador lo saca de sessionStorage.
  const nuevaConversacion = useCallback(() => controlador.nuevaConversacion(), [controlador]);
  const reintentar = useCallback(() => void controlador.reintentar(), [controlador]);

  // ── Señalar (§3.1) ──────────────────────────────────────────────────────────
  const senalar = useCallback(() => {
    const r = controlador.senalar({
      ignorar: props.hostDelWidget,
      alElegir: () => { setAviso(null); setAbierto(true); },
      alCancelar: () => { setAviso(null); setAbierto(true); },
    });
    // «no_permitido» no se ve: sin el permiso del acuerdo de datos el botón ni se dibuja.
    if (r === "tope") setAviso(TEXTOS.topeDeAdjuntos);
    else if (r === "iniciado") {
      setAviso(TEXTOS.seleccionando);
      setAbierto(false); // el panel se pliega mientras se elige
    }
  }, [controlador, props.hostDelWidget]);

  // ── Capturar (§3.2) ─────────────────────────────────────────────────────────
  const capturar = useCallback(async (recorte: RectDelElemento | null) => {
    // 2.3.1: el permiso de pantalla se pide con el chat A LA VISTA; sólo se oculta cuando ya hay permiso y falta el frame, y SIEMPRE vuelve a mostrarse.
    const r = await controlador.capturar({ recorte, ocultar: () => setCapturando(true), mostrar: () => setCapturando(false) });
    if (r === "tope") setAviso(TEXTOS.topeDeAdjuntos);
    else if (r === "sin_captura") setAviso(TEXTOS.sinCaptura);
    else if (r === "ok") setAviso(null);
  }, [controlador]);

  const adjuntarImagen = useCallback(async (archivo: File) => {
    const r = await controlador.adjuntarImagen(archivo);
    if (r === "tope") setAviso(TEXTOS.topeDeAdjuntos);
    else if (r === "imagen_invalida") setAviso(TEXTOS.imagenInvalida);
    else if (r === "ok") setAviso(null);
  }, [controlador]);

  // «Capturar este elemento» recorta al rect del elemento en el momento en que se señaló; si el
  // usuario hizo scroll después, «Capturar pantalla» es el camino. Se ofrece sólo si lo último que
  // adjuntó es un elemento y el navegador sabe capturar.
  const elementoReciente = ultimoElemento(adjuntos);
  const capturarElemento =
    puedeCapturar && permisos.capturas && elementoReciente !== null && adjuntos.adjuntos[adjuntos.adjuntos.length - 1] === elementoReciente
      ? () => void capturar(elementoReciente.elemento.target.rectViewport)
      : null;

  // Esc cierra el panel (§2.1). Con el selector activo no hace falta: él lo maneja y el panel está plegado.
  useEffect(() => {
    if (!abierto || opciones.modo === "inline") return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierto, opciones.modo]);

  if (capturando) return null;

  // Sin sesión y sin mensajes: la pantalla de inicio, no la lista de mensajes (2.2.0, §5 de la
  // marca). La cabecera se adapta (`sinTitulo`): el saludo ya dice quién es.
  const enInicio = mostrarInicio(estado);

  return (
    <>
      {abierto && (
        <Panel titulo={opciones.titulo} logoUrl={props.logoUrl} enPreview={props.enPreview} modo={opciones.modo} posicion={opciones.posicion} sinTitulo={enInicio} onMinimizar={() => setAbierto(false)}>
          {enInicio ? (
            <Inicio titulo={opciones.titulo} logoUrl={props.logoUrl} nombre={opciones.usuario.nombre} saludo={props.saludo} onArranque={enviarTexto} />
          ) : (
            <Mensajes estado={estado} titulo={opciones.titulo} logoUrl={props.logoUrl} onReintentar={reintentar} onResponder={responder} onNuevaConversacion={nuevaConversacion} notaDeEvidencia={props.enPreview ? null : lineaDeLoQueAcompana(adjuntos.adjuntos)} />
          )}
          <div class="scf-pie">
            <Compositor
              valor={entrada}
              onCambio={setEntrada}
              onEnviar={enviar}
              onPegar={pegar}
              pegados={vigentesDe(entrada, pegados)}
              aviso={avisoDelPegado}
              maxLargo={Math.max(0, MAX_MENSAJE - (largoExpandido(entrada, pegados) - entrada.length))}
              deshabilitado={estado.ocupado}
              enfocarAlMontar={abierto}
              adjuntos={
                props.enPreview ? null : (
                  <Adjuntos
                    adjuntos={adjuntos.adjuntos}
                    ocupado={estado.ocupado}
                    aviso={aviso}
                    reportado={estado.reportado}
                    onCapturarElemento={estado.reportado ? null : capturarElemento}
                    onQuitar={(clave) => controlador.quitarAdjunto(clave)}
                    onReintentar={(clave) => controlador.reintentarAdjunto(clave)}
                  />
                )
              }
              herramientas={
                // Con el reporte ya enviado no se ofrece adjuntar: el motor enlaza la evidencia al CREARLO y lo nuevo no iría con ningún reporte.
                // Sin el permiso de elementos ni el de capturas del acuerdo de datos, no hay nada que ofrecer.
                props.enPreview || estado.reportado || (!permisos.elementos && !permisos.capturas)
                  ? null
                  : {
                      puedeSenalar: permisos.elementos,
                      puedeAdjuntarImagenes: permisos.capturas,
                      onSenalar: senalar,
                      onCapturarPantalla: () => void capturar(null),
                      onAdjuntarImagen: (f) => void adjuntarImagen(f),
                      puedeCapturar,
                      puedeAdjuntar: puedeAgregar(adjuntos),
                    }
              }
            />
            {/* La disclosure ya vivía en la cabecera; acá se suma la atribución (§5 de la marca). */}
            <p class="scf-marca">{TEXTOS.asistenteAutomatico} · <b>{TEXTOS.atribucion}</b></p>
          </div>
        </Panel>
      )}
      {opciones.modo === "burbuja" && <Burbuja posicion={opciones.posicion} abierto={abierto} onClick={() => setAbierto((a) => !a)} />}
    </>
  );
}
