import type { RectDelElemento } from "./elemento";

// La tubería única de imagen (§3.2 del diseño): venga de `getDisplayMedia`, de un archivo o de un
// recorte, se re-codifica a WebP (PNG si el navegador no sabe WebP: Safari) y se reduce por
// mitades hasta caber en 1,5 MB, que es la cota del motor. Re-codificar tiene un efecto que se
// busca: la imagen que sube nunca lleva los metadatos (EXIF, ubicación) del archivo original.
//
// El canvas entra por parámetro (`Codificar`): happy-dom no tiene contexto 2d, y lo que tiene
// lógica —el bucle de reducción— se testea con un codificador falso. `codificarConCanvas` es la
// única función que toca el canvas real y se prueba a mano.

export const MAX_BYTES_DE_IMAGEN = 1_500_000;
/** Debajo de esto no se sigue reduciendo: una captura de 32 px no le sirve a nadie. */
export const LADO_MINIMO = 64;
export const ANCHO_DE_MINIATURA = 160;

export type MimeDeImagen = "image/webp" | "image/png";

export interface Origen {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export type Codificar = (fuente: CanvasImageSource, origen: Origen, salida: { ancho: number; alto: number }) => Promise<Blob | null>;

export interface ImagenLista {
  /** Base64 SIN prefijo `data:` — es lo que el motor espera en `imagen`. */
  base64: string;
  mime: MimeDeImagen;
  ancho: number;
  alto: number;
  bytes: number;
  /** Data URL chica para la barra de adjuntos. */
  miniatura: string;
}

function mimeDelBlob(b: Blob): MimeDeImagen {
  return b.type === "image/webp" ? "image/webp" : "image/png";
}

export async function blobABase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // En trozos: `String.fromCharCode(...bytes)` de 1,5 MB revienta la pila de argumentos.
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

export async function prepararImagen(fuente: CanvasImageSource, origen: Origen, codificar: Codificar): Promise<ImagenLista | null> {
  let ancho = Math.max(1, Math.round(origen.ancho));
  let alto = Math.max(1, Math.round(origen.alto));
  let blob: Blob | null = null;
  // Reducir por mitades hasta caber; si ya estamos en el lado mínimo y sigue sin entrar, se rinde.
  while (true) {
    blob = await codificar(fuente, origen, { ancho, alto });
    if (blob === null) return null;
    if (blob.size <= MAX_BYTES_DE_IMAGEN) break;
    if (Math.min(ancho, alto) <= LADO_MINIMO) return null;
    ancho = Math.max(LADO_MINIMO, Math.round(ancho / 2));
    alto = Math.max(LADO_MINIMO, Math.round(alto / 2));
  }
  const factor = Math.min(1, ANCHO_DE_MINIATURA / ancho);
  const mini = await codificar(fuente, origen, { ancho: Math.max(1, Math.round(ancho * factor)), alto: Math.max(1, Math.round(alto * factor)) });
  const mime = mimeDelBlob(blob);
  return {
    base64: await blobABase64(blob),
    mime,
    ancho,
    alto,
    bytes: blob.size,
    miniatura: mini === null ? "" : `data:${mimeDelBlob(mini)};base64,${await blobABase64(mini)}`,
  };
}

/** El codificador real. Pide WebP; si el navegador devuelve otra cosa (Safari no codifica WebP),
 * se queda con PNG — el `type` del blob dice la verdad, no lo que se pidió. */
export function codificarConCanvas(documento: Document): Codificar {
  return async (fuente, origen, salida) => {
    const canvas = documento.createElement("canvas");
    canvas.width = salida.ancho;
    canvas.height = salida.alto;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    ctx.drawImage(fuente, origen.x, origen.y, origen.ancho, origen.alto, 0, 0, salida.ancho, salida.alto);
    const aBlob = (tipo: string): Promise<Blob | null> => new Promise((resolver) => canvas.toBlob(resolver, tipo, 0.85));
    const webp = await aBlob("image/webp");
    if (webp !== null && webp.type === "image/webp") return webp;
    return aBlob("image/png");
  };
}

export function esImagen(archivo: { type: string }): boolean {
  return archivo.type.startsWith("image/");
}

/** «Adjuntar imagen», el camino universal (§3.2). Decodifica con `createImageBitmap`; un archivo
 * que no decodifica (extensión mentirosa, imagen rota) es `null`, nunca una excepción. */
export async function imagenDesdeArchivo(archivo: File, ventana: Window): Promise<{ fuente: CanvasImageSource; ancho: number; alto: number } | null> {
  if (!esImagen(archivo)) return null;
  try {
    const bitmap = await ventana.createImageBitmap(archivo);
    return { fuente: bitmap, ancho: bitmap.width, alto: bitmap.height };
  } catch {
    return null;
  }
}

export function puedeCapturarPantalla(ventana: { isSecureContext?: boolean; navigator?: { mediaDevices?: { getDisplayMedia?: unknown } } }): boolean {
  return ventana.isSecureContext === true && typeof ventana.navigator?.mediaDevices?.getDisplayMedia === "function";
}

/** Cuánto se espera al diálogo del navegador (elegir pestaña, aceptar). Un usuario real tarda segundos; si pasa un minuto o el navegador
 * no puede mostrar el diálogo (Chrome headless), se sigue sin captura. */
export const ESPERA_DEL_PERMISO_MS = 60_000;
/** Cuánto se espera, ya con permiso, a que el video cargue y se pinte el frame. */
export const ESPERA_DEL_VIDEO_MS = 5_000;

export interface OpcionesDeCaptura {
  /** Corre cuando ya hay permiso y falta tomar el frame: ahí el widget se oculta y espera a que el navegador repinte. */
  antesDelFrame?: () => void | Promise<void>;
  esperaDelPermisoMs?: number;
  esperaDelVideoMs?: number;
  /** «Hay un `getDisplayMedia` pendiente»: dura hasta que la promesa NATIVA termina, aunque `capturarPantalla` ya haya devuelto `null` por
   * el tope de tiempo (no se puede cancelar un permiso que el navegador sigue mostrando). Mientras esté en `true` no se pide otro. El
   * llamador lo guarda (en el widget, un ref) para que sobreviva entre toques. */
  permisoPendiente?: { current: boolean };
}

type ConTope<T> = { tipo: "ok"; valor: T } | { tipo: "vencio" };

/** La promesa o un tope de tiempo, lo que llegue primero. La promesa original NO se cancela: el llamador decide qué hacer si llega tarde. */
function conTope<T>(promesa: Promise<T>, ms: number): Promise<ConTope<T>> {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => resolver({ tipo: "vencio" }), ms);
    promesa.then(
      (valor) => { clearTimeout(reloj); resolver({ tipo: "ok", valor }); },
      (e) => { clearTimeout(reloj); rechazar(e); },
    );
  });
}

