import type { SourceRef } from "./memory.js";

export type EventType =
  | "session_start"
  | "user_prompt"
  | "tool_use"
  | "tool_result"
  | "decision"
  | "preference"
  | "failure"
  | "blocker"
  | "artifact_change"
  | "test_result"
  | "implementation_step"
  | "outcome"
  | "topic_shift"
  | "session_stop";

export interface EventCapsule {
  id: string;
  sessionId: string;
  projectId?: string;
  eventType: EventType;
  title?: string;
  summary: string;
  entities: string[];
  sourceRefs: SourceRef[];
  salience: number;
  confidence: number;
  createdAt: string;
}

export interface EventBoundary {
  isBoundary: boolean;
  eventType: EventType;
  signals: string[];
  salience: number;
  confidence: number;
  title?: string;
  summary: string;
}
