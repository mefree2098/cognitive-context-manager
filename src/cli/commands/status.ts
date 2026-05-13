import type { Command } from "commander";
import { CcmService } from "../../core/consolidator.js";
import { loadConfig } from "../../config/load-config.js";
import { openDb } from "../../storage/db.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show CCM enabled state, active project, memory counts, open loops, and recent events")
    .option("--json", "Print JSON")
    .action((options: { json?: boolean }) => {
      const context = openDb(process.cwd());
      try {
        const service = new CcmService({ db: context.db, repoPath: process.cwd() });
        const config = loadConfig(process.cwd());
        const { project } = service.ensureProjectSession(process.cwd());
        const status = {
          enabled: config.enabled,
          database: context.path,
          project,
          memoryCounts: service.memories.countsByType(project.id),
          openLoops: service.openLoops.list(project.id, false, 10),
          recentEvents: service.events.recent(project.id, 5)
        };
        if (options.json) console.log(JSON.stringify(status, null, 2));
        else {
          console.log(`Enabled: ${status.enabled}`);
          console.log(`Database: ${status.database}`);
          console.log(`Project: ${project.name} (${project.id})`);
          console.log(`Memories: ${JSON.stringify(status.memoryCounts)}`);
          console.log(`Open loops: ${status.openLoops.length}`);
          console.log(`Recent events: ${status.recentEvents.length}`);
        }
      } finally {
        context.db.close();
      }
    });
}
