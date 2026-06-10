import { randomUUID } from 'node:crypto';
import { deduplicateBeforeStore } from './deduplicator.js';
import type { MemoryRecord } from './types.js';

export interface DecisionRecord extends MemoryRecord {
  category: 'Decision';
  decision: string;
  reasoning: string;
  alternatives: string[];
  approvers: string[];
  reversible: boolean;
}

export interface DecisionInput {
  decision: string;
  reasoning: string;
  alternatives?: string[];
  approvers?: string[];
  reversible?: boolean;
  source: string;
  tags?: string[];
}

/** Creates a high-priority decision memory; decisions always have importance 10. */
export async function createDecisionMemory(input: DecisionInput): Promise<DecisionRecord> {
  const now = new Date();
  const record: DecisionRecord = {
    id: randomUUID(),
    content: `${input.decision} Reasoning: ${input.reasoning}`,
    category: 'Decision',
    importance: 10,
    confidence: 1,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    tags: ['decision', ...(input.tags ?? [])],
    graphEdges: [],
    revisionHistory: [],
    decision: input.decision,
    reasoning: input.reasoning,
    alternatives: input.alternatives ?? [],
    approvers: input.approvers ?? [],
    reversible: input.reversible ?? true,
  };
  await deduplicateBeforeStore(record);
  return record;
}

/** Returns true for records that must never be auto-archived by reflection. */
export function isProtectedDecision(memory: MemoryRecord): boolean {
  return memory.category === 'Decision';
}
