import { TEXTOS } from "../textos";

export function Burbuja(props: { posicion: "derecha" | "izquierda"; abierto: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class={`scf-burbuja${props.posicion === "izquierda" ? " scf-burbuja--izquierda" : ""}`}
      aria-label={props.abierto ? TEXTOS.cerrar : TEXTOS.abrir}
      aria-expanded={props.abierto}
      onClick={props.onClick}
    >
      {props.abierto ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>
      )}
    </button>
  );
}
