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
