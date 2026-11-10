import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// La documentación de quien instala el paquete no puede contradecir lo que el código hace (revisión de la 2.4.0, H1/H2). Estos tests no
// leen prosa en general: buscan las afirmaciones viejas que ya se corrigieron una vez, para que no vuelvan, y comprueban que cada documento
// que el README enlaza con `./` viaja en el paquete (`files`) o es uno de los que el repo público pone en su raíz.
const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const leer = (ruta: string): string => readFileSync(`${RAIZ}${ruta}`, "utf8");
const readme = leer("README.md");
const nucleo = leer("docs/core.md");
const paquete = JSON.parse(leer("package.json")) as { files: string[] };

describe("README y docs/core.md dicen lo que hace la 2.4.0", () => {
  it("el acuerdo de datos SÍ quita las acciones de evidencia (ya no «no impide ofrecerlas»)", () => {
    expect(readme).not.toMatch(/does not stop the chat from offering/i);
    expect(readme).not.toMatch(/still sees what the user sends/i);
    expect(readme).toMatch(/hides «Pick an element», «Take a screenshot», «Attach an image»/);
    expect(readme).toMatch(/not_allowed/);
  });

  it("el contexto viaja en CADA mensaje y el usuario declarado y la versión de la app no los lee el asistente", () => {
    expect(readme).not.toMatch(/sent with the first message/i);
    expect(readme).not.toMatch(/go to the assistant with the first message/i);
    expect(readme).toMatch(/travel with every message/);
    expect(readme).toMatch(/the assistant does \*\*not\*\* read them in the chat/);
    expect(nucleo).not.toMatch(/your app's version; goes with the first message/);
    expect(nucleo).not.toMatch(/page URL and browser that go with the first message/);
  });

  it("el asistente lee sólo la página: el navegador va al reporte", () => {
    expect(nucleo).not.toMatch(/the assistant reads them in a note of each turn/);
    expect(nucleo).toMatch(/the assistant reads \*\*only the page\*\*/);
    expect(readme).toMatch(/The assistant reads only the page/);
  });

  it("la tarjeta del reporte dice lo que el widget dice, sin la promesa vieja", () => {
    expect(readme).not.toMatch(/The team will review it/);
    expect(readme).toMatch(/«Report sent\.»/);
    expect(readme).toMatch(/Nothing written here from now on is added to it/);
  });
});

describe("los documentos que el README enlaza viajan en el paquete", () => {
  it("SECURITY.md y CONTRIBUTING.md están en `files`", () => {
    for (const doc of ["SECURITY.md", "CONTRIBUTING.md"]) {
      if (readme.includes(`./${doc}`)) expect(paquete.files, `${doc} está enlazado pero no va en el tarball`).toContain(doc);
    }
  });
});
