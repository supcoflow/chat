import { Fragment } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { Respuesta } from "../cliente";
import { agruparMensajes, mostrarIndicador, reintentarSirve, textoDelError, textoDelPaso, type Desenlace, type EstadoDelChat } from "../estado";
import { TEXTOS } from "../textos";
import { Avatar } from "./Inicio";
import { Markdown } from "./Markdown";
import { PreguntaHitl } from "./PreguntaHitl";
import { TextoDelUsuario } from "./TextoDelUsuario";

/** Hasta cuántos px por encima del fondo la lista vuelve a quedar «pegada» cuando la persona baja (absorbe subpíxeles y un renglón a medias). Subir, aunque sea poco, la despega (`alDesplazar`). */
const MARGEN_DEL_FONDO = 16;

function ultimaClaveDelUsuario(e: EstadoDelChat): number | null {
  for (let i = e.mensajes.length - 1; i >= 0; i--) {
    const m = e.mensajes[i]!;
    if (m.rol === "usuario") return m.clave;
  }
  return null;
}

export function Mensajes(props: { estado: EstadoDelChat; titulo: string; logoUrl: string | null; onReintentar: () => void; onResponder: (r: Respuesta) => void; onNuevaConversacion: () => void; /** Lo que acompaña al reporte que se está confirmando (la nota de la pregunta `tool-approval`). */ notaDeEvidencia?: string | null }) {
  const { estado } = props;
  const lista = useRef<HTMLDivElement>(null);
  // «Pegada al fondo» se decide ANTES de que la lista cambie, no después: lo que cambia (una frase larga de golpe, la burbuja propia más «Thinking…», una lista) puede agregar cientos
  // de px de una vez, y medir la distancia al fondo DESPUÉS del cambio dejaba la respuesta escondida bajo el borde del panel (2.3.1 y antes: umbral de 80 px sobre lo ya cambiado).
  // La referencia se actualiza en el evento `scroll`, y sólo la persona la despega: subir (bajar el `scrollTop`) la suelta, aunque sea poco; un cambio de alto que no es de ella —el cuadro
  // de escribir que crece, el teclado del celular, la ventana— deja el `scrollTop` donde estaba (o lo acota hacia el fondo) y el `scroll` propio del navegador al reacomodar NO la despega.
  const pegada = useRef(true);
  const ultimoTop = useRef(0);
  const alDesplazar = () => {
    const el = lista.current;
    if (el === null) return;
    const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
    const subio = el.scrollTop < ultimoTop.current - 1; // el navegador nunca baja el `scrollTop` por un cambio de alto, salvo al acotarlo contra el fondo (y ahí la distancia es 0)
    pegada.current = distancia <= 1 ? true : subio ? false : pegada.current || distancia <= MARGEN_DEL_FONDO;
    // Una bajada chica NO mueve la referencia: así varias seguidas (un dedo o un trackpad que suben despacio, ≤ 1 px por evento) suman hasta pasar de 1 px. Sólo baja al llegar al fondo o al detectar la subida.
    ultimoTop.current = distancia <= 1 || subio ? el.scrollTop : Math.max(ultimoTop.current, el.scrollTop);
  };
  const alFondo = (el: HTMLElement) => { el.scrollTop = el.scrollHeight; ultimoTop.current = el.scrollTop; };
  const ultimoDelUsuario = useRef<number | null>(null);
  // El alto del panel cambia sin que Preact dibuje nada (el compositor ajusta su textarea en un efecto, DESPUÉS del de esta lista): el observador la sigue antes de pintar.
  useLayoutEffect(() => {
    const el = lista.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => { if (pegada.current) alFondo(el); });
    observador.observe(el);
    return () => observador.disconnect();
  }, []);
  // Mandar un mensaje, apretar un botón de respuesta o reintentar bajan SIEMPRE al fondo: es lo que espera cualquier chat, y la persona tiene que ver lo suyo y la respuesta.
  const bajarSiempre = () => { pegada.current = true; };
  // Sin dependencias a propósito: corre en cada dibujo (el estado cambia, o la persona escribe y el compositor cambia el alto del panel) y no hace nada si la persona subió a leer.
  useLayoutEffect(() => {
    const el = lista.current;
    if (el === null) return;
    // Un mensaje NUEVO de la persona (lo que escribió, o la etiqueta del botón que apretó) vuelve a pegar la lista al fondo; confirmarlo (`abierto` → cerrado) no es uno nuevo.
    const claveDelUltimo = ultimaClaveDelUsuario(estado);
    if (claveDelUltimo !== ultimoDelUsuario.current) {
      ultimoDelUsuario.current = claveDelUltimo;
      if (claveDelUltimo !== null) pegada.current = true;
    }
    if (pegada.current) alFondo(el);
  });

  const grupos = agruparMensajes(estado.mensajes);

  return (
    <div class="scf-mensajes" ref={lista} onScroll={alDesplazar} aria-live="polite">
      {grupos.map((g) =>
        g.rol === "desenlace" ? (
          g.mensajes.map((m) => m.rol === "desenlace" && <TarjetaDeDesenlace key={m.clave} desenlace={m.desenlace} puedeEmpezarOtra={estado.cursor !== null && !estado.ocupado} onNuevaConversacion={props.onNuevaConversacion} />)
        ) : (
          <div key={g.mensajes[0]!.clave} class={`scf-grupo scf-grupo--${g.rol}`}>
            {g.rol === "asistente" && <Avatar titulo={props.titulo} logoUrl={props.logoUrl} />}
            <div class="scf-grupo-cuerpo">
              {g.mensajes.map((m) =>
                m.rol === "desenlace" ? null : (
                  <Fragment key={m.clave}>
                    {/* Los pasos que el agente dio en el turno de esta respuesta: una línea cada uno, texto fijo del widget. */}
                    {m.rol === "asistente" && m.pasos !== undefined && m.pasos.length > 0 && (
                      <ul class="scf-pasos">
                        {m.pasos.map((p) => (
                          <li key={textoDelPaso(p)} class="scf-paso">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>
                            {textoDelPaso(p)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div class={`scf-msg scf-msg--${m.rol}`}>
                      {/* Lo del usuario se dibuja como lo escribió (colapsado si es un pegado largo); lo del asistente, con formato (§2.2). La copia de la
                          confirmación del reporte es texto plano, antes y después de contestarla (P6): lo que la persona lee es lo que se manda. */}
                      {m.rol === "usuario" ? <TextoDelUsuario texto={m.texto} /> : m.copiaDelReporte === true ? <p class="scf-plano">{m.texto}</p> : <Markdown texto={m.texto} />}
                    </div>
                  </Fragment>
                ),
              )}
            </div>
          </div>
        ),
      )}
      {estado.pregunta !== null && <PreguntaHitl pregunta={estado.pregunta} ocupado={estado.ocupado} onResponder={(r) => { bajarSiempre(); props.onResponder(r); }} nota={estado.pregunta.kind === "tool-approval" ? props.notaDeEvidencia : null} />}
      {mostrarIndicador(estado) && (
        // 2.3.0 (H12): con `actividad`, el indicador dice qué está haciendo el agente; sin ella, «Thinking…». Los dos son el mismo indicador de trabajo.
        <div class="scf-grupo scf-grupo--asistente scf-indicador" aria-label={estado.actividad === "leyendo_la_guia" ? TEXTOS.leyendoLaGuia : TEXTOS.pensando}>
          <Avatar titulo={props.titulo} logoUrl={props.logoUrl} />
          <div class="scf-grupo-cuerpo">
            {estado.actividad === "leyendo_la_guia" ? (
              <div class="scf-msg scf-msg--asistente scf-trabajando"><span class="scf-pensando">{TEXTOS.leyendoLaGuia}</span></div>
            ) : (
              <div class="scf-msg scf-msg--asistente scf-trabajando"><span class="scf-pensando">{TEXTOS.pensando}</span></div>
            )}
          </div>
        </div>
      )}
      {estado.error !== null && (
        <div class="scf-error" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></svg>
          <span>{textoDelError(estado.error.codigo)}</span>
          {reintentarSirve(estado.error) && <button type="button" onClick={() => { bajarSiempre(); props.onReintentar(); }}>{TEXTOS.reintentar}</button>}
        </div>
      )}
    </div>
  );
}

/** 2.3.0 (spec §6, H10/H11): la tarjeta del reporte y el chip de la respuesta. El texto es del
 * widget, nunca del modelo: así la promesa no depende del prompt. */
function TarjetaDeDesenlace(props: { desenlace: Desenlace; puedeEmpezarOtra: boolean; onNuevaConversacion: () => void }) {
  const d = props.desenlace;
  if (d.que === "respondida") {
    return (
      <div class="scf-desenlace scf-desenlace--respondida" role="status">
        <span class="scf-chip-desenlace">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>
          {TEXTOS.respondida}
        </span>
      </div>
    );
  }
  return (
    <div class="scf-desenlace scf-desenlace--reportado" role="status">
      <div class="scf-tarjeta">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>
        <div>
          <b>{TEXTOS.reportado}</b>
          {d.reporte !== null && <small>{TEXTOS.reporte} <code>{d.reporte}</code></small>}
          {/* Lo que el chat sabe: el reporte quedó cerrado. Lo que hará el equipo con él, no (no hay con qué respaldarlo). */}
          <small>{TEXTOS.reporteCerrado}</small>
        </div>
      </div>
      {/* T0.7 (D2): recargar retoma la MISMA sesión; esta es la salida. Sólo mientras hay sesión que cerrar. */}
      {props.puedeEmpezarOtra && <button type="button" class="scf-nueva" onClick={props.onNuevaConversacion}>{TEXTOS.nuevaConversacion}</button>}
    </div>
  );
}
