export interface ArtifactBrief {
  id: string;
  projectId?: string;
  path: string;
  artifactType: string;
  summary?: string;
  lastHash?: string;
  lastSeenAt: string;
  status: "tracked" | "changed" | "deleted" | "generated";
  metadata: Record<string, unknown>;
}

export interface OpenLoopBrief {
  id: string;
  projectId?: string;
  sessionId?: string;
  title: string;
  description: string;
  status: "open" | "blocked" | "resolved" | "closed";
  priority: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}
