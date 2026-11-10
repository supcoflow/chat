import { describe, expect, it, vi } from "vitest";
import { blobABase64, esImagen, LADO_MINIMO, MAX_BYTES_DE_IMAGEN, prepararImagen, puedeCapturarPantalla, type Codificar } from "./captura";

// Un codificador falso: produce un blob de `bytesPorPixel × ancho × alto` y del mime pedido. Con
// eso se prueba el bucle de reducción sin un canvas (happy-dom no tiene contexto 2d).
function codificadorFalso(bytesPorPixel: number, mime = "image/webp"): { codificar: Codificar; llamadas: { origen: unknown; salida: { ancho: number; alto: number } }[] } {
  const llamadas: { origen: unknown; salida: { ancho: number; alto: number } }[] = [];
  const codificar: Codificar = async (_fuente, origen, salida) => {
    llamadas.push({ origen, salida });
    return new Blob([new Uint8Array(Math.round(bytesPorPixel * salida.ancho * salida.alto))], { type: mime });
  };
  return { codificar, llamadas };
}
const FUENTE = {} as CanvasImageSource;
const ORIGEN = { x: 0, y: 0, ancho: 4000, alto: 2000 };

describe("prepararImagen", () => {
  it("una imagen que ya entra se codifica una vez al tamaño original (más la miniatura)", async () => {
    const { codificar, llamadas } = codificadorFalso(0.1);
    const r = await prepararImagen(FUENTE, ORIGEN, codificar);
    expect(r).not.toBeNull();
    expect(r!.ancho).toBe(4000);
    expect(r!.alto).toBe(2000);
    expect(r!.mime).toBe("image/webp");
    expect(r!.bytes).toBe(800_000);
    expect(llamadas[0].salida).toEqual({ ancho: 4000, alto: 2000 });
    expect(llamadas.at(-1)!.salida.ancho).toBe(160); // la miniatura, al final
    expect(r!.miniatura.startsWith("data:image/webp;base64,")).toBe(true);
  });
  it("reduce por mitades hasta caber en 1,5 MB", async () => {
    const { codificar, llamadas } = codificadorFalso(1); // 8 MB a tamaño original
    const r = await prepararImagen(FUENTE, ORIGEN, codificar);
    expect(r!.ancho).toBe(1000);
    expect(r!.alto).toBe(500);
    expect(r!.bytes).toBeLessThanOrEqual(MAX_BYTES_DE_IMAGEN);
    expect(llamadas.slice(0, 3).map((l) => l.salida.ancho)).toEqual([4000, 2000, 1000]);
  });
  it("si ni el lado mínimo entra, devuelve null en vez de subir algo que el motor rechace", async () => {
    const { codificar } = codificadorFalso(10_000);
    expect(await prepararImagen(FUENTE, { x: 0, y: 0, ancho: 100, alto: 100 }, codificar)).toBeNull();
  });
  it("el recorte viaja al codificador tal cual, y el mime es el del blob (PNG si el navegador no sabe WebP)", async () => {
    const { codificar, llamadas } = codificadorFalso(0.1, "image/png");
    const r = await prepararImagen(FUENTE, { x: 10, y: 20, ancho: 300, alto: 200 }, codificar);
    expect(llamadas[0].origen).toEqual({ x: 10, y: 20, ancho: 300, alto: 200 });
    expect(r!.mime).toBe("image/png");
  });
  it("un codificador que devuelve null (canvas contaminado, sin contexto) es null, no una excepción", async () => {
    expect(await prepararImagen(FUENTE, ORIGEN, async () => null)).toBeNull();
  });
  it("una fuente más chica que el lado mínimo se acepta igual: el mínimo es para la REDUCCIÓN", async () => {
    const { codificar } = codificadorFalso(0.1);
    const r = await prepararImagen(FUENTE, { x: 0, y: 0, ancho: LADO_MINIMO - 20, alto: 20 }, codificar);
    expect(r!.ancho).toBe(LADO_MINIMO - 20);
  });
});

describe("helpers", () => {
  it("blobABase64 codifica sin prefijo data:", async () => {
    expect(await blobABase64(new Blob([new Uint8Array([72, 111, 108, 97])]))).toBe("SG9sYQ==");
  });
  it("esImagen mira el tipo declarado: lo que no es image/* no se decodifica siquiera", () => {
    expect(esImagen({ type: "image/png" })).toBe(true);
    expect(esImagen({ type: "application/pdf" })).toBe(false);
    expect(esImagen({ type: "" })).toBe(false);
  });
  it("puedeCapturarPantalla exige contexto seguro y getDisplayMedia (§3.2: sin eso los botones no se dibujan)", () => {
    expect(puedeCapturarPantalla({ isSecureContext: true, navigator: { mediaDevices: { getDisplayMedia: () => {} } } })).toBe(true);
    expect(puedeCapturarPantalla({ isSecureContext: false, navigator: { mediaDevices: { getDisplayMedia: () => {} } } })).toBe(false);
    expect(puedeCapturarPantalla({ isSecureContext: true, navigator: { mediaDevices: {} } })).toBe(false);
    expect(puedeCapturarPantalla({ isSecureContext: true })).toBe(false);
  });
});
