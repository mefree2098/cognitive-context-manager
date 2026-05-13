import type { ArtifactBrief, OpenLoopBrief } from "../types/artifact.js";
import type { Memory } from "../types/memory.js";
import type { WorkingContextBrief } from "../types/mcp.js";
import type { ProjectSummary } from "../types/project.js";
import { estimateTokens, truncateToTokens } from "./tokenizer.js";

export interface BuildContextInput {
  currentTask: string;
  project?: ProjectSummary;
  memories: Memory[];
  openLoops: OpenLoopBrief[];
  artifacts: ArtifactBrief[];
  recentEvents?: string[];
  conflicts?: string[];
  maxTokens: number;
}

function bullet(items: string[], fallback = "- None recorded."): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function memoryLine(memory: Memory): string {
  const summary = memory.summary || memory.content;
  return `[${memory.memoryType}] ${summary} (${memory.id}, salience ${memory.salience.toFixed(2)}, confidence ${memory.confidence.toFixed(2)})`;
}

export function buildWorkingContext(input: BuildContextInput): WorkingContextBrief {
  const activeMemories = input.memories.filter((memory) => memory.staleStatus === "active");
  const staleWarnings = input.memories
    .filter((memory) => memory.staleStatus !== "active")
    .map((memory) => `${memory.id} is ${memory.staleStatus}: ${memory.summary || memory.content}`);
  const activeConstraints = activeMemories
    .filter((memory) => memory.memoryType === "procedural" || memory.tags.includes("preference"))
    .map((memory) => memory.summary || memory.content)
    .slice(0, 8);

  return {
    project: input.project,
    currentTask: input.currentTask,
    activeConstraints,
    relevantMemories: activeMemories.slice(0, 12).map((memory) => ({
      id: memory.id,
      memoryType: memory.memoryType,
      summary: memory.summary || memory.content,
      content: memory.content,
      confidence: memory.confidence,
      salience: memory.salience,
      staleStatus: memory.staleStatus,
      sourceRefs: memory.sourceRefs
    })),
    openLoops: input.openLoops.slice(0, 12),
    artifactState: input.artifacts.slice(0, 12),
    staleWarnings: staleWarnings.slice(0, 8),
    conflictWarnings: (input.conflicts ?? []).slice(0, 8),
    recommendedNextActions: recommendedActions(input.openLoops, input.artifacts),
    tokenEstimate: 0
  };
}

export function renderWorkingContextBrief(brief: WorkingContextBrief, maxTokens: number): string {
  const projectLines = brief.project
    ? [
        `- Name: ${brief.project.name}`,
        brief.project.rootPath ? `- Root: ${brief.project.rootPath}` : undefined,
        brief.project.gitBranch ? `- Branch: ${brief.project.gitBranch}` : undefined,
        brief.project.gitRemote ? `- Remote: ${brief.project.gitRemote}` : undefined
      ].filter(Boolean)
    : ["- No project detected."];

  const text = [
    "# Working Context Brief",
    "",
    "## Current task",
    brief.currentTask || "No task supplied.",
    "",
    "## Project",
    projectLines.join("\n"),
    "",
    "## Active constraints",
    bullet(brief.activeConstraints),
    "",
    "## Relevant memories",
    bullet(brief.relevantMemories.map((memory) => `[${memory.memoryType}] ${memory.summary} (${memory.id})`)),
    "",
    "## Open loops",
    bullet(brief.openLoops.map((loop) => `[P${loop.priority}] ${loop.title}: ${loop.description} (${loop.id})`)),
    "",
    "## Artifact state",
    bullet(brief.artifactState.map((artifact) => `${artifact.path}: ${artifact.summary || artifact.status}`)),
    "",
    "## Warnings",
    bullet([...brief.staleWarnings, ...brief.conflictWarnings]),
    "",
    "## Suggested next actions",
    bullet(brief.recommendedNextActions)
  ].join("\n");

  return truncateToTokens(text, maxTokens);
}

export function attachTokenEstimate(brief: WorkingContextBrief, rendered: string): WorkingContextBrief {
  return { ...brief, tokenEstimate: estimateTokens(rendered) };
}

export function compactMemoryDump(memories: Memory[], maxTokens: number): string {
  return truncateToTokens(memories.map(memoryLine).join("\n"), maxTokens);
}

function recommendedActions(openLoops: OpenLoopBrief[], artifacts: ArtifactBrief[]): string[] {
  const actions: string[] = [];
  if (openLoops.length) actions.push("Review unresolved open loops before claiming the task is complete.");
  if (artifacts.some((artifact) => artifact.status === "changed")) actions.push("Verify changed artifacts against current repo state.");
  actions.push("Prefer current files and tool output over memory if there is any conflict.");
  return actions;
}
