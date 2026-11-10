import { runCli } from "./cli";

// El punto de entrada de `supcoflow-chat-fake` (`dist/fake-server.js`, con el shebang que le pone `build.mjs`).
process.exitCode = await runCli(process.argv.slice(2), { out: (t) => console.log(t), err: (t) => console.error(t) });
