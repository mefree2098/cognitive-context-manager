import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { CcmConfig } from "../types/config.js";
import { MemoriesRepo } from "../storage/repositories/memories-repo.js";
import { nowIso } from "../storage/repositories/row-utils.js";
import { redactSecrets } from "./secret-redactor.js";

export class SyncService {
  constructor(
    private readonly db: Database.Database,
    private readonly config: CcmConfig
  ) {}

  init(): { deviceId: string; keyPath: string; directory: string } {
    const home = this.config.storage.home;
    const keyDir = join(home, "keys");
    mkdirSync(keyDir, { recursive: true });
    const keyPath = join(keyDir, "sync.key");
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString("base64"), { mode: 0o600 });
    const devicePath = join(keyDir, "device-id");
    if (!existsSync(devicePath)) writeFileSync(devicePath, `device_${nanoid(16)}`, "utf8");
    const directory = this.syncDirectory();
    mkdirSync(directory, { recursive: true });
    return { deviceId: readFileSync(devicePath, "utf8"), keyPath, directory };
  }

  status() {
    const init = this.init();
    const records = Number((this.db.prepare("SELECT COUNT(*) AS count FROM sync_records").get() as { count: number }).count);
    return {
      enabled: this.config.sync.enabled,
      mode: this.config.sync.mode,
      encrypted: this.config.sync.encrypt,
      directory: init.directory,
      deviceId: init.deviceId,
      records
    };
  }

  push(projectId?: string): { path: string; records: number; encrypted: boolean } {
    const init = this.init();
    const memories = new MemoriesRepo(this.db).list(100000, projectId).filter((memory) => !memory.tags.some((tag) => tag.startsWith("redacted:")));
    const payload = {
      exportedAt: nowIso(),
      deviceId: init.deviceId,
      projectId,
      memories: memories.map((memory) => ({
        ...memory,
        content: redactSecrets(memory.content).text,
        summary: memory.summary ? redactSecrets(memory.summary).text : memory.summary
      }))
    };
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const bundle = this.config.sync.encrypt ? encrypt(plaintext, this.key()) : plaintext.toString("base64");
    const path = join(init.directory, `ccm-sync-${projectId ?? "all"}.bundle`);
    writeFileSync(path, JSON.stringify({ encrypted: this.config.sync.encrypt, bundle }, null, 2), "utf8");
    this.db
      .prepare(
        `INSERT INTO sync_records(sync_id, record_type, record_id, version, device_id, project_id, updated_at, deleted, encrypted_payload, hash)
         VALUES (?, 'bundle', ?, 1, ?, ?, ?, 0, ?, ?)`
      )
      .run(`sync_${nanoid(12)}`, projectId ?? "all", init.deviceId, projectId, nowIso(), bundle, sha256(bundle));
    return { path, records: memories.length, encrypted: this.config.sync.encrypt };
  }

  pull(path?: string): { imported: number; path: string } {
    const init = this.init();
    const bundlePath = path ?? join(init.directory, "ccm-sync-all.bundle");
    const wrapper = JSON.parse(readFileSync(bundlePath, "utf8")) as { encrypted: boolean; bundle: string };
    const plaintext = wrapper.encrypted ? decrypt(wrapper.bundle, this.key()).toString("utf8") : Buffer.from(wrapper.bundle, "base64").toString("utf8");
    const parsed = JSON.parse(plaintext) as { memories?: Array<{ id: string; memoryType: any; content: string }> };
    const repo = new MemoriesRepo(this.db);
    let imported = 0;
    for (const memory of parsed.memories ?? []) {
      if (repo.get(memory.id)) continue;
      repo.create(memory as any);
      imported += 1;
    }
    return { imported, path: bundlePath };
  }

  disable(): void {
    this.db
      .prepare("INSERT OR REPLACE INTO settings(key, value_json, updated_at) VALUES ('sync_disabled_at', ?, ?)")
      .run(JSON.stringify(nowIso()), nowIso());
  }

  private key(): Buffer {
    const init = this.init();
    return Buffer.from(readFileSync(init.keyPath, "utf8"), "base64");
  }

  private syncDirectory(): string {
    return this.config.sync.directory || join(this.config.storage.home, "sync");
  }
}

function encrypt(input: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(input: string, key: Buffer): Buffer {
  const bytes = Buffer.from(input, "base64");
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const encrypted = bytes.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
