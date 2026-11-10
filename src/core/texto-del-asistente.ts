// El subconjunto de markdown que dibuja el widget y que toda interfaz sobre el núcleo puede dibujar (§2.2 del diseño), parseado a una estructura y
// NUNCA a HTML. Propio y no una librería: un subconjunto cerrado se audita leyéndolo; un
// sanitizador de HTML es una superficie que hay que vigilar en cada versión. Lo que NO se
// interpreta, a propósito: encabezados (#), citas (>), tablas, imágenes, HTML, links con esquemas
// que no sean http(s), y (desde la 2.3.0) links a un origen que no sea el del sitio donde está el widget:
// un enlace a otro sitio escrito por el modelo es una salida de phishing si alguien lo manipula. Todo
// eso es texto plano.

/** Lo que va DENTRO de una línea. `link` sólo existe para una URL del origen que se le dio a `parseAssistantText`. */
export type TextInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: TextInline[] }
  | { kind: "italic"; children: TextInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: TextInline[] };

export type TextBlock =
  | { kind: "paragraph"; children: TextInline[] }
  | { kind: "list"; ordered: boolean; items: TextInline[][] }
  | { kind: "code"; text: string };

const ITEM_GUION = /^\s*[-*]\s+(.*)$/;
const ITEM_NUMERO = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

/** El texto del asistente como estructura, NUNCA como HTML (`@supcoflow/chat/core`). `origin` es el `location.origin` del sitio que aloja la interfaz; sin él (`null`) no hay enlaces. */
export function parseAssistantText(texto: string, origen: string | null = null): TextBlock[] {
  const lineas = texto.replace(/\r\n?/g, "\n").split("\n");
  const bloques: TextBlock[] = [];
  let parrafo: string[] = [];

  const cerrarParrafo = (): void => {
    if (parrafo.length === 0) return;
    bloques.push({ kind: "paragraph", children: parsearInlines(parrafo.join(" "), origen) });
    parrafo = [];
  };

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (FENCE.test(linea)) {
      cerrarParrafo();
      const cuerpo: string[] = [];
      i++;
      // Un fence sin cerrar es normal a mitad de un stream: se toma todo hasta el final.
      while (i < lineas.length && !FENCE.test(lineas[i])) {
        cuerpo.push(lineas[i]);
        i++;
      }
      bloques.push({ kind: "code", text: cuerpo.join("\n") });
      continue;
    }

    const guion = ITEM_GUION.exec(linea);
    const numero = guion === null ? ITEM_NUMERO.exec(linea) : null;
    if (guion !== null || numero !== null) {
      cerrarParrafo();
      const ordenada = numero !== null;
      const patron = ordenada ? ITEM_NUMERO : ITEM_GUION;
      const items: TextInline[][] = [];
      while (i < lineas.length) {
        const m = patron.exec(lineas[i]);
        if (m === null) break;
        items.push(parsearInlines(m[1], origen));
        i++;
      }
      i--; // el for vuelve a avanzar
      bloques.push({ kind: "list", ordered: ordenada, items });
      continue;
    }

    if (linea.trim() === "") {
      cerrarParrafo();
      continue;
    }
    parrafo.push(linea.trim());
  }
  cerrarParrafo();
  return bloques;
}

/** ¿Esta URL es del origen del sitio? Comparación exacta del origen ya parseado (esquema, host y puerto):
 * `app.cliente.com.evil.com`, un subdominio, otro puerto o `http` en vez de `https` no pasan, y una URL con
 * credenciales tampoco. */
function esDelOrigen(href: string, origen: string | null): boolean {
  if (origen === null) return false;
  try {
    const u = new URL(href);
    return u.origin === origen && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

// Inlines: un solo recorrido de izquierda a derecha. Cada marcador exige su cierre en la misma
// línea lógica; si no lo encuentra, es texto. Eso hace que "2 * 3" no abra una cursiva eterna.
function parsearInlines(texto: string, origen: string | null = null): TextInline[] {
  const salida: TextInline[] = [];
  let buffer = "";
  const volcar = (): void => {
    if (buffer !== "") {
      salida.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < texto.length) {
    const resto = texto.slice(i);

    if (resto.startsWith("`")) {
      const fin = texto.indexOf("`", i + 1);
      if (fin > i + 1) {
        volcar();
        salida.push({ kind: "code", text: texto.slice(i + 1, fin) });
        i = fin + 1;
        continue;
      }
    }

    if (resto.startsWith("**")) {
      const fin = texto.indexOf("**", i + 2);
      if (fin > i + 2) {
        volcar();
        salida.push({ kind: "bold", children: parsearInlines(texto.slice(i + 2, fin), origen) });
        i = fin + 2;
        continue;
      }
    }

    if (resto.startsWith("*") && !resto.startsWith("* ") && !resto.startsWith("**")) {
      const fin = texto.indexOf("*", i + 1);
      if (fin > i + 1 && texto[fin - 1] !== " ") {
        volcar();
        salida.push({ kind: "italic", children: parsearInlines(texto.slice(i + 1, fin), origen) });
        i = fin + 1;
        continue;
      }
    }

    // Detrás de un `!` el corchete abre una imagen, y las imágenes son texto (mismo criterio que el filtro del servidor).
    if (resto.startsWith("[") && texto[i - 1] !== "!") {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(resto);
      if (link !== null && esDelOrigen(link[2], origen)) {
        volcar();
        salida.push({ kind: "link", href: link[2], children: parsearInlines(link[1], origen) });
        i += link[0].length;
        continue;
      }
    }

    buffer += texto[i];
    i++;
  }
  volcar();
  return salida;
}
