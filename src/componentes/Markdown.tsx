import type { TextBlock, TextInline } from "../core/texto-del-asistente";
import { parseAssistantText } from "../core/texto-del-asistente";

// TextBlock[] → nodos de Preact. NUNCA dangerouslySetInnerHTML: es la promesa del §2.2.
function Inlines({ children }: { children: TextInline[] }) {
  return (
    <>
      {children.map((h, i) => {
        switch (h.kind) {
          case "text": return <span key={i}>{h.text}</span>;
          case "bold": return <strong key={i}><Inlines children={h.children} /></strong>;
          case "italic": return <em key={i}><Inlines children={h.children} /></em>;
          case "code": return <code key={i}>{h.text}</code>;
          case "link": return <a key={i} href={h.href} target="_blank" rel="noopener noreferrer"><Inlines children={h.children} /></a>;
        }
      })}
    </>
  );
}

function BloqueVista({ b }: { b: TextBlock }) {
  switch (b.kind) {
    case "paragraph": return <p><Inlines children={b.children} /></p>;
    case "code": return <pre class="scf-codigo">{b.text}</pre>;
    case "list": {
      const items = b.items.map((it, i) => <li key={i}><Inlines children={it} /></li>);
      return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
  }
}

// T0.8: sólo se dibujan como enlace las URLs del origen del sitio donde está el widget.
const origenDelSitio = (): string | null => (typeof location === "undefined" ? null : location.origin);

export function Markdown({ texto }: { texto: string }) {
  return <>{parseAssistantText(texto, origenDelSitio()).map((b, i) => <BloqueVista key={i} b={b} />)}</>;
}
