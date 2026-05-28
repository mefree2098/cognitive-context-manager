#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CcmService } from "../core/consolidator.js";
import { openDb } from "../storage/db.js";
import { log } from "../core/logger.js";
import { isMainModule } from "../runtime/is-main.js";
import { registerCompactSession } from "./tools/compact-session.js";
import { registerExplainMemory } from "./tools/explain-memory.js";
import { registerExplainRetrieval } from "./tools/explain-retrieval.js";
import { registerForgetMemory } from "./tools/forget-memory.js";
import { registerGetArtifactState } from "./tools/get-artifact-state.js";
import { registerGetOpenLoops } from "./tools/get-open-loops.js";
import { registerGetProjectState } from "./tools/get-project-state.js";
import { registerGetRecentEvents } from "./tools/get-recent-events.js";
import { registerGetWorkingContext } from "./tools/get-working-context.js";
import { registerMarkStale } from "./tools/mark-stale.js";
import { registerOpenLoopTools } from "./tools/open-loop-tools.js";
import { registerPreviewContextBrief } from "./tools/preview-context-brief.js";
import { registerQuarantineMemory } from "./tools/quarantine-memory.js";
import { registerRecordDecision } from "./tools/record-decision.js";
import { registerRecordPreference } from "./tools/record-preference.js";
import { registerReconcileConflicts } from "./tools/reconcile-conflicts.js";
import { registerResolveConflict } from "./tools/resolve-conflict.js";
import { registerSearchMemories } from "./tools/search-memories.js";
import { registerSuggestAgentsMdUpdate } from "./tools/suggest-agents-md-update.js";
import { registerHealthStatus } from "./tools/health-status.js";
import { registerSummarizeToolOutput } from "./tools/summarize-tool-output.js";
import { registerAdaptiveAgentGuidanceTools } from "./tools/adaptive-agent-guidance.js";

export function buildServer(service: CcmService): McpServer {
  const server = new McpServer({
    name: "cognitive-context-manager",
    version: "0.3.4"
  });

  registerGetWorkingContext(server, service);
  registerSearchMemories(server, service);
  registerExplainRetrieval(server, service);
  registerPreviewContextBrief(server, service);
  registerGetProjectState(server, service);
  registerGetOpenLoops(server, service);
  registerGetRecentEvents(server, service);
  registerGetArtifactState(server, service);
  registerRecordDecision(server, service);
  registerRecordPreference(server, service);
  registerOpenLoopTools(server, service);
  registerMarkStale(server, service);
  registerResolveConflict(server, service);
  registerReconcileConflicts(server, service);
  registerCompactSession(server, service);
  registerExplainMemory(server, service);
  registerForgetMemory(server, service);
  registerQuarantineMemory(server, service);
  registerSuggestAgentsMdUpdate(server, service);
  registerHealthStatus(server, service);
  registerSummarizeToolOutput(server);
  registerAdaptiveAgentGuidanceTools(server, service);

  return server;
}

async function main(): Promise<void> {
  const context = openDb(process.cwd());
  const service = new CcmService({ db: context.db, repoPath: process.cwd() });
  const server = buildServer(service);
  const transport = new StdioServerTransport();

  process.on("exit", () => {
    context.db.close();
  });

  await server.connect(transport);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    log("error", "MCP server failed", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
