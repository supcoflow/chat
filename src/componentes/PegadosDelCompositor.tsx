import { useState } from "preact/hooks";
import { resumenDelPegado, type Pegado } from "../pegado";
import { TEXTOS } from "../textos";

// Lo pegado y todavía no enviado, dentro de la caja de escritura: la marca, cuánto es y su primera línea, y se abre para leerlo completo. Sin esto la persona manda a ciegas lo que pegó
// (un portapapeles equivocado, una contraseña).
function Uno({ pegado }: { pegado: Pegado }) {
  const [abierto, setAbierto] = useState(false);
  const { characters, lines, primeraLinea } = resumenDelPegado(pegado.texto);
  return (
    <li class="scf-pegado">
      <button type="button" class="scf-pegado-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        <span class="scf-pegado-marca">{pegado.marca}</span>
        <span class="scf-pegado-medida">{lines} {lines === 1 ? TEXTOS.linea : TEXTOS.lineas} · {characters.toLocaleString("en-US")} {TEXTOS.caracteres}</span>
        {primeraLinea !== "" && <span class="scf-pegado-primera">{primeraLinea}</span>}
      </button>
      {abierto && <pre class="scf-pegado-texto">{pegado.texto}</pre>}
    </li>
  );
}

export function PegadosDelCompositor({ pegados }: { pegados: readonly Pegado[] }) {
  if (pegados.length === 0) return null;
  return <ul class="scf-pegados">{pegados.map((p) => <Uno key={p.marca} pegado={p} />)}</ul>;
}
