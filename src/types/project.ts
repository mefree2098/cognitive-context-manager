export interface ProjectSummary {
  id: string;
  name: string;
  rootPath?: string;
  gitRemote?: string;
  gitBranch?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  metadata: Record<string, unknown>;
}

export interface SessionSummary {
  id: string;
  projectId?: string;
  codexSessionId?: string;
  startedAt: string;
  lastSeenAt: string;
  status: "active" | "compacted" | "closed";
  summary?: string;
  metadata: Record<string, unknown>;
}
