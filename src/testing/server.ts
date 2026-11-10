// `@supcoflow/chat/testing/server`: el servidor local del banco de pruebas. Sólo Node (usa `node:http`): por eso no está en `@supcoflow/chat/testing`, que se puede
// empaquetar para un navegador. Contrato en `docs/testing.md`.

export { startFakeServer } from "./servidor-local";
export type { FakeServer, FakeServerOptions } from "./servidor-local";
