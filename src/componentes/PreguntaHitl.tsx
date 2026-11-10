import { useState } from "preact/hooks";
import type { Respuesta } from "../cliente";
import type { PreguntaPendiente } from "../estado";
import { TEXTOS } from "../textos";

// Sólo los botones: el prompt de la pregunta ya es un mensaje del asistente (estado.ts), para
// que sobreviva a la resolución y a la recarga.
export function PreguntaHitl(props: { pregunta: PreguntaPendiente; ocupado: boolean; onResponder: (r: Respuesta) => void; /** Lo que acompaña al envío (sólo en la confirmación del reporte). */ nota?: string | null }) {
  const [texto, setTexto] = useState("");
  const { pregunta } = props;
  return (
    <div class="scf-pregunta" role="group">
      {props.nota != null && <p class="scf-pregunta-nota">{props.nota}</p>}
      {pregunta.opciones.length > 0 && (
        <div class="scf-pregunta-opciones">
          {pregunta.opciones.map((o) => (
            <button
              key={o.id}
              type="button"
              class={`scf-opcion${o.style === "default" ? "" : ` scf-opcion--${o.style}`}`}
              disabled={props.ocupado}
              onClick={() => props.onResponder({ requestId: pregunta.requestId, optionId: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {pregunta.libre && (
        <form
          class="scf-compositor scf-pregunta-libre"
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim() === "") return;
            props.onResponder({ requestId: pregunta.requestId, text: texto.trim() });
            setTexto("");
          }}
        >
          <input class="scf-textarea" value={texto} onInput={(e) => setTexto((e.target as HTMLInputElement).value)} placeholder={TEXTOS.respuestaLibre} aria-label={TEXTOS.respuestaLibre} />
          <button type="submit" class="scf-enviar" disabled={props.ocupado}>{TEXTOS.responder}</button>
        </form>
      )}
    </div>
  );
}
