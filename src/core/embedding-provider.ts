import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { CcmConfig } from "../types/config.js";
import type { Memory } from "../types/memory.js";
import { MemoriesRepo } from "../storage/repositories/memories-repo.js";
import { nowIso, Row } from "../storage/repositories/row-utils.js";
import { resolveOpenAiCredential, type OpenAiCredentialSource } from "./openai-auth.js";
import { redactSecrets } from "./secret-redactor.js";

export interface EmbeddingProvider {
  id: string;
  displayName: string;
  dimensions: number;
  authSource?: OpenAiCredentialSource;
  fallbackReason?: string;
  availabilityStatus?: "available" | "disabled" | "missing_auth" | "missing_url";
  isAvailable(): Promise<boolean>;
  embedText(input: string): Promise<number[]>;
  embedBatch(inputs: string[]): Promise<number[][]>;
}

export class NoneEmbeddingProvider implements EmbeddingProvider {
  id = "none";
  displayName = "Disabled";
  dimensions = 0;
  availabilityStatus: EmbeddingProvider["availabilityStatus"] = "disabled";
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async embedText(_input: string): Promise<number[]> {
    return [];
  }
  async embedBatch(inputs: string[]): Promise<number[][]> {
    return inputs.map(() => []);
  }
}

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  id = "local";
  displayName = "Local deterministic hashing";
  dimensions: number;
  authSource?: OpenAiCredentialSource;
  fallbackReason?: string;
  availabilityStatus: EmbeddingProvider["availabilityStatus"] = "available";

  constructor(dimensions = 128) {
    this.dimensions = dimensions;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embedText(input: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = input.toLowerCase().split(/\W+/).filter(Boolean);
    for (const token of tokens) {
      const hash = createHash("sha256").update(token).digest();
      const index = hash.readUInt16BE(0) % this.dimensions;
      const sign = hash[2] % 2 === 0 ? 1 : -1;
      vector[index] += sign;
    }
    return normalize(vector);
  }

  async embedBatch(inputs: string[]): Promise<number[][]> {
    return Promise.all(inputs.map((input) => this.embedText(input)));
  }
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  id: string;
  displayName: string;
  dimensions: number;

  constructor(
    id: string,
    displayName: string,
    private readonly url: string,
    private readonly model: string,
    private readonly apiKey?: string,
    dimensions = 1536,
    readonly authSource?: OpenAiCredentialSource,
    readonly fallbackReason?: string
  ) {
    this.id = id;
    this.displayName = displayName;
    this.dimensions = dimensions;
  }

  async isAvailable(): Promise<boolean> {
    return this.availabilityStatus === "available";
  }

  get availabilityStatus(): EmbeddingProvider["availabilityStatus"] {
    if (!this.url) return "missing_url";
    if (this.id.includes("openai") && !this.apiKey) return "missing_auth";
    return "available";
  }

  async embedText(input: string): Promise<number[]> {
    return (await this.embedBatch([input]))[0] ?? [];
  }

  async embedBatch(inputs: string[]): Promise<number[][]> {
    const response = await fetch(this.url.replace(/\/$/, "") + "/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({ model: this.model, input: inputs })
    });
    if (!response.ok) throw new Error(`Embedding provider ${this.id} failed: ${response.status}`);
    const json = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    return (json.data ?? []).map((item) => item.embedding ?? []);
  }
}

