import type { Command } from "commander";
import { EffectivenessReportService } from "../../core/effectiveness-report.js";
import { openDb } from "../../storage/db.js";

export function registerReportCommand(program: Command): void {
  const report = program.command("report").description("Generate local CCM effectiveness and publishing-readiness reports");

  report
    .command("effectiveness")
    .description("Report whether CCM is helping with context, resumability, and long-running task recovery")
    .option("--since <window>", "Time window such as 24h, 7d, 4w, or all", "7d")
    .option("--project <projectId>", "Project ID")
    .option("--project-name <name>", "Project name or root path fragment")
    .option("--format <format>", "json or markdown", "markdown")
    .option("--sample-limit <count>", "Evidence samples per section", "5")
    .action((options: { since: string; project?: string; projectName?: string; format: string; sampleLimit: string }) => {
      const context = openDb(process.cwd());
      try {
        const service = new EffectivenessReportService(context.db, context.config);
        const reportData = service.report({
          since: options.since,
          projectId: options.project,
          projectName: options.projectName,
          format: options.format === "json" ? "json" : "markdown",
          sampleLimit: Number(options.sampleLimit)
        });
        if (options.format === "json") console.log(JSON.stringify(reportData, null, 2));
        else console.log(service.renderMarkdown(reportData));
      } finally {
        context.db.close();
      }
    });
}
