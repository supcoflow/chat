import { ARRANQUES, inicialesDe, TEXTOS } from "../textos";

// La pantalla de inicio (§5 del diseño de la marca, construida en la 2.2.0): saludo con nombre,
// el saludo del proyecto, dos arranques que son las dos tools del agente, y el separador hacia
// el compositor, que sigue debajo. Un arranque manda su texto como primer mensaje del usuario
// (§5.2): cero cambio de protocolo y una transcripción honesta.
export function Inicio(props: { titulo: string; logoUrl: string | null; nombre: string | undefined; saludo: string; onArranque: (mensaje: string) => void }) {
  return (
    <div class="scf-inicio">
      <div class="scf-inicio-saludo">
        <Avatar titulo={props.titulo} logoUrl={props.logoUrl} grande />
        <h3>{props.nombre === undefined ? `${TEXTOS.hola} 👋` : `${TEXTOS.hola} ${props.nombre} 👋`}</h3>
        <p>{props.saludo}</p>
      </div>
      <div class="scf-arranques">
        {ARRANQUES.map((a) => (
          <button key={a.mensaje} type="button" class="scf-arranque" onClick={() => props.onArranque(a.mensaje)}>
            <span class="scf-arranque-ic" aria-hidden="true">
              {a === ARRANQUES[0] ? (
                <svg viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7m0 3h.01"/></svg>
              )}
            </span>
            <span class="scf-arranque-texto"><b>{a.titulo}</b><small>{a.detalle}</small></span>
            <span class="scf-arranque-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
          </button>
        ))}
      </div>
      <div class="scf-o">{TEXTOS.oEscribi}</div>
    </div>
  );
}

/** El logo de la marca o las iniciales del título. Decorativo: `alt` vacío, el título ya nombra. */
export function Avatar(props: { titulo: string; logoUrl: string | null; grande?: boolean }) {
  return (
    <span class={`scf-avatar${props.grande ? " scf-avatar--grande" : ""}`}>
      {props.logoUrl !== null ? <img src={props.logoUrl} alt="" /> : inicialesDe(props.titulo)}
    </span>
  );
}
