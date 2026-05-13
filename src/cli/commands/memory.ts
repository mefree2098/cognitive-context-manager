import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { CcmService } from "../../core/consolidator.js";
import { HygieneService } from "../../core/hygiene.js";
import { openDb } from "../../storage/db.js";

export function registerMemoryCommand(program: Command): void {
  const memory = program.command("memory").description("List, search, show, forget, export, or purge memories");

  memory
    .command("list")
    .option("--project <projectId>", "Project ID")
    .option("--limit <limit>", "Limit", "20")
    .action((options: { project?: string; limit: string }) => withService((service) => {
      console.log(JSON.stringify(service.memories.list(Number(options.limit), options.project), null, 2));
    }));

  memory.command("archive").argument("<id>").action((id: string) => withService((service) => {
    console.log(JSON.stringify(new HygieneService(service.db, loadConfig(process.cwd())).setStatus(id, "archived", "manual archive"), null, 2));
  }));

  memory.command("restore").argument("<id>").action((id: string) => withService((service) => {
    console.log(JSON.stringify(new HygieneService(service.db, loadConfig(process.cwd())).setStatus(id, "active", "manual restore"), null, 2));
  }));

  memory.command("quarantine").argument("<id>").option("--reason <reason>", "Reason", "manual quarantine").action((id: string, options: { reason: string }) => withService((service) => {
    console.log(JSON.stringify(new HygieneService(service.db, loadConfig(process.cwd())).setStatus(id, "quarantined", options.reason), null, 2));
  }));

  memory
    .command("search")
    .argument("<query>")
    .option("--project <projectId>", "Project ID")
    .option("--limit <limit>", "Limit", "10")
    .option("--include-stale", "Include stale memories")
    .action((query: string, options: { project?: string; limit: string; includeStale?: boolean }) => withService((service) => {
      console.log(
        JSON.stringify(
          service.searchMemories({
            query,
            projectId: options.project,
            limit: Number(options.limit),
            includeStale: Boolean(options.includeStale)
          }),
          null,
          2
        )
      );
    }));

  memory.command("show").argument("<id>").action((id: string) => withService((service) => {
    const found = service.memories.get(id);
    if (!found) {
      console.error(`Memory not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(found, null, 2));
  }));

  memory
    .command("forget")
    .argument("<id>")
    .option("--hard-delete", "Delete instead of tombstoning")
    .action((id: string, options: { hardDelete?: boolean }) => withService((service) => {
      const ok = service.memories.forget(id, Boolean(options.hardDelete));
      console.log(JSON.stringify({ ok, id, hardDelete: Boolean(options.hardDelete) }, null, 2));
      process.exitCode = ok ? 0 : 1;
    }));

  memory.command("purge").option("--project <projectId>", "Project ID").action((options: { project?: string }) => withService((service) => {
    const memories = service.memories.list(10000, options.project);
    for (const item of memories) service.memories.forget(item.id, true);
    console.log(JSON.stringify({ purged: memories.length, projectId: options.project ?? null }, null, 2));
  }));
}

function withService(fn: (service: CcmService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new CcmService({ db: context.db, repoPath: process.cwd() }));
  } finally {
    context.db.close();
  }
}
