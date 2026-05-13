import type { MemoriesRepo } from "../storage/repositories/memories-repo.js";
import type { Memory } from "../types/memory.js";

const CONTRADICTION_PATTERNS = [
  /\b(no longer|does not|doesn't|not working|broken|failed|regressed)\b/i,
  /\b(instead|actually|correction|wrong)\b/i
];

export function likelyContradicts(newContent: string, oldMemory: Memory): boolean {
  const sameEntity = oldMemory.entities.some((entity) => newContent.includes(entity));
  const negativeSignal = CONTRADICTION_PATTERNS.some((pattern) => pattern.test(newContent));
  return sameEntity && negativeSignal;
}

export function markContradictedMemories(repo: MemoriesRepo, newMemory: Memory, candidates: Memory[]): string[] {
  const superseded: string[] = [];
  for (const candidate of candidates) {
    if (candidate.id !== newMemory.id && candidate.staleStatus === "active" && likelyContradicts(newMemory.content, candidate)) {
      repo.markStale(candidate.id, "superseded", `New memory ${newMemory.id} appears to contradict it.`, newMemory.id);
      superseded.push(candidate.id);
    }
  }
  return superseded;
}
