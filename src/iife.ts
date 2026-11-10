// La entrada del <script> (§1.2 del diseño): un sitio sin React pega
//   <script src="https://chat.supcoflow.dev/widget.js" data-tenant="…" data-project="…" defer></script>
// y esto monta el widget en el body. `document.currentScript` sólo existe mientras el script se
// ejecuta, por eso se lee arriba y no dentro del listener.
import { montarChat, type ChatMontado } from "./montar";
import { opcionesDesdeDataset, type OpcionesDelChat } from "./opciones";

const script = document.currentScript as HTMLScriptElement | null;
let montado: ChatMontado | null = null;

function montar(opciones: OpcionesDelChat): ChatMontado {
  montado?.desmontar();
  montado = montarChat(document.body, opciones);
  return montado;
}

function desmontar(): void {
  montado?.desmontar();
  montado = null;
}

(globalThis as unknown as { SupcoflowChat: unknown }).SupcoflowChat = { montar, desmontar };

if (script !== null && script.dataset.tenant && script.dataset.project) {
  const opciones = opcionesDesdeDataset(script.dataset as Record<string, string | undefined>);
  const arrancar = (): void => {
    try {
      montar(opciones);
    } catch (e) {
      // El sitio del cliente no se rompe por nuestro widget: se avisa en consola y nada más.
      console.warn("[supcoflow/chat] no se pudo montar:", e);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar, { once: true });
  else arrancar();
}
