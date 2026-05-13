import type Database from "better-sqlite3";
import { json, nowIso, parseJson, Row } from "./row-utils.js";

export class SettingsRepo {
  constructor(private readonly db: Database.Database) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? parseJson<T>(row.value_json, fallback) : fallback;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, json(value), nowIso());
  }
}
