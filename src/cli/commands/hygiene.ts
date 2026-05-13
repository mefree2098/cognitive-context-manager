import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { HygieneService } from "../../core/hygiene.js";
import { openDb } from "../../storage/db.js";

export function registerHygieneCommand(program: Command): void {
  const hygiene = program.command("hygiene").description("Retention, decay, archive, and quarantine workflows");
  hygiene.command("report").action(() => withHygiene((service) => console.log(JSON.stringify(service.report(), null, 2))));
  hygiene.command("run").option("--dry-run", "Show actions without applying").action((options: { dryRun?: boolean }) => withHygiene((service) => console.log(JSON.stringify(service.run(Boolean(options.dryRun)), null, 2))));
}

export function withHygiene(fn: (service: HygieneService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new HygieneService(context.db, loadConfig(process.cwd())));
  } finally {
    context.db.close();
  }
}
