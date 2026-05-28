import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { REAL_PASSIVE_HOOK_WHERE } from "../../core/hook-diagnostics.js";
import { hookAttemptStats } from "../../core/hook-attempt-log.js";
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

function installedPluginRoot(): string | undefined {
  const cacheRoot = join(homedir(), ".codex", "plugins", "cache", "local", "cognitive-context-manager");
  if (!existsSync(cacheRoot)) return undefined;
  const versions = readdirSync(cacheRoot)
    .map((name) => join(cacheRoot, name))
    .filter((path) => existsSync(join(path, ".codex-plugin", "plugin.json")))
    .sort();
  return versions.at(-1);
}

function checkInstalledHookManifest(): Check {
  const cacheRoot = join(homedir(), ".codex", "plugins", "cache", "local", "cognitive-context-manager");
  if (!existsSync(cacheRoot)) {
    return warning("Codex plugin cache hook manifest", "No installed local cache copy found yet; source hook manifests were checked instead.");
  }
  const latest = installedPluginRoot();
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

function checkHookCacheFingerprints(root: string): Check {
  const latest = installedPluginRoot();
  if (!latest) {
    return warning("Hook cache fingerprints", "No installed plugin cache copy found; cannot compare source and cache fingerprints.");
  }
  const pairs = [
    { label: "hooks.json", source: join(root, "hooks.json"), cache: join(latest, "hooks.json") },
    { label: "hooks/hooks.json", source: join(root, "hooks", "hooks.json"), cache: join(latest, "hooks", "hooks.json") },
    { label: "dist/hooks/hook-entry.js", source: join(root, "dist", "hooks", "hook-entry.js"), cache: join(latest, "dist", "hooks", "hook-entry.js") }
  ];
  const details = pairs.map((pair) => {
    const source = fileFingerprint(pair.source);
    const cache = fileFingerprint(pair.cache);
    const match = source.sha256 && cache.sha256 && source.sha256 === cache.sha256;
    return `${pair.label}: source ${renderFingerprint(source)}; cache ${renderFingerprint(cache)}; ${match ? "match" : "mismatch"}`;
  });
  const mismatches = details.filter((detail) => detail.endsWith("mismatch")).length;
  return {
    name: "Hook cache fingerprints",
    ok: true,
    level: mismatches ? "warn" : "pass",
    detail: details.join(" | ")
  };
}

function fileFingerprint(path: string): { exists: boolean; size?: number; mtime?: string; sha256?: string } {
  if (!existsSync(path)) return { exists: false };
  const stat = statSync(path);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
  return {
    exists: true,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256
  };
}

function renderFingerprint(input: { exists: boolean; size?: number; mtime?: string; sha256?: string }): string {
  if (!input.exists) return "missing";
  return `sha256=${input.sha256} size=${input.size} mtime=${input.mtime}`;
}

function checkHookCaptureRecency(db: ReturnType<typeof openDb>["db"]): Check {
  const row = db
    .prepare(`SELECT created_at FROM trace_entries WHERE ${REAL_PASSIVE_HOOK_WHERE} ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at?: string } | undefined;
  if (!row?.created_at) {
    return warning("Passive hook capture recency", "No passive hook trace has been recorded yet; reports will show explicit MCP only until Codex fires hooks.");
  }
  const ageHours = Math.round(((Date.now() - new Date(row.created_at).getTime()) / (60 * 60 * 1000)) * 10) / 10;
  if (ageHours > 48) {
    return warning("Passive hook capture recency", `Latest passive hook trace is stale: ${row.created_at} (${ageHours}h old).`);
  }
  return { name: "Passive hook capture recency", ok: true, level: "pass", detail: `Latest passive hook trace: ${row.created_at} (${ageHours}h old)` };
}

function checkPassiveHookWatchdog(db: ReturnType<typeof openDb>["db"]): Check {
  const latestExplicitMcpAt = latestExplicitMcpRecordAt(db);
  if (!latestExplicitMcpAt) {
    return { name: "Passive hook watchdog", ok: true, level: "pass", detail: "No explicit MCP activity found; no hook comparison needed." };
  }
  const latestHook = db
    .prepare(`SELECT created_at FROM trace_entries WHERE ${REAL_PASSIVE_HOOK_WHERE} ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at?: string } | undefined;
  const explicitAgeHours = Math.round(((Date.now() - new Date(latestExplicitMcpAt).getTime()) / (60 * 60 * 1000)) * 10) / 10;
  const hookAgeHours = latestHook?.created_at
    ? Math.round(((Date.now() - new Date(latestHook.created_at).getTime()) / (60 * 60 * 1000)) * 10) / 10
    : undefined;
  if (explicitAgeHours <= 48 && (hookAgeHours === undefined || hookAgeHours > 48)) {
    return warning(
      "Passive hook watchdog",
      `Explicit MCP is active (${explicitAgeHours}h old), but no recent real passive hook trace was recorded${hookAgeHours === undefined ? "" : ` (${hookAgeHours}h old)`}.`
    );
  }
  return {
    name: "Passive hook watchdog",
    ok: true,
    level: "pass",
    detail: `Latest explicit MCP: ${latestExplicitMcpAt}; latest real hook: ${latestHook?.created_at ?? "none detected"}`
  };
}

function checkHookAttemptLog(cwd: string, name = "Hook attempt fallback log"): Check {
  const stats = hookAttemptStats(loadConfig(cwd).storage.home);
  if (stats.status === "real_attempts_seen") {
    return {
      name,
      ok: true,
      level: "pass",
      detail: `${stats.realEntries} real hook attempt log entries; latest real attempt ${stats.latestRealAt} (${stats.latestRealStage}). Log: ${stats.path}`
    };
  }
  if (stats.status === "self_test_only") {
    return warning(name, `${stats.selfTestEntries} self-test hook attempt entries but no real Codex-fired attempts yet. Log: ${stats.path}`);
  }
  return warning(name, `No hook attempts have been written yet. Log will appear at ${stats.path} when the hook entrypoint starts.`);
}

async function checkHookSelfTest(cwd: string, mode: "source" | "installed"): Promise<Check> {
  const codexSessionId = `ccm-doctor-self-test-${Date.now()}`;
  try {
    const payload = {
      cwd,
      sessionId: codexSessionId,
      prompt: "CCM doctor hook self-test: verify the hook entrypoint can record a hook trace.",
      ccmSelfTest: true,
      ccmSelfTestMode: mode
    };
    if (mode === "source") {
      const { runHook } = await import("../../hooks/hook-entry.js");
      await runHook("UserPromptSubmit", payload);
    } else {
      const latest = installedPluginRoot();
      if (!latest) return { name: "Installed hook entrypoint self-test", ok: false, level: "fail", detail: "No installed plugin cache copy found." };
      const hookEntry = join(latest, "dist", "hooks", "hook-entry.js");
      if (!existsSync(hookEntry)) return { name: "Installed hook entrypoint self-test", ok: false, level: "fail", detail: `${hookEntry} not found.` };
      execFileSync(process.execPath, [hookEntry, "UserPromptSubmit"], {
        cwd: latest,
        input: JSON.stringify(payload),
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });
    }
    const context = openDb(cwd);
    try {
      const row = context.db
        .prepare(
          `SELECT t.created_at
           FROM trace_entries t
           JOIN sessions s ON s.id = t.session_id
           WHERE t.trace_type = 'hook'
             AND s.codex_session_id = ?
             AND COALESCE(json_extract(t.payload_json, '$.selfTest'), 0) = 1
           ORDER BY t.created_at DESC LIMIT 1`
        )
        .get(codexSessionId) as { created_at?: string } | undefined;
      return row?.created_at
        ? { name: mode === "source" ? "Hook entrypoint self-test" : "Installed hook entrypoint self-test", ok: true, level: "pass", detail: `Recorded self-test hook trace at ${row.created_at}` }
        : { name: mode === "source" ? "Hook entrypoint self-test" : "Installed hook entrypoint self-test", ok: false, level: "fail", detail: "No self-test hook trace was recorded." };
    } finally {
      context.db.close();
    }
  } catch (error) {
    return { name: mode === "source" ? "Hook entrypoint self-test" : "Installed hook entrypoint self-test", ok: false, level: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}

function latestExplicitMcpRecordAt(db: ReturnType<typeof openDb>["db"]): string | undefined {
  const row = db
    .prepare(
      `SELECT MAX(created_at) AS latest FROM (
         SELECT created_at FROM events WHERE source_refs_json LIKE '%record_decision%' OR source_refs_json LIKE '%compact_session%' OR source_refs_json LIKE '%get_working_context%' OR source_refs_json LIKE '%get_effectiveness_report%'
         UNION ALL
         SELECT created_at FROM memories WHERE source_refs_json LIKE '%record_decision%' OR source_refs_json LIKE '%compact_session%' OR source_refs_json LIKE '%get_working_context%' OR source_refs_json LIKE '%get_effectiveness_report%'
       )`
    )
    .get() as { latest?: string } | undefined;
  return row?.latest;
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
    checks.push(checkHookCacheFingerprints(root));
    checks.push(checkHookCaptureRecency(context.db));
    checks.push(checkPassiveHookWatchdog(context.db));
    checks.push(checkHookAttemptLog(cwd));
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

export async function runDoctorWithOptions(cwd = process.cwd(), options: { hookSelfTest?: boolean; installedHookSelfTest?: boolean } = {}): Promise<Check[]> {
  const checks = runDoctor(cwd);
  if (options.hookSelfTest) checks.push(await checkHookSelfTest(cwd, "source"));
  if (options.installedHookSelfTest) checks.push(await checkHookSelfTest(cwd, "installed"));
  if (options.hookSelfTest || options.installedHookSelfTest) checks.push(checkHookAttemptLog(cwd, "Hook attempt fallback log after self-test"));
  return checks;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check plugin, storage, hook, MCP, and redaction readiness")
    .option("--json", "Print JSON")
    .option("--hook-self-test", "Run the local hook entrypoint once and verify it records a self-test trace")
    .option("--installed-hook-self-test", "Run the installed plugin-cache hook entrypoint once and verify it records a self-test trace")
    .action(async (options: { json?: boolean; hookSelfTest?: boolean; installedHookSelfTest?: boolean }) => {
      const checks = await runDoctorWithOptions(process.cwd(), { hookSelfTest: options.hookSelfTest, installedHookSelfTest: options.installedHookSelfTest });
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
