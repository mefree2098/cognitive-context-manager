import type { CcmConfig } from "../types/config.js";
import type { Memory } from "../types/memory.js";
import { estimateTokens } from "./tokenizer.js";

export interface HybridRankInput {
  fts: Array<Memory & { retrievalScore?: number; retrievalReason?: string }>;
  vector: Array<Memory & { vectorScore: number }>;
  openLoopIds?: string[];
  config: CcmConfig;
  tokenBudget: number;
}

export interface HybridRankedMemory extends Memory {
  retrievalScore: number;
  retrievalReason: string;
}

export function hybridRank(input: HybridRankInput): HybridRankedMemory[] {
  const byId = new Map<string, HybridRankedMemory>();
  for (const memory of input.fts) {
    byId.set(memory.id, {
      ...memory,
      retrievalScore: memory.retrievalScore ?? 0.5,
      retrievalReason: memory.retrievalReason ?? "FTS candidate"
    });
  }
  for (const memory of input.vector) {
    const existing = byId.get(memory.id);
    const reason = `vector score ${memory.vectorScore.toFixed(3)}`;
    byId.set(memory.id, existing ? { ...existing, retrievalReason: `${existing.retrievalReason}; ${reason}` } : { ...memory, retrievalScore: 0, retrievalReason: reason });
  }

  const openLoopSet = new Set(input.openLoopIds ?? []);
  const ranked = [...byId.values()]
    .map((memory) => {
      const ftsScore = memory.retrievalScore ?? 0;
      const vectorScore = input.vector.find((item) => item.id === memory.id)?.vectorScore ?? 0;
      const salience = memory.salience;
      const recency = recencyScore(memory.updatedAt);
      const openLoopBoost = openLoopSet.has(memory.id) || memory.memoryType === "open_loop" ? 1 : 0;
      const supersededPenalty = memory.staleStatus === "active" ? 0 : 0.8;
      const tokenCostPenalty = Math.min(0.25, estimateTokens(memory.summary || memory.content) / Math.max(input.tokenBudget, 1));
      return {
        ...memory,
        retrievalScore:
          ftsScore * input.config.retrieval.ftsWeight +
          vectorScore * input.config.retrieval.vectorWeight +
          salience * input.config.retrieval.salienceWeight +
          recency * input.config.retrieval.recencyWeight +
          openLoopBoost * input.config.retrieval.openLoopWeight -
          supersededPenalty -
          tokenCostPenalty,
        retrievalReason: [
          memory.retrievalReason,
          `salience ${salience.toFixed(2)}`,
          `recency ${recency.toFixed(2)}`,
          supersededPenalty ? `penalty ${memory.staleStatus}` : "active"
        ].join("; ")
      };
    })
    .filter((memory) => !input.config.retrieval.excludeSuperseded || memory.staleStatus === "active")
    .sort((a, b) => b.retrievalScore - a.retrievalScore);

  return ranked;
}

function recencyScore(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const days = ageMs / 86_400_000;
  return Math.max(0, Math.min(1, 1 / (1 + days / 14)));
}
