import { describe, expect, it } from "vitest";
import { claveDeSesion, guardarSesion, leerSesion } from "./sesion-guardada";

function storageFalso(): Storage & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: (k) => void datos.delete(k),
    clear: () => datos.clear(),
    key: () => null,
    get length() { return datos.size; },
  };
}

describe("sesión guardada", () => {
  it("la clave es por inquilino y proyecto: dos widgets en la misma página no se pisan", () => {
    expect(claveDeSesion("tnt_a", "proj_b")).toBe("supcoflow-chat/tnt_a/proj_b");
  });
  it("guarda y lee el cursor; null lo borra", () => {
    const s = storageFalso();
    guardarSesion(s, "k", { id: "01J", indice: 7 });
    expect(leerSesion(s, "k")).toEqual({ id: "01J", indice: 7 });
    guardarSesion(s, "k", null);
    expect(leerSesion(s, "k")).toBeNull();
  });
  it("el id sellado por el backend (A1) se guarda y se lee sin tocarlo", () => {
    const s = storageFalso();
    const sellado = `ss1.mh3k2x1.${"A".repeat(43)}.wrun_01M674JG3TYJXKTXSYXXVWJYC3`;
    guardarSesion(s, "k", { id: sellado, indice: 2 });
    expect(leerSesion(s, "k")).toEqual({ id: sellado, indice: 2 });
  });
  it("basura en el storage es null, no una excepción en el render", () => {
    const s = storageFalso();
    s.setItem("k", "{no es json");
    expect(leerSesion(s, "k")).toBeNull();
    s.setItem("k", JSON.stringify({ id: 3 }));
    expect(leerSesion(s, "k")).toBeNull();
  });
  it("un storage que lanza (modo privado) no rompe nada", () => {
    const roto = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("x"); }, removeItem: () => {} };
    expect(leerSesion(roto, "k")).toBeNull();
    expect(() => guardarSesion(roto, "k", { id: "a", indice: 0 })).not.toThrow();
  });
});
