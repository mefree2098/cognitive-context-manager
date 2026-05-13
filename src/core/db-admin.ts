import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type Database from "better-sqlite3";
import { getDatabasePath, loadConfig } from "../config/load-config.js";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "../storage/migrations.js";
import { nowIso } from "../storage/repositories/row-utils.js";
import { assertFtsAvailable } from "../storage/db.js";

export function schemaStatus(db: Database.Database) {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'schema_version'").get() as
    | { value_json: string }
    | undefined;
  const current = row ? Number(JSON.parse(row.value_json)) : 0;
  return {
    current,
    expected: CURRENT_SCHEMA_VERSION,
    ok: current === CURRENT_SCHEMA_VERSION,
    fts: assertFtsAvailable(db)
  };
}

export function migrate(db: Database.Database): ReturnType<typeof schemaStatus> {
  runMigrations(db);
  return schemaStatus(db);
}

export function backupDatabase(repoPath = process.cwd()): string {
  const config = loadConfig(repoPath);
  const databasePath = getDatabasePath(config);
  mkdirSync(join(config.storage.home, "backups"), { recursive: true });
  const out = join(config.storage.home, "backups", `ccm-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  if (existsSync(databasePath)) copyFileSync(databasePath, out);
  return out;
}

export function rollbackDatabase(to: string, repoPath = process.cwd()): string {
  const config = loadConfig(repoPath);
  const databasePath = getDatabasePath(config);
  const backupDir = join(config.storage.home, "backups");
  const candidate = to.endsWith(".sqlite")
    ? to
    : join(backupDir, readdirSync(backupDir).filter((name) => name.includes(to)).sort().at(-1) ?? "");
  if (!candidate || !existsSync(candidate)) throw new Error(`Backup not found for rollback target: ${to}`);
  const before = backupDatabase(repoPath);
  copyFileSync(candidate, databasePath);
  return `Rolled back ${basename(databasePath)} using ${candidate}; pre-rollback backup: ${before}`;
}

export function verifyDatabase(db: Database.Database) {
  const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  const quick = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
  const counts = {
    memories: Number((db.prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number }).count),
    events: Number((db.prepare("SELECT COUNT(*) AS count FROM events").get() as { count: number }).count),
    openLoops: Number((db.prepare("SELECT COUNT(*) AS count FROM open_loops").get() as { count: number }).count)
  };
  return {
    ok: integrity.integrity_check === "ok" && quick.quick_check === "ok",
    integrity: integrity.integrity_check,
    quick: quick.quick_check,
    counts
  };
}

export function repairDatabase(db: Database.Database): string[] {
  const actions: string[] = [];
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
  actions.push("rebuilt memories_fts");
  db.exec("INSERT INTO events_fts(events_fts) VALUES('rebuild')");
  actions.push("rebuilt events_fts");
  db.exec("INSERT INTO open_loops_fts(open_loops_fts) VALUES('rebuild')");
  actions.push("rebuilt open_loops_fts");
  db.prepare("INSERT OR REPLACE INTO settings(key, value_json, updated_at) VALUES ('last_repair', ?, ?)").run(
    JSON.stringify(actions),
    nowIso()
  );
  return actions;
}

export function pruneOldBackups(repoPath = process.cwd(), keep = 20): number {
  const config = loadConfig(repoPath);
  const backupDir = join(config.storage.home, "backups");
  if (!existsSync(backupDir)) return 0;
  const files = readdirSync(backupDir)
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => ({ name, time: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .slice(keep);
  for (const file of files) unlinkSync(join(backupDir, file.name));
  return files.length;
}
