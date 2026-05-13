import type Database from "better-sqlite3";

export const schemaSql = String.raw`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT,
  git_remote TEXT,
  git_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  codex_session_id TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  summary TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT,
  event_type TEXT NOT NULL,
  title TEXT,
  summary TEXT NOT NULL,
  raw_ref TEXT,
  entities_json TEXT NOT NULL DEFAULT '[]',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  salience REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.75,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  memory_type TEXT NOT NULL,
  event_type TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  entities_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  retrieval_cues_json TEXT NOT NULL DEFAULT '[]',
  salience REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.75,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  supersedes_json TEXT NOT NULL DEFAULT '[]',
  superseded_by TEXT,
  stale_status TEXT NOT NULL DEFAULT 'active',
  decay_policy TEXT NOT NULL DEFAULT 'normal',
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS open_loops (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 3,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  path TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  summary TEXT,
  last_hash TEXT,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'tracked',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(project_id) REFERENCES projects(id),
  UNIQUE(project_id, path)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  memory_a TEXT NOT NULL,
  memory_b TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved',
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  rollback_sql TEXT
);

CREATE TABLE IF NOT EXISTS trace_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  trace_type TEXT NOT NULL,
  title TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS raw_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  source_type TEXT NOT NULL,
  redacted_excerpt TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  storage_path TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  input_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(memory_id) REFERENCES memories(id)
);

CREATE TABLE IF NOT EXISTS embedding_jobs (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(memory_id) REFERENCES memories(id)
);

CREATE TABLE IF NOT EXISTS consolidation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS agents_suggestions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  reason TEXT NOT NULL,
  candidate_instruction TEXT NOT NULL,
  evidence_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  diff TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_user_review',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS sync_records (
  sync_id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  project_id TEXT,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  encrypted_payload TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  project_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS entity_edges (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_entity_id) REFERENCES entities(id),
  FOREIGN KEY(target_entity_id) REFERENCES entities(id)
);

CREATE TABLE IF NOT EXISTS memory_entities (
  memory_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY(memory_id, entity_id),
  FOREIGN KEY(memory_id) REFERENCES memories(id),
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);

CREATE TABLE IF NOT EXISTS adaptive_agent_versions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  file_path TEXT NOT NULL,
  old_hash TEXT,
  new_hash TEXT NOT NULL,
  diff TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_event_ids TEXT,
  applied_by TEXT NOT NULL,
  rollback_of TEXT
);

CREATE TABLE IF NOT EXISTS adaptive_agent_patches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  source_event_ids TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  target_file TEXT NOT NULL,
  operation TEXT NOT NULL,
  section TEXT NOT NULL,
  rule TEXT NOT NULL,
  confidence REAL NOT NULL,
  requires_review INTEGER NOT NULL DEFAULT 0,
  diff TEXT NOT NULL,
  rejection_reason TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  content,
  summary,
  tags
);

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  id UNINDEXED,
  summary,
  title
);

CREATE VIRTUAL TABLE IF NOT EXISTS open_loops_fts USING fts5(
  id UNINDEXED,
  title,
  description
);

CREATE INDEX IF NOT EXISTS idx_memories_project_status ON memories(project_id, stale_status, memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
CREATE INDEX IF NOT EXISTS idx_events_project_created ON events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_open_loops_project_status ON open_loops(project_id, status);
CREATE INDEX IF NOT EXISTS idx_artifacts_project_path ON artifacts(project_id, path);
CREATE INDEX IF NOT EXISTS idx_embeddings_memory_id ON embeddings(memory_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_provider_model ON embeddings(provider, model);
CREATE INDEX IF NOT EXISTS idx_embedding_jobs_status ON embedding_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_consolidation_jobs_status ON consolidation_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_trace_entries_project_created ON trace_entries(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_metrics_project_session ON metrics(project_id, session_id, metric_name);
CREATE INDEX IF NOT EXISTS idx_agents_suggestions_project_status ON agents_suggestions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_entities_project_name ON entities(project_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_entity_edges_source ON entity_edges(source_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_adaptive_agent_patches_status ON adaptive_agent_patches(status, created_at);
CREATE INDEX IF NOT EXISTS idx_adaptive_agent_versions_created ON adaptive_agent_versions(created_at);
`;

export const CURRENT_SCHEMA_VERSION = 19;

export function runMigrations(db: Database.Database): void {
  db.exec(schemaSql);
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations(version, name, applied_at, rollback_sql)
     VALUES (?, ?, ?, ?)`
  ).run(CURRENT_SCHEMA_VERSION, "adaptive_agent_guidance", new Date().toISOString(), "-- additive schema; restore a backup for rollback");
  db.prepare(
    "INSERT OR REPLACE INTO settings(key, value_json, updated_at) VALUES ('schema_version', ?, ?)"
  ).run(JSON.stringify(CURRENT_SCHEMA_VERSION), new Date().toISOString());
}
