import { getOpenAIClient } from './client';
import {
  AI_MODEL,
  AI_DEFAULTS,
  AI_GUARDRAILS,
  AI_DISCLAIMER,
  type AiPurpose,
} from './config';
import type { PromptDefinition } from './prompts/types';

/**
 * Central AI service. Every AI feature in the app calls `callAI` — nothing talks
 * to the OpenAI client directly. This guarantees that the guardrails, JSON-only
 * output, and disclaimer are applied uniformly to every request.
 *
 * Schema validation of `data` is added in Day 2 (lib/ai/schemas.ts). For now we
 * parse JSON and return it untyped-but-shaped, plus the raw text for auditing.
 */

export interface CallAIParams {
  /** Which feature is calling. Stored on AiRun.purpose for audit/history. */
  purpose: AiPurpose;
  /**
   * Feature-specific instructions. The shared guardrails are prepended
   * automatically — do NOT repeat them here.
   */
  instructions: string;
  /**
   * The structured input the model should work from (rules-engine output,
   * intake answers, etc.). Objects are JSON-stringified.
   */
  input: unknown;
  /** Optional per-call overrides. */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface CallAIResult<T = Record<string, unknown>> {
  ok: boolean;
  /** Parsed JSON output from the model (validated against a schema in Day 2). */
  data: T | null;
  /** Raw text the model returned — always kept for auditing. */
  raw: string;
  model: string;
  /** Token usage, when the provider reports it. */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  /** Always attached so the UI can surface it. */
  disclaimer: string;
  /** Prompt version that produced this output (set by callPrompt). */
  promptVersion?: string;
  error?: string;
}

/** Builds the full system prompt: shared guardrails + feature instructions + JSON contract. */
function buildSystemPrompt(instructions: string): string {
  return [
    AI_GUARDRAILS,
    '',
    instructions,
    '',
    'Respond with a single valid JSON object only. Do not include markdown, code fences, or commentary outside the JSON.',
  ].join('\n');
}

export async function callAI<T = Record<string, unknown>>(
  params: CallAIParams
): Promise<CallAIResult<T>> {
  const model = params.model || AI_MODEL;
  const userContent =
    typeof params.input === 'string' ? params.input : JSON.stringify(params.input, null, 2);

  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model,
      temperature: params.temperature ?? AI_DEFAULTS.temperature,
      max_tokens: params.maxOutputTokens ?? AI_DEFAULTS.maxOutputTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(params.instructions) },
        { role: 'user', content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const usage = completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : null;

    let data: T | null = null;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      return {
        ok: false,
        data: null,
        raw,
        model,
        usage,
        disclaimer: AI_DISCLAIMER,
        error: 'Model did not return valid JSON.',
      };
    }

    return { ok: true, data, raw, model, usage, disclaimer: AI_DISCLAIMER };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown AI service error';
    return {
      ok: false,
      data: null,
      raw: '',
      model,
      usage: null,
      disclaimer: AI_DISCLAIMER,
      error: message,
    };
  }
}

/**
 * Preferred entry point for features. Takes a versioned PromptDefinition, runs
 * the model, then validates the JSON against the feature's Zod schema. Returns
 * fully typed `data` on success, or ok:false with a clear error if the model
 * returned malformed or schema-invalid output.
 */
export async function callPrompt<T>(
  def: PromptDefinition<T>,
  input: unknown
): Promise<CallAIResult<T>> {
  const result = await callAI<T>({
    purpose: def.purpose,
    instructions: def.instructions,
    input,
    model: def.model,
    temperature: def.temperature,
    maxOutputTokens: def.maxOutputTokens,
  });

  result.promptVersion = def.version;

  // Transport/JSON-parse already failed — pass it through unchanged.
  if (!result.ok || result.data === null) return result;

  const parsed = def.schema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ...result,
      ok: false,
      data: null,
      error: `AI output failed schema validation: ${parsed.error.message}`,
    };
  }

  return { ...result, data: parsed.data };
}
