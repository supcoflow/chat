import type { ComponentChildren } from "preact";
import { TEXTOS } from "../textos";
import { Avatar } from "./Inicio";

// La cabecera dejó de ser un bloque del acento (2.2.0, hallazgo 5 del spec): es clara, con el
// avatar, el título y la disclosure corta debajo. En la pantalla de inicio (`sinTitulo`) no lleva
// título ni avatar —el saludo ya lo dice— y sí el rótulo de preview y minimizar. El pie con la
// disclosure y la atribución va en Widget.tsx, debajo del compositor.
export function Panel(props: {
  titulo: string;
  logoUrl: string | null;
  enPreview: boolean;
  modo: "burbuja" | "inline";
  posicion: "derecha" | "izquierda";
  sinTitulo: boolean;
  onMinimizar: () => void;
  children: ComponentChildren;
}) {
  const clases = ["scf-panel"];
  if (props.modo === "inline") clases.push("scf-panel--inline");
  else if (props.posicion === "izquierda") clases.push("scf-panel--izquierda");
  return (
    <section class={clases.join(" ")} role="dialog" aria-label={props.titulo}>
      <header class={`scf-cabecera${props.sinTitulo ? " scf-cabecera--inicio" : ""}`}>
        {!props.sinTitulo && <Avatar titulo={props.titulo} logoUrl={props.logoUrl} />}
        <div class="scf-cabecera-titulo">
          {!props.sinTitulo && <b>{props.titulo}</b>}
          {!props.sinTitulo && <small>{TEXTOS.asistenteAutomatico}</small>}
        </div>
        {/* §5.3 de la marca: fijo mientras haya previewToken, para que ninguna captura del modal pase por el chat real. */}
        {props.enPreview && <span class="scf-rotulo">{TEXTOS.preview}</span>}
        {props.modo === "burbuja" && (
          <button type="button" class="scf-icono" aria-label={TEXTOS.minimizar} onClick={props.onMinimizar}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
          </button>
        )}
      </header>
      {props.children}
    </section>
  );
}
