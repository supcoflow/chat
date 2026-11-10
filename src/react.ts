// El wrapper de React (§1.2 del diseño): veinte líneas que montan el núcleo en un div. Sin JSX
// a propósito: este archivo se compila con jsxImportSource: preact y React es un peer OPCIONAL —
// este `import` de "react" es lo único del paquete que lo toca, y esbuild lo deja externo.
import { createElement, useEffect, useRef, type ReactElement } from "react";
import { montarChat } from "./montar";
import type { OpcionesDelChat } from "./opciones";

/** Alias de compatibilidad con la 1.x: `contexto={{ versionApp }}`. `url` ya no se declara —
 * viaja sola por `contextoAutomatico` (§3.4). */
export type ContextoDelReporte = { versionApp?: string };

export function ChatDeIntake(props: OpcionesDelChat & { className?: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { className, ...opciones } = props;
  // Se lee una sola vez al montar; cambiar de proyecto exige remontar con una `key` distinta.
  const opcionesIniciales = useRef(opciones);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const montado = montarChat(el, opcionesIniciales.current);
    return () => montado.desmontar();
  }, []);
  return createElement("div", { ref, className, "data-supcoflow-chat-react": "" });
}
