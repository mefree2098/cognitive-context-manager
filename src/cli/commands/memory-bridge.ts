import type { Command } from "commander";
import { MemoryMarkdownBridgeService } from "../../core/memory-markdown-bridge.js";
import { CcmService } from "../../core/consolidator.js";
import { openDb } from "../../storage/db.js";
import type { MemoryType } from "../../types/memory.js";

const MEMORY_TYPES: readonly MemoryType[] = [
  "episodic",
  "semantic",
  "procedural",
  "salience",
  "open_loop",
  "artifact",
  "safety"
];

export function registerMemoryBridgeCommand(program: Command): void {
  const bridge = program
    .command("memory-bridge")
    .description("Import or export CCM memories through a Markdown bridge format");

  bridge
    .command("export")
    .description("Export memories as Markdown")
    .option("--project <projectId>", "Project ID")
    .option("--include-stale", "Include stale, archived, quarantined, and superseded memories")
    .option("--limit <count>", "Maximum memories to export", "500")
    .option("--out <path>", "Write Markdown to a file instead of stdout")
    .action((options: { project?: string; includeStale?: boolean; limit: string; out?: string }) =>
      withBridge((service) => {
        const markdown = options.out
          ? service.exportMarkdownFile(options.out, {
              projectId: options.project,
              includeStale: Boolean(options.includeStale),
              limit: Number(options.limit)
            })
          : service.exportMarkdown({
              projectId: options.project,
              includeStale: Boolean(options.includeStale),
              limit: Number(options.limit)
            });

        if (options.out) console.log(JSON.stringify({ exported: true, path: options.out }, null, 2));
        else console.log(markdown);
      })
    );

  bridge
    .command("import")
    .description("Import memories from CCM Markdown or generic Markdown sections")
    .argument("<path>")
    .option("--project <projectId>", "Project ID")
    .option("--project-name <name>", "Project name when creating/detecting the current project")
    .option("--type <memoryType>", "Default memory type for generic Markdown sections", "semantic")
    .option("--tag <tag...>", "Extra tag(s) to attach to imported memories")
    .option("--dry-run", "Parse and report candidates without writing memories")
    .action(
      (
        path: string,
        options: { project?: string; projectName?: string; type: string; tag?: string[]; dryRun?: boolean }
      ) =>
        withBridge((service) => {
          const result = service.importMarkdownFile(path, {
            projectId: options.project,
            projectName: options.projectName,
            repoPath: process.cwd(),
            defaultMemoryType: parseMemoryType(options.type),
            tag: options.tag,
            dryRun: Boolean(options.dryRun)
          });
          console.log(JSON.stringify(result, null, 2));
        })
    );
}

function withBridge(fn: (service: MemoryMarkdownBridgeService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new MemoryMarkdownBridgeService(new CcmService({ db: context.db, repoPath: process.cwd() })));
  } finally {
    context.db.close();
  }
}

function parseMemoryType(value: string): MemoryType {
  if (MEMORY_TYPES.includes(value as MemoryType)) return value as MemoryType;
  throw new Error(`Invalid memory type ${value}; expected one of ${MEMORY_TYPES.join(", ")}`);
}
