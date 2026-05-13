export type MemoryType =
  | "episodic"
  | "semantic"
  | "procedural"
  | "salience"
  | "open_loop"
  | "artifact"
  | "safety";

export type StaleStatus =
  | "active"
  | "stale"
  | "superseded"
  | "disputed"
  | "forgotten"
  | "archived"
  | "tombstoned"
  | "redacted"
  | "quarantined";

export type DecayPolicy =
  | "temporary"
  | "normal"
  | "project_long_term"
  | "user_long_term"
  | "no_decay";

export interface SourceRef {
  kind: "user" | "codex" | "tool" | "hook" | "file" | "memory" | "system";
  label: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface Memory {
  id: string;
  projectId?: string;
  sessionId?: string;
  memoryType: MemoryType;
  eventType?: import("./event.js").EventType;
  content: string;
  summary?: string;
  entities: string[];
  tags: string[];
  retrievalCues: string[];
  salience: number;
  confidence: number;
  sourceRefs: SourceRef[];
  supersedes: string[];
  supersededBy?: string;
  staleStatus: StaleStatus;
  decayPolicy: DecayPolicy;
  validFrom: string;
  validUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryBrief {
  id: string;
  memoryType: MemoryType;
  summary: string;
  content: string;
  confidence: number;
  salience: number;
  staleStatus: StaleStatus;
  sourceRefs: SourceRef[];
}

export interface MemorySearchOptions {
  query: string;
  projectId?: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  includeStale?: boolean;
}
