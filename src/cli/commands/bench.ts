import type { Command } from "commander";
import { BenchService } from "../../core/bench-service.js";
import { openDb } from "../../storage/db.js";

export function registerBenchCommand(program: Command): void {
  const bench = program.command("bench").description("Run local CCM benchmark scenarios");
  bench.command("run").option("--out <dir>", "Results directory").action((options: { out?: string }) => withBench((service) => console.log(JSON.stringify({ results: service.runAll(options.out) }, null, 2))));
  bench.command("compare").argument("<left>").argument("<right>").action((left: string, right: string) => withBench((service) => console.log(JSON.stringify(service.compare(left, right), null, 2))));
}

function withBench(fn: (service: BenchService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new BenchService(context.db));
  } finally {
    context.db.close();
  }
}
