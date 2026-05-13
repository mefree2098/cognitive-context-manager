import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { containsSecret, redactSecrets } from "../../core/secret-redactor.js";
import { assertFtsAvailable, openDb } from "../../storage/db.js";
import { schemaStatus } from "../../core/db-admin.js";
import { loadConfig } from "../../config/load-config.js";
import { EmbeddingService } from "../../core/embedding-provider.js";
import { DaemonService } from "../../core/daemon-service.js";
import { AdaptiveAgentGuidanceService } from "../../core/adaptive-agents.js";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

function checkJson(path: string): Check {
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return { name: `JSON ${path}`, ok: true };
  } catch (error) {
    return { name: `JSON ${path}`, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function runDoctor(cwd = process.cwd()): Check[] {
  const root = resolve(cwd);
  const context = openDb(cwd);
  const checks: Check[] = [];
  try {
    checks.push({
      name: "Node version",
      ok: Number(process.versions.node.split(".")[0]) >= 20,
      detail: process.versions.node
    });
    checks.push({ name: "Database opens", ok: true, detail: context.path });
    checks.push({ name: "SQLite FTS5", ok: assertFtsAvailable(context.db) });
    const schema = schemaStatus(context.db);
    checks.push({ name: "Schema version", ok: schema.ok, detail: `${schema.current}/${schema.expected}` });
    checks.push(checkJson(join(root, ".codex-plugin", "plugin.json")));
    checks.push(checkJson(join(root, ".mcp.json")));
    checks.push(checkJson(join(root, "hooks", "hooks.json")));
    checks.push({
      name: "MCP build output",
      ok: existsSync(join(root, "dist", "mcp", "server.js")),
      detail: "Run npm run build if missing"
    });
    checks.push({
      name: "Hook build output",
      ok: existsSync(join(root, "dist", "hooks", "hook-entry.js")),
      detail: "Run npm run build if missing"
    });
    checks.push({
      name: "Secret redactor",
      ok: containsSecret("OPENAI_API_KEY=sk-test1234567890abcdefghijklmnop") &&
        redactSecrets("OPENAI_API_KEY=sk-test1234567890abcdefghijklmnop").text.includes("[REDACTED_")
    });
    const config = loadConfig(cwd);
    const embedding = new EmbeddingService(context.db, config).status();
    checks.push({ name: "Embedding fallback", ok: !embedding.enabled || embedding.provider !== "none", detail: JSON.stringify(embedding) });
    const daemon = new DaemonService(context.db, config).status();
    checks.push({ name: "Daemon optional", ok: !daemon.enabled || daemon.running || daemon.embeddingQueued >= 0, detail: JSON.stringify({ enabled: daemon.enabled, running: daemon.running }) });
    const adaptive = new AdaptiveAgentGuidanceService(context.db, config);
    adaptive.ensureFiles();
    checks.push({ name: "Adaptive guidance", ok: existsSync(adaptive.guidancePath()), detail: adaptive.guidancePath() });
    return checks;
  } finally {
    context.db.close();
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check plugin, storage, hook, MCP, and redaction readiness")
    .option("--json", "Print JSON")
    .action((options: { json?: boolean }) => {
      const checks = runDoctor(process.cwd());
      if (options.json) {
        console.log(JSON.stringify({ ok: checks.every((check) => check.ok), checks }, null, 2));
        process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
        return;
      }
      for (const check of checks) {
        console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
      }
      process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
    });
}
