import { useState } from "preact/hooks";
import { isLongPaste, pasteSize } from "../core/texto-pegado";
import { TEXTOS } from "../textos";

// Lo que la persona escribió. Un texto largo (`isLongPaste`) se dibuja COLAPSADO: la marca «[pasted text]» y cuánto es, que se expande al tocarla; el texto está completo en el estado y se mandó completo.
// Se decide por el texto del mensaje y no por cómo se escribió: tras recargar, lo pegado no se distingue de lo tipeado.
export function TextoDelUsuario({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  if (!isLongPaste(texto)) return <p>{texto}</p>;
  const { characters, lines } = pasteSize(texto);
  return (
    <div class="scf-pegado">
      <button type="button" class="scf-pegado-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        <span class="scf-pegado-marca">{TEXTOS.textoPegado}</span>
        <span class="scf-pegado-medida">{lines} {lines === 1 ? TEXTOS.linea : TEXTOS.lineas} · {characters.toLocaleString("en-US")} {TEXTOS.caracteres}</span>
      </button>
      {abierto && <pre class="scf-pegado-texto">{texto}</pre>}
    </div>
  );
}
