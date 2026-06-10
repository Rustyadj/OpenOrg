import type { MemoryCategory, MemoryRecord, RetrievalScoreBreakdown } from './types.js';

export interface RelevanceInput {
  relevance: number;
  confidence: number;
  importance: number;
  agentCategoryBoost?: number;
}

/** Calculates the required final recall rank score. */
export function calculateRetrievalScore(input: RelevanceInput): number {
  const relevance = clamp(input.relevance, 0, 1);
  const confidence = clamp(input.confidence, 0, 1);
  const importanceFactor = clamp(input.importance / 10, 0, 1);
  const boost = clamp(input.agentCategoryBoost ?? 1, 0.5, 1.5);
  return relevance * confidence * importanceFactor * boost;
}

/** Returns an inspectable score breakdown for the audit UI and retrieval logs. */
export function buildScoreBreakdown(input: RelevanceInput): RetrievalScoreBreakdown {
  const relevance = clamp(input.relevance, 0, 1);
  const confidence = clamp(input.confidence, 0, 1);
  const importanceFactor = clamp(input.importance / 10, 0, 1);
  const agentCategoryBoost = clamp(input.agentCategoryBoost ?? 1, 0.5, 1.5);
  return {
    relevance,
    confidence,
    importanceFactor,
    agentCategoryBoost,
    finalScore: calculateRetrievalScore({ relevance, confidence, importance: input.importance, agentCategoryBoost }),
  };
}

/** Produces a new memory record with a confidence adjustment bounded to 0..1. */
export function adjustConfidence(memory: MemoryRecord, delta: number): MemoryRecord {
  return { ...memory, confidence: clamp(memory.confidence + delta, 0, 1), updatedAt: new Date() };
}

/** Determines whether category success history should boost retrieval for an agent. */
export function categoryBoost(category: MemoryCategory, successfulCategories: MemoryCategory[]): number {
  const uses = successfulCategories.filter((used) => used === category).length;
  if (uses >= 5) return 1.25;
  if (uses >= 2) return 1.12;
  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
