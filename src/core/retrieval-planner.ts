import type { Memory } from "../types/memory.js";

export interface RankedMemory extends Memory {
  retrievalScore: number;
  retrievalReason: string;
}

export function rankMemories(memories: Memory[], query: string): RankedMemory[] {
  const queryTerms = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  return memories
    .map((memory) => {
      const haystack = [memory.content, memory.summary, memory.tags.join(" "), memory.retrievalCues.join(" ")]
        .join(" ")
        .toLowerCase();
      const lexicalHits = [...queryTerms].filter((term) => haystack.includes(term)).length;
      const typeBoost = memory.memoryType === "semantic" || memory.memoryType === "procedural" ? 0.12 : 0;
      const stalePenalty = memory.staleStatus === "active" ? 0 : -0.4;
      const retrievalScore = memory.salience * 0.35 + memory.confidence * 0.25 + lexicalHits * 0.08 + typeBoost + stalePenalty;
      const reason = [
        lexicalHits ? `${lexicalHits} query term hit${lexicalHits === 1 ? "" : "s"}` : "metadata/recency match",
        `salience ${memory.salience.toFixed(2)}`,
        `confidence ${memory.confidence.toFixed(2)}`
      ].join("; ");
      return { ...memory, retrievalScore, retrievalReason: reason };
    })
    .sort((a, b) => b.retrievalScore - a.retrievalScore);
}
