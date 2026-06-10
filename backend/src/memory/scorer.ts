import type { ScoringContext } from './types.js';

/** Scores future utility from 1-10; values below 5 are temporary-only by policy. */
export function scoreImportance(content: string, context: ScoringContext): number {
  const normalized = content.trim();
  let score = baseScore(normalized);

  const boosts = [
    context.repeated,
    context.affectsFutureDecisions,
    context.projectCritical,
    context.organizationCritical,
    context.governanceRelated,
    context.repositoryRelated,
    context.agentRoleRelated,
  ].filter(Boolean).length;

  const reductions = [
    context.casualConversation,
    context.temporaryQuestion,
    context.oneTimeFact,
    context.lowFutureUtility,
  ].filter(Boolean).length;

  score += boosts * 2;
  score -= reductions * 2;
  return Math.min(10, Math.max(1, score));
}

/** Returns true when a memory must be permanent according to the hard importance rule. */
export function isPermanentMemory(importance: number): boolean {
  return importance >= 5;
}

/** Returns a 24-hour expiry date for low-importance temporary context. */
export function temporaryExpiry(now = new Date()): Date {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function baseScore(content: string): number {
  if (!content) return 1;
  if (/\b(decided|approved|must|policy|governance|repository|repo|production|critical)\b/i.test(content)) return 6;
  if (/\b(prefers|always|never|goal|project|organization|agent)\b/i.test(content)) return 5;
  return 4;
}
