// `@supcoflow/chat/testing`: el banco de pruebas para quien arma su propia interfaz con el núcleo (`@supcoflow/chat/core`). Un backend FALSO que reproduce
// charlas grabadas —la confirmación del reporte, la pantalla vieja, la recarga, el tope, el límite, un adjunto que falla, un enlace a otro sitio— y anota qué
// le pidió la interfaz y en qué orden; como `fetch` para tests (aquí) y como servidor local para ver cada estado en la app (`@supcoflow/chat/testing/server`, sólo Node). No toca el diseño: mira pedidos, texto y
// roles. No importa preact, react, CSS ni nada de Node: se empaqueta también para un navegador (Storybook, una página de desarrollo). Contrato en `docs/testing.md`.

export { createFakeBackend } from "./backend-falso";
export { storageWithSavedConversation } from "./almacen";
export { completeElementPick } from "./senalar";
export { getScenario, scenarioNames, scenarios } from "./catalogo";
export type { FakeBackend, FakeBackendOptions, FakeRequest, RecordedRequest, RequestKind, SentAnswer } from "./backend-falso";
export type { HttpResponse, Scenario, ScenarioAction, ScriptLine, ScriptedResponse } from "./escenario";
