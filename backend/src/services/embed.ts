import { VoyageAIClient } from 'voyageai';

// voyage-3 produces 1024-dimensional vectors
const client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! });

export async function embed(text: string): Promise<number[]> {
  const res = await client.embed({
    model: 'voyage-3',
    input: [text.slice(0, 16000)],
    inputType: 'document',
  });
  const vec = res.data?.[0]?.embedding;
  if (!vec || !Array.isArray(vec)) throw new Error('Voyage embed returned no vector');
  return vec as number[];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// score = (0.4 * vector_similarity) + (0.3 * recency_score) + (0.2 * importance) + (0.1 * confidence)
export function relevanceScore(
  vectorSim: number,
  recencyMs: number,
  importance: number,
  confidence: number
): number {
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  const recencyScore = Math.max(0, 1 - recencyMs / maxAge);
  return (0.4 * vectorSim) + (0.3 * recencyScore) + (0.2 * importance) + (0.1 * confidence);
}
