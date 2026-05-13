import BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDatabasePath, loadConfig } from "../config/load-config.js";
import type { CcmConfig } from "../types/config.js";
import { runMigrations } from "./migrations.js";

export interface DbContext {
  db: BetterSqlite3.Database;
  config: CcmConfig;
  path: string;
}

export function openDb(repoPath = process.cwd()): DbContext {
  const config = loadConfig(repoPath);
  const path = getDatabasePath(config);
  mkdirSync(dirname(path), { recursive: true });
  const db = new BetterSqlite3(path);
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return { db, config, path };
}

export function withDb<T>(fn: (context: DbContext) => T, repoPath = process.cwd()): T {
  const context = openDb(repoPath);
  try {
    return fn(context);
  } finally {
    context.db.close();
  }
}

export function assertFtsAvailable(db: BetterSqlite3.Database): boolean {
  try {
    db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1").all("ccm_no_match_token");
    return true;
  } catch {
    return false;
  }
}
