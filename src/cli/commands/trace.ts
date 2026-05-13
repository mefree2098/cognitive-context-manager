import type { Command } from "commander";
import { openDb } from "../../storage/db.js";
import { CcmService } from "../../core/consolidator.js";

export function registerTraceCommand(program: Command): void {
  const trace = program.command("trace").description("Inspect CCM trace and retrieval explainability records");
  trace.command("latest").option("--type <type>", "Trace type").action((options: { type?: any }) => withService((service) => {
    console.log(JSON.stringify(service.traces.latest(options.type), null, 2));
  }));
  trace.command("tail").option("--limit <limit>", "Limit", "20").action((options: { limit: string }) => withService((service) => {
    console.log(JSON.stringify(service.traces.list(Number(options.limit)), null, 2));
  }));
  trace.command("explain").option("--latest", "Show latest retrieval explanation").option("--query <query>", "Query to explain").action((options: { latest?: boolean; query?: string }) => withService((service) => {
    if (options.latest) {
      console.log(JSON.stringify(service.traces.latest("retrieval"), null, 2));
      return;
    }
    console.log(JSON.stringify(service.explainRetrieval({ query: options.query ?? "current task" }), null, 2));
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
