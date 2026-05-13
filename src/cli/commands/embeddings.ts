import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { EmbeddingService } from "../../core/embedding-provider.js";
import { openDb } from "../../storage/db.js";

export function registerEmbeddingsCommand(program: Command): void {
  const embeddings = program.command("embeddings").description("Optional embedding queue and hybrid retrieval commands");
  embeddings.command("status").action(() => withEmbeddings((service) => console.log(JSON.stringify(service.status(), null, 2))));
  embeddings.command("backfill").option("--limit <limit>", "Limit", "1000").action((options: { limit: string }) => withEmbeddings((service) => console.log(JSON.stringify({ queued: service.backfill(Number(options.limit)) }, null, 2))));
  embeddings.command("process").option("--limit <limit>", "Limit", "100").action(async (options: { limit: string }) => withEmbeddingsAsync((service) => service.process(Number(options.limit))));
  embeddings.command("rebuild").action(async () => withEmbeddingsAsync((service) => service.rebuild()));
  embeddings.command("disable").action(() => {
    console.log("Embeddings are disabled by default. Set embeddings.enabled=false in config to keep FTS-only fallback mode.");
  });
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
