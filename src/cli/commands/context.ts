import type { Command } from "commander";
import { AutoTailContextService } from "../../core/auto-tail-context.js";
import { CcmService } from "../../core/consolidator.js";
import { openDb } from "../../storage/db.js";

export function registerContextCommand(program: Command): void {
  const contextCommand = program.command("context").description("Preview briefs and report context dividend metrics");
  contextCommand.command("preview").requiredOption("--query <query>", "Context query").option("--max-tokens <tokens>", "Max tokens", "1200").action((options: { query: string; maxTokens: string }) => withService((service) => {
    console.log(service.getWorkingContext({ task: options.query, repoPath: process.cwd(), maxTokens: Number(options.maxTokens) }).working_context_brief);
  }));

  contextCommand
    .command("auto-tail")
    .description("Preview the policy-gated auto-tail context block without injecting it")
    .requiredOption("--query <query>", "Context query")
    .option("--max-tokens <tokens>", "Max tokens")
    .option("--force-preview", "Render a preview even when auto-tail is disabled")
    .option("--accepted-preview", "Mark the preview as explicitly accepted for policy evaluation")
    .option("--json", "Print full JSON result")
    .action((options: { query: string; maxTokens?: string; forcePreview?: boolean; acceptedPreview?: boolean; json?: boolean }) =>
      withService((service) => {
        const result = new AutoTailContextService(service).preview({
          query: options.query,
          repoPath: process.cwd(),
          maxTokens: options.maxTokens ? Number(options.maxTokens) : undefined,
          forcePreview: Boolean(options.forcePreview),
          acceptedPreview: Boolean(options.acceptedPreview)
        });
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else console.log(result.tailBlock || JSON.stringify({ previewed: false, reason: result.reason }, null, 2));
      })
    );
  contextCommand.command("dividend").option("--session <session>", "Session ID or latest", "latest").option("--json", "JSON output").action((options: { session: string; json?: boolean }) => withService((service) => {
    const dividend = service.contextDividend(options.session === "latest" ? undefined : options.session);
    if (options.json) console.log(JSON.stringify(dividend, null, 2));
    else {
      console.log(`Context Dividend - ${dividend.sessionId}`);
      console.log(`Injected memory tokens:       ${dividend.injectedMemoryTokens}`);
      console.log(`Avoided raw transcript tokens: ${dividend.rawTranscriptTokensAvoided}`);
      console.log(`Avoided raw log tokens:        ${dividend.rawLogTokensAvoided}`);
      console.log(`Superseded memories excluded:  ${dividend.supersededMemoriesExcluded}`);
      console.log(`Open loops preserved:          ${dividend.openLoopTasksPreserved}`);
      console.log(`Net estimated token savings:   ${dividend.netEstimatedTokenSavings}`);
      console.log("Quality notes:");
      for (const note of dividend.qualityNotes) console.log(`- ${note}`);
    }
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
