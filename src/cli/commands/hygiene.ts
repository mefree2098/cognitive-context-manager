import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { HygieneService } from "../../core/hygiene.js";
import { openDb } from "../../storage/db.js";

export function registerHygieneCommand(program: Command): void {
  const hygiene = program.command("hygiene").description("Retention, decay, archive, and quarantine workflows");
  hygiene.command("report").action(() => withHygiene((service) => console.log(JSON.stringify(service.report(), null, 2))));
  hygiene
    .command("plan")
    .option("--older-than-days <days>", "Override low-salience age threshold")
    .option("--limit <count>", "Maximum actions to return")
    .option("--project <projectId>", "Limit to a project id")
    .action((options: HygieneOptions) => withHygiene((service) => console.log(JSON.stringify(service.plan(parseHygieneOptions(options)), null, 2))));
  hygiene
    .command("run")
    .option("--dry-run", "Show actions without applying")
    .option("--older-than-days <days>", "Override low-salience age threshold")
    .option("--limit <count>", "Maximum actions to apply")
    .option("--project <projectId>", "Limit to a project id")
    .action((options: HygieneOptions & { dryRun?: boolean }) =>
      withHygiene((service) => console.log(JSON.stringify(service.run(Boolean(options.dryRun), parseHygieneOptions(options)), null, 2)))
    );
  hygiene
    .command("duplicates")
    .description("Plan or apply duplicate and compact-handoff cleanup")
    .option("--apply", "Archive planned duplicate/handoff memories")
    .option("--limit <count>", "Maximum actions")
    .option("--project <projectId>", "Limit to a project id")
    .option("--keep-recent-handoffs <count>", "Newest compact handoffs to keep per project", "5")
    .action((options: HygieneOptions & { apply?: boolean; keepRecentHandoffs?: string }) =>
      withHygiene((service) =>
        console.log(
          JSON.stringify(
            service.runDuplicateHygiene(!options.apply, {
              ...parseHygieneOptions(options),
              keepRecentHandoffs: numberOption(options.keepRecentHandoffs)
            }),
            null,
            2
          )
        )
      )
    );
  hygiene
    .command("attribution")
    .description("Plan or apply cross-project attribution repair")
    .option("--apply", "Apply project reassignments")
    .option("--limit <count>", "Maximum actions")
    .option("--min-confidence <score>", "Minimum confidence, 0-1", "0.78")
    .option("--include-memories", "Also consider memory reassignment; off by default to avoid moving assessment notes that mention other projects")
    .action((options: { apply?: boolean; limit?: string; minConfidence?: string; includeMemories?: boolean }) =>
      withHygiene((service) =>
        console.log(
          JSON.stringify(
            service.repairAttribution(!options.apply, {
              limit: numberOption(options.limit),
              minConfidence: numberOption(options.minConfidence),
              includeMemories: options.includeMemories
            }),
            null,
            2
          )
        )
      )
    );
}

interface HygieneOptions {
  olderThanDays?: string;
  limit?: string;
  project?: string;
}

function parseHygieneOptions(options: HygieneOptions): { olderThanDays?: number; limit?: number; projectId?: string } {
  return {
    olderThanDays: numberOption(options.olderThanDays),
    limit: numberOption(options.limit),
    projectId: options.project
  };
}

function numberOption(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function withHygiene(fn: (service: HygieneService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new HygieneService(context.db, loadConfig(process.cwd())));
  } finally {
    context.db.close();
  }
}
