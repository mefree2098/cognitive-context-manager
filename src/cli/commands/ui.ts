import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { startUiServer } from "../../core/ui-server.js";
import { openDb } from "../../storage/db.js";

export function registerUiCommand(program: Command): void {
  const ui = program.command("ui").description("Localhost-only CCM dashboard");
  ui.command("start").option("--port <port>", "Port").action(async (options: { port?: string }) => {
    const context = openDb(process.cwd());
    const config = loadConfig(process.cwd());
    if (options.port) config.ui.port = Number(options.port);
    const started = await startUiServer(context.db, config);
    console.log(`CCM UI listening at ${started.url}`);
  });
  ui.command("open").action(() => {
    const config = loadConfig(process.cwd());
    console.log(`Open http://${config.ui.host}:${config.ui.port}`);
  });
}
