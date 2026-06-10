import { randomUUID } from 'node:crypto';
import { jsonChat } from '../services/openai.js';
import { deduplicateBeforeStore } from './deduplicator.js';
import { scoreImportance, temporaryExpiry } from './scorer.js';
import type { MemoryCategory, MemoryRecord, ScoringContext } from './types.js';

interface CompressionResponse {
  content: string;
  category: MemoryCategory;
  confidence: number;
  tags?: string[];
  scoringSignals?: ScoringContext;
}

const COMPRESSION_SYSTEM_PROMPT = `Compress raw assistant conversation text into one durable memory fact.
Rules:
- Output JSON only.
- content must be a structured fact, not a narrative.
- Do not use filler such as "user talked about", "the conversation covered", or "it was discussed".
- Maximum 2 sentences.
- Present tense, third person.
- Prefer fewer, more accurate memories over storing uncertain facts.
- category must be one of: Identity, Preference, Goal, Project, Organization, Agent, Relationship, Decision, Task, Skill, Repository, ConversationSummary, TemporaryContext.`;

/** Compresses raw conversation text into one quality-controlled structured memory and stores it. */
export async function compressToMemory(rawText: string): Promise<MemoryRecord> {
  const compressed = await jsonChat<CompressionResponse>(
    process.env.MEMORY_COMPRESSION_MODEL ?? 'gpt-4o-mini',
    COMPRESSION_SYSTEM_PROMPT,
    { rawText: rawText.slice(0, 12000) },
  );

  const content = cleanMemoryContent(compressed.content);
  const importance = scoreImportance(content, compressed.scoringSignals ?? {});
  const category = importance < 5 ? 'TemporaryContext' : compressed.category;
  const now = new Date();
  const memory: MemoryRecord = {
    id: randomUUID(),
    content,
    category,
    importance,
    confidence: clamp(compressed.confidence, 0.2, 1),
    source: 'memory.compressor',
    createdAt: now,
    updatedAt: now,
    expiresAt: importance < 5 ? temporaryExpiry(now) : undefined,
    tags: compressed.tags ?? [],
    graphEdges: [],
    revisionHistory: [],
  };
  await deduplicateBeforeStore(memory);
  return memory;
}

/** Returns the exact compression prompt used by the quality system for auditability. */
export function getCompressionPrompt(): string {
  return COMPRESSION_SYSTEM_PROMPT;
}

function cleanMemoryContent(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  const withoutFiller = trimmed.replace(/^(the )?user (talked|spoke|discussed) (about|for).*?:?\s*/i, '');
  return withoutFiller.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
