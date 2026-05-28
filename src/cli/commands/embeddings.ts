import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Command } from "commander";
import { getUserConfigPath, loadConfig } from "../../config/load-config.js";
import { EmbeddingService } from "../../core/embedding-provider.js";
import { openDb } from "../../storage/db.js";
import type { CcmConfig } from "../../types/config.js";

export function registerEmbeddingsCommand(program: Command): void {
  const embeddings = program.command("embeddings").description("Embedding queue and hybrid retrieval commands");
  embeddings.command("status").action(() => withEmbeddings((service) => console.log(JSON.stringify(service.status(), null, 2))));
  embeddings.command("backfill").option("--limit <limit>", "Limit", "1000").action((options: { limit: string }) => withEmbeddings((service) => console.log(JSON.stringify({ queued: service.backfill(Number(options.limit)) }, null, 2))));
  embeddings.command("process").option("--limit <limit>", "Limit", "100").action(async (options: { limit: string }) => withEmbeddingsAsync((service) => service.process(Number(options.limit))));
  embeddings.command("rebuild").action(async () => withEmbeddingsAsync((service) => service.rebuild()));
  embeddings
    .command("enable")
    .description("Enable embeddings in the user CCM config")
    .option("--provider <provider>", "Provider: openai, local, lmstudio, or custom", "openai")
    .option("--auth <mode>", "OpenAI auth mode: codex, env, or auto", "codex")
    .action((options: { provider: string; auth: string }) => {
      const provider = embeddingProvider(options.provider);
      const authMode = openAiAuthMode(options.auth);
      const patch: Partial<CcmConfig> = {
        embeddings: {
          ...loadConfig(process.cwd()).embeddings,
          enabled: true,
          provider,
          fallbackProvider: provider === "openai" ? "local" : "none",
          openai: { ...loadConfig(process.cwd()).embeddings.openai, authMode }
        },
        retrieval: { ...loadConfig(process.cwd()).retrieval, mode: "hybrid" },
        privacy: { ...loadConfig(process.cwd()).privacy, allowCloudEmbeddings: provider === "openai" || loadConfig(process.cwd()).privacy.allowCloudEmbeddings }
      };
      writeUserConfig(patch);
      console.log(`Embeddings enabled with provider=${provider}${provider === "openai" ? ` auth=${authMode}` : ""}.`);
    });
  embeddings.command("disable").action(() => {
    writeUserConfig({
      embeddings: { ...loadConfig(process.cwd()).embeddings, enabled: false, provider: "none" },
      retrieval: { ...loadConfig(process.cwd()).retrieval, mode: "fts" }
    });
    console.log("Embeddings disabled. CCM will use SQLite FTS-only retrieval.");
  });
}

function writeUserConfig(patch: Partial<CcmConfig>): void {
  const configPath = getUserConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  const current = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) as Partial<CcmConfig> : {};
  const next = mergePlain(current, patch);
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function mergePlain<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = output[key];
    output[key] = isPlainObject(existing) && isPlainObject(value) ? mergePlain(existing, value) : value;
  }
  return output as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function embeddingProvider(value: string): CcmConfig["embeddings"]["provider"] {
  if (value === "openai" || value === "local" || value === "lmstudio" || value === "custom") return value;
  throw new Error(`Unsupported embedding provider: ${value}`);
}

function openAiAuthMode(value: string): CcmConfig["embeddings"]["openai"]["authMode"] {
  if (value === "codex" || value === "env" || value === "auto") return value;
  throw new Error(`Unsupported OpenAI auth mode: ${value}`);
}

function withEmbeddings(fn: (service: EmbeddingService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new EmbeddingService(context.db, loadConfig(process.cwd())));
  } finally {
    context.db.close();
  }
}

async function withEmbeddingsAsync(fn: (service: EmbeddingService) => Promise<unknown>): Promise<void> {
  const context = openDb(process.cwd());
  try {
    console.log(JSON.stringify(await fn(new EmbeddingService(context.db, loadConfig(process.cwd()))), null, 2));
  } finally {
    context.db.close();
  }
}
