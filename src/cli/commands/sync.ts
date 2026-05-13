import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { SyncService } from "../../core/sync-service.js";
import { openDb } from "../../storage/db.js";

export function registerSyncCommand(program: Command): void {
  const sync = program.command("sync").description("Optional encrypted file sync commands");
  sync.command("init").action(() => withSync((service) => console.log(JSON.stringify(service.init(), null, 2))));
  sync.command("status").action(() => withSync((service) => console.log(JSON.stringify(service.status(), null, 2))));
  sync.command("push").option("--project <projectId>", "Project ID").action((options: { project?: string }) => withSync((service) => console.log(JSON.stringify(service.push(options.project), null, 2))));
  sync.command("pull").option("--path <path>", "Bundle path").action((options: { path?: string }) => withSync((service) => console.log(JSON.stringify(service.pull(options.path), null, 2))));
  sync.command("resolve").action(() => console.log("Use ccm conflicts commands for manual conflict review; file sync preserves tombstones and does not silently merge contradictions."));
  sync.command("disable").action(() => withSync((service) => {
    service.disable();
    console.log(JSON.stringify({ disabled: true }, null, 2));
  }));
}

function withSync(fn: (service: SyncService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new SyncService(context.db, loadConfig(process.cwd())));
  } finally {
    context.db.close();
  }
}
