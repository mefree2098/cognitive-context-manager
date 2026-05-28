import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { readUiState, startUiServer } from "../../core/ui-server.js";
import { openDb } from "../../storage/db.js";

export function registerUiCommand(program: Command): void {
  const ui = program.command("ui").description("Localhost-only CCM dashboard");
  ui.command("start").option("--port <port>", "Port").action(async (options: { port?: string }) => {
    const context = openDb(process.cwd());
    const config = loadConfig(process.cwd());
    if (options.port) config.ui.port = Number(options.port);
    const started = await startUiServer(context.db, config);
    console.log(`CCM UI listening at ${started.url}`);
    if (started.portShifted) {
      console.log(`Port ${started.requestedPort} was unavailable; shifted to ${started.port}.`);
    }
  });
  ui.command("open").action(() => {
    const config = loadConfig(process.cwd());
    const state = readUiState(config);
    console.log(`Open ${state?.url ?? `http://${config.ui.host}:${config.ui.port}`}`);
  });
  ui.command("status").action(() => {
    const config = loadConfig(process.cwd());
    const state = readUiState(config);
    console.log(JSON.stringify(state ?? { running: false, url: `http://${config.ui.host}:${config.ui.port}` }, null, 2));
  });
}
