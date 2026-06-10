import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getOpenAI() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'test-key' });
  }
  return client;
}

export async function jsonChat<T>(model: string, system: string, user: object): Promise<T> {
  const response = await getOpenAI().chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) },
    ],
  });
  return JSON.parse(response.choices[0]?.message?.content ?? '{}') as T;
}
