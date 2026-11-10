// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { acotarElemento, contieneSecreto, extraerElemento, MAX_ELEMENTO_CHARS, sanearUrl } from "./extraer-elemento";

// Un DOM parecido al de un sitio real: ids con hash, clases de CSS-in-JS, un input con un valor
// que NO puede viajar, un atributo con un token, y un script adentro del elemento.
function pagina(): HTMLButtonElement {
  document.body.innerHTML = `
    <main role="main">
      <form id="cuenta" class="css-1x2y3z formulario" action="https://app.cliente.com/guardar?token=abc#f">
        <label for="nombre">Nombre</label>
        <input id="nombre" name="nombre" value="Juan Pérez" data-session_id="s3cr3t">
        <input type="password" value="hunter2">
        <textarea>texto privado</textarea>
        <button class="guardar css-9a8b7c" type="submit" title="Guardar los cambios" data-csrf="tok">
          Guardar <span>ahora</span><script>window.x = 1;</script>
        </button>
        <p>Los cambios se guardan al instante</p>
      </form>
    </main>`;
  return document.querySelector("button")!;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("extraerElemento", () => {
  it("arma selector, ruta legible, texto, ancestros y texto cercano con los presupuestos de Orca", () => {
    const e = extraerElemento(pagina(), window);
    expect(e.target.tagName).toBe("button");
    expect(e.target.selector).toBe("button.guardar");                         // ya único en el documento; la clase hashy css-* se salta
    expect(e.target.elementPath).toBe("#cuenta > .guardar");
    expect(e.target.textSnippet).toBe("Guardar ahora");                        // sin el script, espacios normalizados
    expect(e.ancestorPath).toEqual(["form", "main[role=main]", "body"]);
    expect(e.nearbyText).toContain("Los cambios se guardan al instante");
    expect(e.target.accessibility.role).toBe("button");
    expect(e.target.accessibility.accessibleName).toBe("Guardar ahora");
    expect(e.page.sanitizedUrl).toMatch(/^https?:\/\//);
    expect(typeof e.page.capturedAt).toBe("string");
  });

  it("NUNCA lleva el value de un input, textarea o password — ni en el HTML del elemento ni en los atributos", () => {
    pagina();
    const e = extraerElemento(document.querySelector("form")!, window);
    const todo = JSON.stringify(e);
    expect(todo).not.toContain("Juan Pérez");
    expect(todo).not.toContain("hunter2");
    expect(todo).not.toContain("texto privado");
    expect(e.target.htmlSnippet).not.toContain("<script");
  });

  it("sólo los atributos de la allowlist, con secretos redactados y URLs sin query ni hash", () => {
    pagina();
    const e = extraerElemento(document.querySelector("form")!, window);
    expect(e.target.attributes.action).toBe("https://app.cliente.com/guardar");
    expect(e.target.attributes.id).toBe("cuenta");
    expect(e.target.attributes["data-session_id"]).toBeUndefined();
    const boton = extraerElemento(pagina(), window);
    expect(boton.target.attributes.title).toBe("Guardar los cambios");
    expect(boton.target.attributes["data-csrf"]).toBeUndefined();
    expect(boton.target.attributes.class).toBe("guardar css-9a8b7c");
  });

  it("un id o una clase con pinta de secreto se redacta en vez de anclar el selector", () => {
    document.body.innerHTML = `<div id="csrf_token_field"><a class="access_token_link" href="https://a.com/x?k=1">x</a></div>`;
    const e = extraerElemento(document.querySelector("a")!, window);
    expect(e.target.selector).not.toContain("csrf");
    expect(e.target.selector).not.toContain("access_token");
    expect(e.target.attributes.href).toBe("https://a.com/x");
    expect(e.target.cssClasses).toBe("[redacted]");
  });

  it("respeta las cotas del motor: title ≤ 500, textSnippet ≤ 212, html ≤ 4108, 10 textos cercanos, 10 ancestros, 16 estilos", () => {
    document.title = "t".repeat(900);
    document.body.innerHTML = `<div>${"<p>hermano</p>".repeat(30)}<span id="x">${"palabra ".repeat(200)}<i>${"<b>y</b>".repeat(900)}</i></span></div>`;
    const e = extraerElemento(document.getElementById("x")!, window);
    expect(e.page.title.length).toBe(500);
    expect(e.target.textSnippet.length).toBeLessThanOrEqual(212);
    expect(e.target.htmlSnippet.length).toBeLessThanOrEqual(4108);
    expect(e.target.htmlSnippet.endsWith(" (truncated)")).toBe(true);
    expect(e.nearbyText.length).toBeLessThanOrEqual(10);
    expect(e.ancestorPath.length).toBeLessThanOrEqual(10);
    expect(Object.keys(e.target.computedStyles)).toHaveLength(16);
  });
});

describe("acotarElemento", () => {
  it("si el elemento serializado pasa 16 KB, tira primero lo prescindible y después recorta el HTML — nunca devuelve algo que el motor rechace", () => {
    const e = extraerElemento(pagina(), window);
    const gordo = { ...e, nearbyText: Array.from({ length: 10 }, () => "x".repeat(300)), target: { ...e.target, htmlSnippet: "h".repeat(4100), nearbyElements: Array.from({ length: 6 }, () => "n".repeat(200)), attributes: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`aria-a${i}`, "v".repeat(600)])) } };
    expect(JSON.stringify(gordo).length).toBeGreaterThan(MAX_ELEMENTO_CHARS);
    const acotado = acotarElemento(gordo);
    expect(JSON.stringify(acotado).length).toBeLessThanOrEqual(MAX_ELEMENTO_CHARS);
    expect(acotado.target.selector).toBe(e.target.selector); // lo que identifica al elemento no se toca
  });
  it("un elemento que ya entra vuelve idéntico", () => {
    const e = extraerElemento(pagina(), window);
    expect(acotarElemento(e)).toEqual(e);
  });
});

describe("helpers", () => {
  it("sanearUrl quita query y hash, y devuelve vacío para esquemas que no sean http(s)", () => {
    expect(sanearUrl("https://a.com/p?x=1#y")).toBe("https://a.com/p");
    expect(sanearUrl("javascript:alert(1)")).toBe("");
    expect(sanearUrl("no es una url")).toBe("");
  });
  it("contieneSecreto detecta los patrones de Orca sin importar mayúsculas", () => {
    expect(contieneSecreto("X-Amz-Signature")).toBe(true);
    expect(contieneSecreto("mi_password")).toBe(true);
    expect(contieneSecreto("guardar")).toBe(false);
  });
});
