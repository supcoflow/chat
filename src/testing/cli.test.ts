import { afterEach, describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "./cli";

// El comando `supcoflow-chat-fake`: arranca el servidor local con un escenario. Lo que se prueba es lo que decide (los argumentos) y lo que dice (la lista y la
// ayuda); el servidor en sí se prueba en `servidor-local.test.ts`.

describe("parseCliArgs", () => {
  it("sin argumentos: el escenario por defecto, el puerto 4010 y 300 ms entre líneas", () => {
    expect(parseCliArgs([])).toEqual({ kind: "serve", scenario: "report-confirmed", port: 4010, host: "127.0.0.1", lineDelayMs: 300 });
  });
  it("el escenario es el primer argumento, y --port, --host y --delay se leen con su valor", () => {
    expect(parseCliArgs(["daily-cap-mid-conversation", "--port", "5000", "--host", "0.0.0.0", "--delay", "0"])).toEqual({ kind: "serve", scenario: "daily-cap-mid-conversation", port: 5000, host: "0.0.0.0", lineDelayMs: 0 });
  });
  it("--list y --help", () => {
    expect(parseCliArgs(["--list"])).toEqual({ kind: "list" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });
  it.each([
    [["--port"], /--port/],
    [["--port", "abc"], /--port/],
    [["--port", "70000"], /--port/],
    [["--delay", "-5"], /--delay/],
    [["--nope"], /--nope/],
    [["one", "two"], /two/],
  ])("%j es un error con un mensaje que dice qué pasó", (args, mensaje) => {
    const r = parseCliArgs(args);
    expect(r.kind).toBe("error");
    expect((r as { kind: "error"; message: string }).message).toMatch(mensaje);
  });
});

describe("runCli", () => {
  let salida = "";
  const io = { out: (t: string) => { salida += `${t}\n`; }, err: (t: string) => { salida += `${t}\n`; } };
  afterEach(() => { salida = ""; });

  it("--list imprime cada escenario con su descripción y devuelve 0", async () => {
    expect(await runCli(["--list"], io)).toBe(0);
    expect(salida).toContain("report-confirmed");
    expect(salida).toContain("session-limit-mid-conversation");
  });
  it("--help explica el uso y devuelve 0", async () => {
    expect(await runCli(["--help"], io)).toBe(0);
    expect(salida).toMatch(/supcoflow-chat-fake \[scenario\]/);
  });
  it("un escenario que no existe devuelve 1 y lista los que hay", async () => {
    expect(await runCli(["nope"], io)).toBe(1);
    expect(salida).toMatch(/nope/);
    expect(salida).toContain("report-confirmed");
  });
  it("un argumento mal puesto devuelve 1", async () => {
    expect(await runCli(["--port", "x"], io)).toBe(1);
  });
});
