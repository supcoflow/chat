import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { isLongPaste } from "../core/texto-pegado";
import type { Pegado } from "../pegado";
import { TEXTOS } from "../textos";
import { PegadosDelCompositor } from "./PegadosDelCompositor";

export interface Herramientas {
  /** 2.3.0 (T0.5): sin el permiso `elementos` del acuerdo, «Pick an element» no se dibuja. */
  puedeSenalar: boolean;
  /** 2.3.0 (T0.5): sin el permiso `capturas`, ni «Take a screenshot» ni «Attach an image» (ni el botón que los abre). */
  puedeAdjuntarImagenes: boolean;
  onSenalar: () => void;
  onCapturarPantalla: () => void;
  onAdjuntarImagen: (archivo: File) => void;
  /** §3.2: sin getDisplayMedia (Safari, iOS, http) el ítem de capturar NO se dibuja; adjuntar imagen siempre. */
  puedeCapturar: boolean;
  /** Falso con la cola llena (4): los botones se deshabilitan y el aviso lo dice la barra. */
  puedeAdjuntar: boolean;
}

export function Compositor(props: {
  valor: string;
  onCambio: (v: string) => void;
  onEnviar: () => void;
  deshabilitado: boolean;
  enfocarAlMontar: boolean;
  /** `null` en preview (§2 del diseño de la marca): ni botones ni input de archivo — la subida está apagada, no deshabilitada. */
  herramientas: Herramientas | null;
  /** La tira de adjuntos (§2.2.0): va ADENTRO de la caja, arriba del textarea. `null` en preview. */
  adjuntos: ComponentChildren;
  /** Un pegado largo (`isLongPaste`) no entra al textarea: se avisa con el texto y la selección, y devuelve dónde dejar el cursor. */
  onPegar: (pegado: { texto: string; inicio: number; fin: number }) => number | void;
  /** Lo que se puede seguir escribiendo: el tope del mensaje menos lo que ocupan los pegados una vez expandidos. */
  maxLargo: number;
  /** Los pegados largos vigentes (su marca sigue en el texto): se muestran con su tamaño y primera línea, y se pueden abrir. */
  pegados: readonly Pegado[];
  /** Algo que decirle a la persona sobre lo que acaba de pegar (no entró entero). */
  aviso: string | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const cursorPendiente = useRef<number | null>(null);
  useEffect(() => { if (props.enfocarAlMontar) ref.current?.focus(); }, [props.enfocarAlMontar]);
  // Tras un pegado largo el cursor queda después de la marca (poner el valor lo manda al final).
  useEffect(() => {
    if (cursorPendiente.current === null) return;
    ref.current?.setSelectionRange(cursorPendiente.current, cursorPendiente.current);
    cursorPendiente.current = null;
  }, [props.valor]);
  // Crece hasta 4 líneas (max-height en el CSS) y vuelve a una al vaciarse.
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.valor]);

  const h = props.herramientas;
  return (
    <form class="scf-compositor" onSubmit={(e) => { e.preventDefault(); props.onEnviar(); }}>
      <div class="scf-caja">
        {props.adjuntos}
        <PegadosDelCompositor pegados={props.pegados} />
        {props.aviso !== null && <p class="scf-aviso" role="status">{props.aviso}</p>}
        <textarea
          ref={ref}
          class="scf-textarea"
          rows={1}
          value={props.valor}
          placeholder={TEXTOS.placeholder}
          aria-label={TEXTOS.placeholder}
          // El tope del backend (`MAX_MENSAJE`, pegado.ts) menos lo que ocupan los pegados expandidos.
          maxLength={props.maxLargo}
          onPaste={(e) => {
            const texto = e.clipboardData?.getData("text/plain") ?? "";
            if (!isLongPaste(texto)) return; // lo corto, el camino normal del navegador
            e.preventDefault();
            const el = e.currentTarget as HTMLTextAreaElement;
            const cursor = props.onPegar({ texto, inicio: el.selectionStart ?? props.valor.length, fin: el.selectionEnd ?? props.valor.length });
            if (typeof cursor === "number") cursorPendiente.current = cursor;
          }}
          onInput={(e) => props.onCambio((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter hace salto (§2.1).
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); props.onEnviar(); }
          }}
        />
        <div class="scf-fila">
          {h !== null && (
            <>
              {h.puedeSenalar && <button type="button" class="scf-icono scf-herramienta" aria-label={TEXTOS.senalar} title={TEXTOS.senalar} disabled={!h.puedeAdjuntar} onClick={() => { setMenu(false); h.onSenalar(); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l7.5 16 2.3-6.2L20 11.5 4 4z"/></svg>
              </button>}
              {h.puedeAdjuntarImagenes && <>
                <button type="button" class="scf-icono scf-herramienta" aria-label={TEXTOS.adjuntar} title={TEXTOS.adjuntar} aria-haspopup="menu" aria-expanded={menu} disabled={!h.puedeAdjuntar} onClick={() => setMenu((m) => !m)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.5 3.5 0 0 1 5 5l-9 9a1.5 1.5 0 0 1-2.1-2.1l8.3-8.3"/></svg>
                </button>
                {menu && (
                  <div class="scf-menu" role="menu">
                    {h.puedeCapturar && <button type="button" role="menuitem" onClick={() => { setMenu(false); h.onCapturarPantalla(); }}>{TEXTOS.capturarPantalla}</button>}
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); archivo.current?.click(); }}>{TEXTOS.adjuntarImagen}</button>
                  </div>
                )}
                {/* El camino universal (§3.2), también en el celular. `accept` es una pista: esImagen decide. */}
                <input ref={archivo} class="scf-oculto" type="file" accept="image/*" aria-label={TEXTOS.adjuntarImagen}
                  onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ""; if (f !== undefined) h.onAdjuntarImagen(f); }} />
              </>}
            </>
          )}
          <button type="submit" class="scf-enviar" aria-label={TEXTOS.enviarAria} disabled={props.deshabilitado || props.valor.trim() === ""}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-7 7l7-7 7 7"/></svg>
          </button>
        </div>
      </div>
    </form>
  );
}
