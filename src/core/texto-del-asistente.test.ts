import { describe, expect, it } from "vitest";
import { parseAssistantText } from "./texto-del-asistente";

describe("parseAssistantText", () => {
  it("un párrafo plano es un párrafo con un solo texto", () => {
    expect(parseAssistantText("Hola, ¿qué pasó?")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "Hola, ¿qué pasó?" }] }]);
  });
  it("separa párrafos por línea en blanco y une líneas consecutivas con un espacio", () => {
    expect(parseAssistantText("uno\ndos\n\ntres")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "uno dos" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "tres" }] },
    ]);
  });
  it("negrita, cursiva y código inline", () => {
    expect(parseAssistantText("el **botón** de *guardar* llama a `save()`")).toEqual([{
      kind: "paragraph",
      children: [
        { kind: "text", text: "el " },
        { kind: "bold", children: [{ kind: "text", text: "botón" }] },
        { kind: "text", text: " de " },
        { kind: "italic", children: [{ kind: "text", text: "guardar" }] },
        { kind: "text", text: " llama a " },
        { kind: "code", text: "save()" },
      ],
    }]);
  });
  it("un asterisco suelto es texto, no una cursiva abierta para siempre", () => {
    expect(parseAssistantText("2 * 3 = 6")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "2 * 3 = 6" }] }]);
  });
  it("listas con guion y numeradas, cada item con inlines", () => {
    expect(parseAssistantText("- uno\n- **dos**\n\n1. a\n2. b")).toEqual([
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "uno" }], [{ kind: "bold", children: [{ kind: "text", text: "dos" }] }]] },
      { kind: "list", ordered: true, items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
    ]);
  });
  it("bloque de código con fence, sin interpretar nada adentro", () => {
    expect(parseAssistantText("antes\n```js\nconst **x** = 1;\n```\ndespués")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "antes" }] },
      { kind: "code", text: "const **x** = 1;" },
      { kind: "paragraph", children: [{ kind: "text", text: "después" }] },
    ]);
  });
  it("links sólo con http(s); cualquier otro esquema queda como texto", () => {
    expect(parseAssistantText("ver [ayuda](https://a.com/x) o [mal](javascript:alert(1))", "https://a.com")).toEqual([{
      kind: "paragraph",
      children: [
        { kind: "text", text: "ver " },
        { kind: "link", href: "https://a.com/x", children: [{ kind: "text", text: "ayuda" }] },
        { kind: "text", text: " o [mal](javascript:alert(1))" },
      ],
    }]);
  });
  it("el HTML es text: nada se interpreta como etiqueta", () => {
    expect(parseAssistantText("<img src=x onerror=alert(1)>")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }] }]);
  });
  it("un fence sin cerrar (stream a mitad) se trata como código hasta el final", () => {
    expect(parseAssistantText("```\nconst a")).toEqual([{ kind: "code", text: "const a" }]);
  });
  it("texto vacío es cero bloques", () => {
    expect(parseAssistantText("")).toEqual([]);
    expect(parseAssistantText("  \n ")).toEqual([]);
  });
});

// T0.8 (A4): un enlace sólo se dibuja si es del origen del sitio donde está el widget. Un enlace a otro
// sitio escrito por el modelo (manipulado) es una salida de phishing: queda como texto.
describe("T0.8 enlaces sólo al origen del sitio", () => {
  const hijos = (md: string, origen: string | null) => (parseAssistantText(md, origen)[0] as { children: { kind: string }[] }).children.map((h) => h.kind);
  it("mismo origen → enlace, también en localhost con puerto", () => {
    expect(hijos("[billing](https://app.cliente.com/settings/billing)", "https://app.cliente.com")).toEqual(["link"]);
    expect(hijos("[billing](http://localhost:3000/settings)", "http://localhost:3000")).toEqual(["link"]);
  });
  it("otro origen (otro dominio, otro puerto, otro esquema, subdominio) → texto, tal cual escrito", () => {
    for (const url of ["https://evil.com/x", "http://localhost:3001/x", "http://app.cliente.com/x", "https://app.cliente.com.evil.com/x", "https://sub.app.cliente.com/x"]) {
      const r = parseAssistantText(`[ver](${url})`, "https://app.cliente.com");
      expect(r).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: `[ver](${url})` }] }]);
    }
  });
  it("`//otro` y rutas relativas quedan como texto", () => {
    expect(hijos("[x](//evil.com/a)", "https://app.cliente.com")).toEqual(["text"]);
    expect(hijos("[x](/settings)", "https://app.cliente.com")).toEqual(["text"]);
  });
  it("sin origen conocido no hay enlaces: ante la duda, texto", () => {
    expect(hijos("[x](https://a.com/x)", null)).toEqual(["text"]);
  });
  it("una URL con credenciales (`https://app.cliente.com@evil.com`) no pasa por el origen del sitio", () => {
    expect(hijos("[x](https://app.cliente.com@evil.com/a)", "https://app.cliente.com")).toEqual(["text"]);
  });
  it("el enlace dentro de negrita o de una lista también obedece", () => {
    const r = parseAssistantText("- **[x](https://evil.com/a)**", "https://app.cliente.com");
    expect(JSON.stringify(r)).not.toContain('"link"');
  });
});

// T2 (plan «ui-agnóstico»): el núcleo exporta este parser para que una interfaz propia dibuje el mismo subconjunto seguro que el widget.
describe("parseAssistantText, exportado por el núcleo", () => {
  it("se importa de `@supcoflow/chat/core`", async () => {
    const nucleo = await import("./index");
    expect(nucleo.parseAssistantText).toBe(parseAssistantText);
  });
  it("las imágenes son texto, también las del propio sitio: nunca hay un nodo de imagen ni un enlace detrás de un `!`", () => {
    for (const md of ["![logo](https://app.cliente.com/i.png)", "![x](https://evil.com/i.png)", "[![x](https://evil.com/i.png)](https://app.cliente.com/ok)"]) {
      const r = JSON.stringify(parseAssistantText(md, "https://app.cliente.com"));
      expect(r).not.toContain('"image"');
      expect(r).not.toMatch(/"href":"[^"]*i\.png"/);
    }
    expect(parseAssistantText("![logo](https://app.cliente.com/i.png)", "https://app.cliente.com")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "![logo](https://app.cliente.com/i.png)" }] },
    ]);
  });
  it("el HTML y los autoenlaces son texto", () => {
    for (const md of ["<a href=\"https://app.cliente.com\">x</a>", "<https://app.cliente.com/x>", "<script>alert(1)</script>"]) {
      expect(parseAssistantText(md, "https://app.cliente.com")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: md }] }]);
    }
  });
  it("lo que ya limpió el servidor se dibuja igual de seguro: sin enlaces nuevos", () => {
    const r = parseAssistantText("ver esto (https://evil.com/x) y [billing](https://app.cliente.com/b)", "https://app.cliente.com");
    expect(JSON.stringify(r).match(/"kind":"link"/g)).toHaveLength(1);
  });
});
