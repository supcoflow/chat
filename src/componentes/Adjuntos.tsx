import type { Adjunto } from "../evidencia/adjuntos";
import { TEXTOS } from "../textos";

// La barra de adjuntos pendientes (§2.1): una miniatura por captura, un chip por elemento, el
// estado de la subida y quitar/reintentar. Sólo dibuja `Adjunto[]`; las decisiones están en
// evidencia/adjuntos.ts. La miniatura es un data URL que produjo NUESTRO canvas: no es contenido
// del sitio ni del modelo, por eso puede ir en `src`.
//
// «Quitar» sólo se ofrece donde tiene efecto REAL: un adjunto `pendiente` o `fallo` (que nunca llegó al motor). Uno ya `listo` existe en el motor y se
// enlaza al reporte aunque se saque de la lista —borrarlo no tiene operación en el motor (spec §3.5, §11)—, así que no lleva «Remove»: dice qué pasa con él
// (`adjuntadoYaEnviado`) y la pregunta de confirmación lista lo que acompaña al envío. Un retiro real pide una operación nueva del motor.

function claseDe(a: Adjunto): string {
  switch (a.estado) {
    case "pendiente": return "scf-tile-estado--pendiente";
    case "subiendo": return "scf-tile-estado--subiendo";
    case "listo": return "scf-tile-estado--listo";
    case "fallo": return "scf-tile-estado--fallo";
  }
}
function textoDe(a: Adjunto, reportado: boolean): string {
  switch (a.estado) {
    case "pendiente": return TEXTOS.pendiente;
    case "subiendo": return TEXTOS.subiendo;
    // Con el reporte enviado: lo que ya estaba subido FUE con él; lo que terminó de subir después no va con ninguno (se dice sólo «Attached»).
    case "listo": return !reportado ? TEXTOS.adjuntadoYaEnviado : a.enReporte ? TEXTOS.adjuntadoYaFueAlReporte : TEXTOS.adjuntado;
    case "fallo": return TEXTOS.falloDeSubida;
  }
}

export function Adjuntos(props: {
  adjuntos: Adjunto[];
  ocupado: boolean;
  aviso: string | null;
  /** La sesión ya tiene su reporte: lo ya subido FUE con él (no «va si lo mandás») y no se agrega más. */
  reportado: boolean;
  /** Se ofrece sólo si el ÚLTIMO adjunto es un elemento y el navegador sabe capturar (§3.2). */
  onCapturarElemento: (() => void) | null;
  onQuitar: (clave: number) => void;
  onReintentar: (clave: number) => void;
}) {
  if (props.adjuntos.length === 0 && props.aviso === null) return null;
  return (
    <>
      {props.adjuntos.length > 0 && (
        <div class="scf-adjuntos" aria-label={TEXTOS.adjuntar}>
          {props.adjuntos.map((a) =>
            a.tipo === "captura" ? (
              <span key={a.clave} class={`scf-adjunto scf-tile${a.estado === "fallo" ? " scf-adjunto--fallo" : ""}`} title={textoDe(a, props.reportado)}>
                <img class="scf-miniatura" src={a.imagen.miniatura} alt="" />
                <span class={`scf-tile-estado ${claseDe(a)}`} role="status" aria-label={textoDe(a, props.reportado)}>
                  {a.estado === "listo" && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>}
                  {a.estado === "fallo" && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6m0 4h.01"/></svg>}
                </span>
                {a.estado === "fallo" && a.reintentable && !props.reportado && <button type="button" class="scf-tile-reintentar" onClick={() => props.onReintentar(a.clave)}>{TEXTOS.reintentarSubida}</button>}
                {a.estado !== "listo" && <button type="button" class="scf-tile-quitar" aria-label={TEXTOS.quitar} disabled={a.estado === "subiendo"} onClick={() => props.onQuitar(a.clave)}>×</button>}
              </span>
            ) : (
              <span key={a.clave} class={`scf-adjunto scf-chip${a.estado === "fallo" ? " scf-adjunto--fallo" : ""}`} title={textoDe(a, props.reportado)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>
                <span>{a.etiqueta}</span>
                {a.estado === "fallo" && a.reintentable && !props.reportado && <button type="button" onClick={() => props.onReintentar(a.clave)}>{TEXTOS.reintentarSubida}</button>}
                {a.estado !== "listo" && <button type="button" aria-label={TEXTOS.quitar} disabled={a.estado === "subiendo"} onClick={() => props.onQuitar(a.clave)}>×</button>}
              </span>
            ),
          )}
          {props.onCapturarElemento !== null && (
            <button type="button" class="scf-chip scf-chip--accion" disabled={props.ocupado} onClick={props.onCapturarElemento}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2m8 0h2a2 2 0 0 1 2 2v2m0 8v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/></svg>
              <span>{TEXTOS.capturarElemento}</span>
            </button>
          )}
        </div>
      )}
      {props.aviso !== null ? (
        <div class="scf-aviso" role="status">{props.aviso}</div>
      ) : (
        // Lo que el control ya no puede hacer se dice a la vista (no sólo en el `title`, que el celular no muestra).
        (props.reportado ? props.adjuntos.some((a) => a.enReporte) : props.adjuntos.some((a) => a.estado === "listo")) && <div class="scf-aviso" role="status">{props.reportado ? TEXTOS.adjuntadoYaFueAlReporte : TEXTOS.adjuntadoYaEnviado}</div>
      )}
    </>
  );
}