export function getEmbeddingProvider(config: CcmConfig): EmbeddingProvider {
  if (!config.embeddings.enabled || config.embeddings.provider === "none") return new NoneEmbeddingProvider();
  if (config.embeddings.provider === "local") return new LocalHashEmbeddingProvider(config.embeddings.dimensions || 128);
  if (config.embeddings.provider === "lmstudio") {
    return new HttpEmbeddingProvider(
      "lmstudio",
      "LM Studio",
      config.embeddings.lmstudio.baseUrl,
      config.embeddings.lmstudio.model || config.embeddings.model,
      undefined,
      config.embeddings.dimensions || 1024
    );
  }
  if (config.embeddings.provider === "openai") {
    if (!config.privacy.allowCloudEmbeddings) {
      return embeddingFallback(config, "Cloud embeddings are disabled by privacy.allowCloudEmbeddings=false.");
    }
    const credential = resolveOpenAiCredential(config.embeddings.openai);
    if (!credential.token) return embeddingFallback(config, credential.unavailableReason ?? "No OpenAI credential was available.");
    return new HttpEmbeddingProvider(
      "openai",
      "OpenAI",
      "https://api.openai.com/v1",
      config.embeddings.openai.model,
      credential.token,
      config.embeddings.dimensions || 1536,
      credential.source,
      undefined
    );
  }
  return new HttpEmbeddingProvider(
    "custom",
    "Custom HTTP embeddings",
    config.embeddings.custom.url,
    config.embeddings.custom.model || config.embeddings.model,
    config.embeddings.custom.apiKeyEnv ? process.env[config.embeddings.custom.apiKeyEnv] : undefined,
    config.embeddings.custom.dimensions || config.embeddings.dimensions || 768
  );
}

function embeddingFallback(config: CcmConfig, reason: string): EmbeddingProvider {
  if (config.embeddings.fallbackProvider === "local") {
    const provider = new LocalHashEmbeddingProvider(384);
    provider.fallbackReason = reason;
    return provider;
  }
  return new HttpEmbeddingProvider(
    "openai",
    "OpenAI",
    "https://api.openai.com/v1",
    config.embeddings.openai.model,
    undefined,
    config.embeddings.dimensions || 1536,
    "none",
    reason
  );
}

export function packVector(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

export function unpackVector(buffer: Buffer): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += 4) values.push(buffer.readFloatLE(offset));
  return values;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aMag += a[index] ** 2;
    bMag += b[index] ** 2;
  }
  return aMag && bMag ? dot / (Math.sqrt(aMag) * Math.sqrt(bMag)) : 0;
}

export function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

