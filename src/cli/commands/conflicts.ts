import type { Command } from "commander";
import { CcmService } from "../../core/consolidator.js";
import { openDb } from "../../storage/db.js";

export function registerConflictsCommand(program: Command): void {
  const conflicts = program.command("conflicts").description("Inspect and resolve memory conflicts");
  conflicts.command("list").option("--project <projectId>", "Project ID").action((options: { project?: string }) => withService((service) => console.log(JSON.stringify(service.reconcileConflicts(options.project), null, 2))));
  conflicts.command("show").argument("<id>").action((id: string) => withService((service) => console.log(JSON.stringify(service.conflicts.get(id), null, 2))));
  conflicts.command("resolve").argument("<id>").requiredOption("--resolution <resolution>", "Resolution").option("--use <side>", "local|remote|manual", "manual").action((id: string, options: { resolution: string; use: string }) => withService((service) => console.log(JSON.stringify({ conflict: service.conflicts.resolve(id, `${options.resolution} (use ${options.use})`) }, null, 2))));
}

function withService(fn: (service: CcmService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new CcmService({ db: context.db, repoPath: process.cwd() }));
  } finally {
    context.db.close();
  }
}
