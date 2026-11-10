import { scenarioNames, scenarios } from "./catalogo";
import { startFakeServer, type FakeServer } from "./servidor-local";

// `supcoflow-chat-fake [scenario]`: el servidor local del banco de pruebas, como comando. Sin dependencias y sin tocar `process` salvo en `bin.ts`:
// `runCli` recibe los argumentos y dónde escribir, así se prueba.

export type CliCommand =
  | { kind: "serve"; scenario: string; port: number; host: string; lineDelayMs: number }
  | { kind: "list" }
  | { kind: "help" }
  | { kind: "error"; message: string };

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const r = { kind: "serve" as const, scenario: "report-confirmed", port: 4010, host: "127.0.0.1", lineDelayMs: 300 };
  let nombre: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--list") return { kind: "list" };
    if (a === "--port" || a === "--host" || a === "--delay") {
      const v = argv[++i];
      if (v === undefined) return { kind: "error", message: `${a} needs a value.` };
      if (a === "--host") r.host = v;
      else {
        const n = Number(v);
        if (a === "--port" && !(Number.isInteger(n) && n >= 0 && n <= 65535)) return { kind: "error", message: `--port needs a number from 0 to 65535 (got "${v}").` };
        if (a === "--delay" && !(Number.isFinite(n) && n >= 0)) return { kind: "error", message: `--delay needs a number of milliseconds, 0 or more (got "${v}").` };
        if (a === "--port") r.port = n;
        else r.lineDelayMs = n;
      }
      continue;
    }
    if (a.startsWith("-")) return { kind: "error", message: `Unknown option ${a}. Try --help.` };
    if (nombre !== undefined) return { kind: "error", message: `Unexpected argument "${a}": there is only one scenario at a time.` };
    nombre = a;
  }
  return { ...r, ...(nombre === undefined ? {} : { scenario: nombre }) };
}

const AYUDA = `supcoflow-chat-fake [scenario] [--port 4010] [--host 127.0.0.1] [--delay 300]
supcoflow-chat-fake --list

A fake Supcoflow chat backend on your machine, for building and checking a chat interface without spending anything and without waiting for the model.
Point your app's chat at the URL it prints (the \`backendUrl\` option; any tenantId and projectId work) and walk through the scenario.

  scenario   one of --list. Default: report-confirmed.
  --port     default 4010. 0 picks a free one.
  --host     default 127.0.0.1 (only this machine).
  --delay    milliseconds between the lines of an answer, so the streaming can be seen. Default 300. 0: all at once.

While it runs: GET /__fake/scenarios, POST /__fake/scenario {"name": "…"} to switch, POST /__fake/reset to start the scenario over, GET /__fake/state for what your app asked.`;

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const c = parseCliArgs(argv);
  if (c.kind === "help") return io.out(AYUDA), 0;
  if (c.kind === "list") {
    for (const s of scenarios) io.out(`${s.name}\n    ${s.description}`);
    return 0;
  }
  if (c.kind === "error") return io.err(`${c.message}\n\n${AYUDA}`), 1;
  if (!scenarioNames.includes(c.scenario)) {
    io.err(`Unknown scenario "${c.scenario}". The scenarios are:\n  ${scenarioNames.join("\n  ")}`);
    return 1;
  }
  let servidor: FakeServer;
  try {
    servidor = await startFakeServer({ scenario: c.scenario, port: c.port, host: c.host, lineDelayMs: c.lineDelayMs });
  } catch (e) {
    io.err(`The fake server could not start: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  io.out(`Supcoflow fake chat backend, scenario "${c.scenario}"\n  backendUrl: ${servidor.url}\n\nPress Ctrl+C to stop. Switch scenario: curl -X POST ${servidor.url}/__fake/scenario -d '{"name":"report-revised"}'`);
  return new Promise<number>((resolver) => {
    const parar = () => void servidor.close().then(() => resolver(0));
    process.once("SIGINT", parar);
    process.once("SIGTERM", parar);
  });
}
