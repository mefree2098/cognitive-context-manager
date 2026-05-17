import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
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
  level?: "pass" | "warn" | "fail";
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

function checkCodexHooksFeature(): Check {
  const configPath = join(homedir(), ".codex", "config.toml");
  if (!existsSync(configPath)) {
    return { name: "Codex hooks feature flag", ok: false, detail: `${configPath} not found; add [features] hooks = true` };
  }
  const config = readFileSync(configPath, "utf8");
  const featuresSection = tomlSection(config, "features");
  const hasHooks = /^\s*hooks\s*=\s*true\s*$/m.test(featuresSection);
  const hasDeprecatedHooks = /^\s*codex_hooks\s*=\s*true\s*$/m.test(featuresSection);
  return {
    name: "Codex hooks feature flag",
    ok: hasHooks,
    detail: hasHooks ? `${configPath} has [features].hooks = true` : hasDeprecatedHooks ? "`codex_hooks` is deprecated; use `hooks = true`" : "Add [features] hooks = true"
  };
}

function warning(name: string, detail: string): Check {
  return { name, ok: true, level: "warn", detail };
}

function checkInstalledHookManifest(): Check {
  const cacheRoot = join(homedir(), ".codex", "plugins", "cache", "local", "cognitive-context-manager");
  if (!existsSync(cacheRoot)) {
    return warning("Codex plugin cache hook manifest", "No installed local cache copy found yet; source hook manifests were checked instead.");
  }
  const versions = readdirSync(cacheRoot)
    .map((name) => join(cacheRoot, name))
    .filter((path) => existsSync(join(path, ".codex-plugin", "plugin.json")))
    .sort();
  const latest = versions.at(-1);
  if (!latest) {
    return warning("Codex plugin cache hook manifest", `${cacheRoot} exists, but no versioned plugin cache was found.`);
  }
  const missing = ["hooks.json", join("hooks", "hooks.json"), join("dist", "hooks", "hook-entry.js")].filter((path) => !existsSync(join(latest, path)));
  return {
    name: "Codex plugin cache hook manifest",
    ok: missing.length === 0,
    level: missing.length === 0 ? "pass" : "fail",
    detail: missing.length ? `${latest} missing ${missing.join(", ")}` : `${latest} includes root hooks.json and hook build output`
  };
}

function checkHookCaptureRecency(db: ReturnType<typeof openDb>["db"]): Check {
  const row = db.prepare("SELECT created_at FROM trace_entries WHERE trace_type = 'hook' ORDER BY created_at DESC LIMIT 1").get() as { created_at?: string } | undefined;
  if (!row?.created_at) {
    return warning("Passive hook capture recency", "No passive hook trace has been recorded yet; reports will show explicit MCP only until Codex fires hooks.");
  }
  const ageHours = Math.round(((Date.now() - new Date(row.created_at).getTime()) / (60 * 60 * 1000)) * 10) / 10;
  if (ageHours > 48) {
    return warning("Passive hook capture recency", `Latest passive hook trace is stale: ${row.created_at} (${ageHours}h old).`);
  }
  return { name: "Passive hook capture recency", ok: true, level: "pass", detail: `Latest passive hook trace: ${row.created_at} (${ageHours}h old)` };
}

function tomlSection(config: string, name: string): string {
  const lines = config.split(/\r?\n/);
  const body: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1];
    if (section) {
      inSection = section === name;
      continue;
    }
    if (inSection) body.push(line);
  }
  return body.join("\n");
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
    checks.push(checkJson(join(root, "hooks.json")));
    checks.push(checkJson(join(root, "hooks", "hooks.json")));
    checks.push(checkCodexHooksFeature());
    checks.push(checkInstalledHookManifest());
    checks.push(checkHookCaptureRecency(context.db));
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
        const label = check.level === "warn" ? "WARN" : check.ok ? "PASS" : "FAIL";
        console.log(`${label} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
      }
      process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
    });
}
