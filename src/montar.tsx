import { render } from "preact";
import { resolverApariencia } from "./apariencia";
import { crearCliente } from "./cliente";
import { ControladorDelChat } from "./core/controlador";
import { consultarDisponibilidad } from "./core/disponibilidad";
import { cabeceraDelSdk } from "./core/version";
import type { ErrorVisible } from "./estado";
import { diagnosticoDesdeRespuesta, permisosDesdeRespuesta } from "./estado-del-widget";
import { normalizarOpciones, type Diagnostico, type OpcionesDelChat } from "./opciones";
import { claveDeSesion, leerSesion, storageSeguro } from "./sesion-guardada";
import { variablesDelTema } from "./tema";
import css from "./widget.css";
import Widget from "./componentes/Widget";

export interface ChatMontado {
  desmontar(): void;
}

/** El núcleo (§1.1 del diseño). Crea un host con shadow root, mete el CSS y, sólo si el motor
 * dice que el chat de este proyecto está activo para este origen, renderiza el widget. Sin `ok`
 * no se dibuja nada (§2.4) — pero el host queda, vacío, para que `desmontar` tenga qué sacar. */
export function montarChat(contenedor: HTMLElement, opcionesCrudas: OpcionesDelChat): ChatMontado {
  const opciones = normalizarOpciones(opcionesCrudas); // lanza antes de tocar el DOM

  const host = document.createElement("div");
  host.setAttribute("data-supcoflow-chat", "");
  // Las variables del tema se escriben DESPUÉS de `estado` (abajo), cuando ya se sabe si hay marca:
  // como nada se dibuja hasta entonces (§2.4 del chat v2), no hay parpadeo. Acá va lo del código,
  // para que un host vacío no quede sin `--scf-*` si algo falla antes.
  host.setAttribute("style", variablesDelTema(opciones.tema));
  const shadow = host.attachShadow({ mode: "open" });
  const estilo = document.createElement("style");
  estilo.textContent = css;
  shadow.appendChild(estilo);
  const raiz = document.createElement("div");
  shadow.appendChild(raiz);
  contenedor.appendChild(host);

  let vivo = true;
  let controlador: ControladorDelChat | null = null;

  void (async () => {
    // El mismo sondeo que usa el núcleo público (`core/disponibilidad.ts`).
    const { status, cuerpo, huboError } = await consultarDisponibilidad(opciones);
    if (!vivo) return;
    const diag = diagnosticoDesdeRespuesta({ status, cuerpo, huboError });
    avisar(diag);
    if (!diag.visible) return;

    // §3.3 del diseño de la marca: defaults → marca del motor → código del cliente. `opcionesCrudas`
    // y no `opciones` a propósito: las resueltas ya tienen los defaults puestos y taparían la marca.
    const apariencia = resolverApariencia(opcionesCrudas, cuerpo?.marca);
    host.setAttribute("style", variablesDelTema(apariencia.tema));
    const opcionesConMarca = { ...opciones, titulo: apariencia.titulo, saludo: apariencia.saludo, tema: apariencia.tema };

    const clave = claveDeSesion(opciones.tenantId, opciones.projectId);
    const storage = storageSeguro();
    const guardado = storage === null ? null : leerSesion(storage, clave);
    const sdk = cabeceraDelSdk("widget");
    controlador = new ControladorDelChat({
      // T7: lo que ESTE widget dibuja de verdad. Lo mismo que decide el panel (ver `Widget.tsx`): en preview ninguna herramienta de evidencia, y fuera de preview lo que el acuerdo deja ofrecer; la captura
      // además necesita un navegador que pueda capturar. «Nueva conversación» siempre (la tarjeta del reporte la trae).
      cliente: crearCliente(opcionesConMarca, undefined, {
        sdk,
        capacidades: () => {
          const permisos = permisosDesdeRespuesta(cuerpo);
          const evidencia = opciones.previewToken === null;
          return {
            pickElement: evidencia && permisos.elementos,
            screenshot: evidencia && permisos.capturas && controlador?.puedeCapturar === true,
            attachImage: evidencia && permisos.capturas,
            newConversation: true,
          };
        },
      }),
      opciones: opcionesConMarca,
      // T0.5: lo que el acuerdo de datos deja ofrecer, sabido ANTES de dibujar. Un backend viejo no manda `permite` y queda todo, como en la 2.2.1.
      permisos: permisosDesdeRespuesta(cuerpo),
      cursorInicial: guardado,
      almacen: storage === null ? null : { storage, clave },
      // Un error a mitad de charla también llega al desarrollador (§2.5): visible sigue true.
      alError: (e: ErrorVisible) => avisar({ visible: true, status: 0, motivo: e.codigo }),
      sdk,
    });
    // Recarga de pestaña con cursor: se reconstruye la charla desde el stream durable (§2.5). Antes de dibujar, así el primer cuadro ya sale `ocupado`.
    void controlador.reanudar();
    render(
      <Widget
        controlador={controlador}
        opciones={opcionesConMarca}
        logoUrl={apariencia.logoUrl}
        saludo={apariencia.saludo}
        enPreview={opciones.previewToken !== null}
        abiertoAlInicio={guardado !== null}
        hostDelWidget={host}
      />,
      raiz,
    );
  })();

  function avisar(d: Diagnostico): void {
    try { opciones.onDiagnostico?.(d); } catch { /* el callback es del cliente */ }
    // En local el desarrollador está mirando la consola: se lo dice ahí también (§2.5).
    const h = globalThis.location?.hostname;
    if (h === "localhost" || h === "127.0.0.1") console.warn("[supcoflow/chat]", d);
  }

  return {
    desmontar() {
      vivo = false;
      controlador?.destruir();
      render(null, raiz);
      host.remove();
    },
  };
}
