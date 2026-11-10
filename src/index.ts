export { ChatDeIntake, type ContextoDelReporte } from "./react";
export { montarChat, type ChatMontado } from "./montar";
export type { OpcionesDelChat, TemaDelChat, Diagnostico, UsuarioDelChat } from "./opciones";
export { esBorde, type CursorDeSesion, type EventoDelWidget, type EventoDelPreview, type OpcionDePregunta } from "./protocolo";
// 2.2.0: la consola de Supcoflow borra esta clave de sessionStorage para «reiniciar» el preview.
// Es interna como `previewToken`: en un sitio no hace nada útil.
export { claveDeSesion } from "./sesion-guardada";
