import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { AdaptiveAgentGuidanceService } from "../../core/adaptive-agents.js";
import { AgentsSuggestionService } from "../../core/agents-suggestions.js";
import { CcmService } from "../../core/consolidator.js";
import { openDb } from "../../storage/db.js";

export function registerAgentsCommand(program: Command): void {
  const agents = program.command("agents").description("AGENTS.md suggestion workflow");
  agents.command("suggestions").option("--project <projectId>", "Project ID").action((options: { project?: string }) => withAgents((service) => console.log(JSON.stringify(service.list(options.project), null, 2))));
  agents.command("show").argument("<id>").action((id: string) => withAgents((service) => console.log(JSON.stringify(service.get(id), null, 2))));
  agents.command("apply").argument("<id>").action((id: string) => withAgents((service) => console.log(JSON.stringify(service.apply(id, process.cwd()), null, 2))));
  agents.command("reject").argument("<id>").action((id: string) => withAgents((service) => console.log(JSON.stringify(service.reject(id), null, 2))));
  agents.command("suggest").requiredOption("--reason <reason>").requiredOption("--instruction <instruction>").option("--project <projectId>").action((options: { reason: string; instruction: string; project?: string }) => withService((service) => console.log(JSON.stringify(service.suggestAgentsMdUpdate({ projectId: options.project, repoPath: process.cwd(), reason: options.reason, candidateInstruction: options.instruction }), null, 2))));
  const project = agents.command("project").description("Explicit project AGENTS.md apply helpers");
  project.command("apply").option("--pending", "Apply the newest pending project AGENTS.md suggestion").argument("[id]").action((id: string | undefined, options: { pending?: boolean }) => withAgents((service) => {
    const suggestionId = id ?? (options.pending ? service.list().find((item) => item.status === "pending_user_review")?.id : undefined);
    if (!suggestionId) {
      console.error("No project AGENTS.md suggestion selected.");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(service.apply(suggestionId, process.cwd()), null, 2));
  }));
  const adaptive = agents.command("adaptive").description("CCM-owned adaptive agent guidance");
  adaptive.command("status").action(() => withAdaptive((service) => console.log(JSON.stringify(service.status(), null, 2))));
  adaptive.command("preview").option("--max-tokens <tokens>", "Max tokens").action((options: { maxTokens?: string }) => withAdaptive((service) => {
    const preview = service.preview(options.maxTokens ? Number(options.maxTokens) : undefined);
    console.log(`${preview.text}\n\nToken count: ${preview.tokenCount}\nHash: ${preview.hash}`);
  }));
  adaptive.command("diff").action(() => withAdaptive((service) => {
    const latest = service.patches(1, "pending")[0] ?? service.patches(1)[0];
    console.log(latest?.diff ?? "No adaptive guidance patches found.");
  }));
  adaptive.command("apply").argument("[id]").option("--allow-protected-section-change", "Allow protected section edits").action((id: string | undefined, options: { allowProtectedSectionChange?: boolean }) => withAdaptive((service) => console.log(JSON.stringify(service.applyPatch(id, { allowProtectedSectionChange: Boolean(options.allowProtectedSectionChange), appliedBy: "cli" }), null, 2))));
  adaptive.command("reject").argument("[id]").option("--reason <reason>", "Reason", "Rejected by user.").action((id: string | undefined, options: { reason: string }) => withAdaptive((service) => console.log(JSON.stringify(service.rejectPatch(id, options.reason), null, 2))));
  adaptive.command("rollback").option("--to <hash>", "Hash/version target", "last").action((options: { to: string }) => withAdaptive((service) => console.log(JSON.stringify(service.rollback(options.to), null, 2))));
  adaptive.command("history").option("--limit <limit>", "Limit", "50").action((options: { limit: string }) => withAdaptive((service) => console.log(service.history(Number(options.limit)).join("\n"))));
  adaptive.command("explain").argument("<query>").action((query: string) => withAdaptive((service) => console.log(JSON.stringify(service.explainRule(query), null, 2))));
  adaptive.command("propose").requiredOption("--text <text>", "Candidate text").action((options: { text: string }) => withAdaptive((service) => console.log(JSON.stringify(service.proposePatch({ text: options.text, requiresReview: true }), null, 2))));
}

function withAgents(fn: (service: AgentsSuggestionService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new AgentsSuggestionService(context.db));
  } finally {
    context.db.close();
  }
}

function withService(fn: (service: CcmService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new CcmService({ db: context.db, repoPath: process.cwd() }));
  } finally {
    context.db.close();
  }
}

function withAdaptive(fn: (service: AdaptiveAgentGuidanceService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new AdaptiveAgentGuidanceService(context.db, loadConfig(process.cwd())));
  } finally {
    context.db.close();
  }
}