const pararPistas = (stream: MediaStream): void => {
  for (const t of stream.getTracks()) t.stop();
};

/** «Capturar pantalla» / «Capturar este elemento» (§3.2): un frame de la propia pestaña por
 * `getDisplayMedia`, recortado al elemento si hay `recorte` (en px CSS del viewport). La escala
 * entre el frame y el viewport se MIDE (`videoWidth / innerWidth`) en vez de asumir el DPR: el
 * navegador puede entregar el frame a otra resolución. Permiso denegado, cancelado o vencido → `null`; el
 * llamador avisa «Sin captura. El elemento se adjunta igual.»
 *
 * 2.3.1: NADA puede colgarse. El permiso tiene tope (`esperaDelPermisoMs`; si llega después, sus pistas se cierran), y el frame también
 * (`esperaDelVideoMs`: metadatos, `play()` y los cuadros de repintado, que en una pestaña de fondo no corren). Las pistas se cierran
 * siempre. */
export async function capturarPantalla(ventana: Window, recorte: RectDelElemento | null, codificar: Codificar, opciones: OpcionesDeCaptura = {}): Promise<ImagenLista | null> {
  // Un permiso anterior que venció por tiempo sigue pendiente en el navegador: no se abre otro encima (hallazgo 1 de la revisión de 2.3.1).
  if (opciones.permisoPendiente?.current === true) return null;
  if (opciones.permisoPendiente !== undefined) opciones.permisoPendiente.current = true;
  const liberar = (): void => {
    if (opciones.permisoPendiente !== undefined) opciones.permisoPendiente.current = false;
  };
  const pedido = (async () =>
    ventana.navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" } as MediaTrackConstraints,
      audio: false,
      // Chromium: preselecciona esta pestaña y la deja elegir a sí misma.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions))();
  let stream: MediaStream;
  try {
    const r = await conTope(pedido, opciones.esperaDelPermisoMs ?? ESPERA_DEL_PERMISO_MS);
    if (r.tipo === "vencio") {
      // Si el permiso llega después, la captura de pantalla que abre no queda viva sin que nadie la use; y recién cuando esa promesa
      // termina (se resuelve o se rechaza) se permite pedir otro permiso.
      pedido.then((tarde) => { pararPistas(tarde); liberar(); }, liberar);
      return null;
    }
    stream = r.valor;
    liberar();
  } catch {
    liberar();
    return null;
  }
  const tomarFrame = async (): Promise<ImagenLista | null> => {
    try {
      await opciones.antesDelFrame?.();
      const video = ventana.document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await new Promise<void>((resolver, rechazar) => {
        video.onloadedmetadata = () => resolver();
        video.onerror = () => rechazar(new Error("el video no cargó"));
      });
      await video.play();
      // Un frame después de que el compositor dibujó: sin esto el primer frame puede venir negro.
      await new Promise((r) => ventana.requestAnimationFrame(() => ventana.requestAnimationFrame(r)));
      const escala = video.videoWidth / ventana.innerWidth;
      const origen: Origen =
        recorte === null
          ? { x: 0, y: 0, ancho: video.videoWidth, alto: video.videoHeight }
          : {
              x: Math.max(0, Math.round(recorte.x * escala)),
              y: Math.max(0, Math.round(recorte.y * escala)),
              ancho: Math.max(1, Math.min(video.videoWidth, Math.round(recorte.width * escala))),
              alto: Math.max(1, Math.min(video.videoHeight, Math.round(recorte.height * escala))),
            };
      return await prepararImagen(video, origen, codificar);
    } catch {
      return null;
    }
  };
  try {
    const r = await conTope(tomarFrame(), opciones.esperaDelVideoMs ?? ESPERA_DEL_VIDEO_MS);
    return r.tipo === "ok" ? r.valor : null;
  } catch {
    return null;
  } finally {
    pararPistas(stream);
  }
}
