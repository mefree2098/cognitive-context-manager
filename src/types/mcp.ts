import type { ArtifactBrief, OpenLoopBrief } from "./artifact.js";
import type { MemoryBrief } from "./memory.js";
import type { ProjectSummary } from "./project.js";

export interface WorkingContextBrief {
  project?: ProjectSummary;
  currentTask: string;
  activeConstraints: string[];
  relevantMemories: MemoryBrief[];
  openLoops: OpenLoopBrief[];
  artifactState: ArtifactBrief[];
  staleWarnings: string[];
  conflictWarnings: string[];
  recommendedNextActions: string[];
  tokenEstimate: number;
}

export interface WorkingContextResponse {
  working_context_brief: string;
  project_id?: string;
  session_id?: string;
  memory_ids: string[];
  open_loop_ids: string[];
  warnings: string[];
}
