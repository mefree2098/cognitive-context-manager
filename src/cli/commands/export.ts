import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { CcmService } from "../../core/consolidator.js";
import { openDb } from "../../storage/db.js";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export project or global CCM memory as JSON")
    .option("--project <projectId>", "Project ID or 'current'", "current")
    .option("--out <path>", "Output path", "./ccm-export.json")
    .action((options: { project: string; out: string }) => {
      const context = openDb(process.cwd());
      try {
        const service = new CcmService({ db: context.db, repoPath: process.cwd() });
        const projectId = options.project === "current" ? service.ensureProjectSession(process.cwd()).project.id : options.project;
        const data = {
          exportedAt: new Date().toISOString(),
          projectId,
          project: service.projects.get(projectId),
          memories: service.memories.list(10000, projectId),
          openLoops: service.openLoops.list(projectId, true, 10000),
          artifacts: service.artifacts.list(projectId, 10000),
          events: service.events.recent(projectId, 10000)
        };
        const out = resolve(options.out);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify(data, null, 2), "utf8");
        console.log(`Exported CCM data to ${out}`);
      } finally {
        context.db.close();
      }
    });
}
