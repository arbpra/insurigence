import OpenAI from 'openai';

/**
 * OpenAI client accessor (lazy singleton).
 *
 * The client is created on first use, not at import time, so importing the AI
 * layer never crashes when OPENAI_API_KEY is absent — instead the missing-key
 * error surfaces through callAI's normal error handling. One instance is reused
 * across hot reloads in dev. Nothing outside lib/ai/aiService.ts should call this.
 */
const globalForOpenAI = globalThis as unknown as {
  openai: OpenAI | undefined;
};

export function getOpenAIClient(): OpenAI {
  if (globalForOpenAI.openai) return globalForOpenAI.openai;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your .env file.');
  }

  const client = new OpenAI({ apiKey });
  if (process.env.NODE_ENV !== 'production') globalForOpenAI.openai = client;
  return client;
}