export function hashEmbeddingInput(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class EmbeddingService {
  constructor(
    private readonly db: Database.Database,
    private readonly config: CcmConfig
  ) {}

  status() {
    const queued = Number((this.db.prepare("SELECT COUNT(*) AS count FROM embedding_jobs WHERE status = 'queued'").get() as { count: number }).count);
    const failed = Number((this.db.prepare("SELECT COUNT(*) AS count FROM embedding_jobs WHERE status = 'failed'").get() as { count: number }).count);
    const embedded = Number((this.db.prepare("SELECT COUNT(*) AS count FROM embeddings").get() as { count: number }).count);
    const provider = getEmbeddingProvider(this.config);
    return {
      enabled: this.config.embeddings.enabled,
      configuredProvider: this.config.embeddings.provider,
      provider: provider.id,
      displayName: provider.displayName,
      dimensions: provider.dimensions,
      model: this.providerModel(provider),
      authSource: provider.authSource ?? "none",
      available: provider.availabilityStatus === "available",
      fallbackReason: provider.fallbackReason,
      queued,
      failed,
      embedded
    };
  }

  queueMemory(memoryId: string): void {
    if (!this.config.embeddings.enabled) return;
    const existing = this.db.prepare("SELECT id FROM embedding_jobs WHERE memory_id = ? AND status IN ('queued', 'running')").get(memoryId);
    if (existing) return;
    const now = nowIso();
    this.db
      .prepare("INSERT INTO embedding_jobs(id, memory_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)")
      .run(`embed_${nanoid(12)}`, memoryId, now, now);
  }

  backfill(limit = 1000): number {
    if (!this.config.embeddings.enabled) return 0;
    const rows = this.db
      .prepare(
        `SELECT m.id FROM memories m
         LEFT JOIN embeddings e ON e.memory_id = m.id
         WHERE e.id IS NULL AND m.stale_status NOT IN ('forgotten', 'tombstoned', 'quarantined')
         ORDER BY m.updated_at DESC LIMIT ?`
      )
      .all(limit) as Array<{ id: string }>;
    for (const row of rows) this.queueMemory(row.id);
    return rows.length;
  }

  async process(limit = 100): Promise<{ processed: number; failed: number; provider: string }> {
    if (!this.config.embeddings.enabled) return { processed: 0, failed: 0, provider: "none" };
    const provider = getEmbeddingProvider(this.config);
    if (!(await provider.isAvailable())) return { processed: 0, failed: 0, provider: provider.id };
    const repo = new MemoriesRepo(this.db);
    const jobs = this.db
      .prepare("SELECT * FROM embedding_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?")
      .all(limit) as Row[];
    let processed = 0;
    let failed = 0;
    for (const job of jobs) {
      const jobId = String(job.id);
      const memory = repo.get(String(job.memory_id));
      if (!memory) {
        this.markJob(jobId, "failed", "Memory missing");
        failed += 1;
        continue;
      }
      try {
        this.markJob(jobId, "running");
        await this.storeEmbedding(memory, provider);
        this.markJob(jobId, "done");
        processed += 1;
      } catch (error) {
        this.markJob(jobId, "failed", error instanceof Error ? error.message : String(error));
        failed += 1;
      }
    }
    return { processed, failed, provider: provider.id };
  }

  async rebuild(): Promise<{ queued: number }> {
    this.db.prepare("DELETE FROM embeddings").run();
    this.db.prepare("DELETE FROM embedding_jobs").run();
    return { queued: this.backfill(100000) };
  }

  async vectorSearch(query: string, projectId?: string, limit = 10): Promise<Array<Memory & { vectorScore: number }>> {
    const provider = getEmbeddingProvider(this.config);
    if (!this.config.embeddings.enabled || !(await provider.isAvailable())) return [];
    const rows = this.db
      .prepare(
        `SELECT e.vector, m.* FROM embeddings e
         JOIN memories m ON m.id = e.memory_id
         WHERE e.provider = ? AND e.model = ? ${projectId ? "AND m.project_id = ?" : ""}
         LIMIT 2000`
      )
      .all(...(projectId ? [provider.id, this.providerModel(provider), projectId] : [provider.id, this.providerModel(provider)])) as Row[];
    if (!rows.length) return [];
    const queryVector = await provider.embedText(redactSecrets(query).text);
    const repo = new MemoriesRepo(this.db);
    return rows
      .map((row) => {
        const memory = repo.get(String(row.id));
        if (!memory) return undefined;
        return { ...memory, vectorScore: cosineSimilarity(queryVector, unpackVector(row.vector as Buffer)) };
      })
      .filter((item): item is Memory & { vectorScore: number } => Boolean(item))
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, limit);
  }

  private async storeEmbedding(memory: Memory, provider: EmbeddingProvider): Promise<void> {
    const input = this.config.embeddings.redactBeforeEmbedding ? redactSecrets(memory.summary || memory.content).text : memory.summary || memory.content;
    const vector = await provider.embedText(input);
    if (!vector.length) throw new Error("Provider returned empty vector");
    const model = this.providerModel(provider);
    const inputHash = hashEmbeddingInput(input);
    this.db
      .prepare("DELETE FROM embeddings WHERE memory_id = ? AND provider = ? AND model = ?")
      .run(memory.id, provider.id, model);
    this.db
      .prepare(
        `INSERT INTO embeddings(id, memory_id, provider, model, dimensions, vector, input_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`embedding_${nanoid(12)}`, memory.id, provider.id, model, vector.length, packVector(vector), inputHash, nowIso());
  }

  private providerModel(provider: EmbeddingProvider): string {
    if (provider.id === "local") return "hashing-v1";
    return this.config.embeddings.model || this.config.embeddings.openai.model || "default";
  }

  private markJob(id: string, status: "running" | "done" | "failed", lastError?: string): void {
    this.db
      .prepare(
        `UPDATE embedding_jobs
         SET status = ?, attempts = attempts + CASE WHEN ? = 'failed' THEN 1 ELSE 0 END, last_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(status, status, lastError, nowIso(), id);
  }
}
