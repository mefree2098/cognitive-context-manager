import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { SyncService } from "../../core/sync-service.js";
import { openDb } from "../../storage/db.js";

export function registerKeysCommand(program: Command): void {
  const keys = program.command("keys").description("Local sync encryption key commands");
  keys.command("status").action(() => {
    const context = openDb(process.cwd());
    try {
      const init = new SyncService(context.db, loadConfig(process.cwd())).init();
      console.log(JSON.stringify({ keyPath: init.keyPath, exists: existsSync(init.keyPath), deviceId: init.deviceId }, null, 2));
    } finally {
      context.db.close();
    }
  });
  keys.command("rotate").action(() => {
    const context = openDb(process.cwd());
    try {
      const service = new SyncService(context.db, loadConfig(process.cwd()));
      const before = service.init();
      const old = readFileSync(before.keyPath, "utf8").slice(0, 8);
      writeFileSync(before.keyPath, randomBytes(32).toString("base64"), { mode: 0o600 });
      console.log(JSON.stringify({ rotated: true, keyPath: before.keyPath, previousFingerprint: old, note: "Existing sync bundles should be pushed again after rotation." }, null, 2));
    } finally {
      context.db.close();
    }
  });
}
