import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { CallAIResult } from './aiService';
import type { AiPurpose } from './config';

/**
 * Persists an AI run for audit/history. Every AI call in the app should be
 * recorded — both successes and failures — so we have a complete trail of what
 * was sent, what came back, which prompt version produced it, and (later) which
 * agent reviewed it.
 *
 * Kept separate from callPrompt so the service layer stays pure/testable; the
 * caller decides the agency/lead context and whether to persist.
 */
export interface SaveAiRunParams {
  purpose: AiPurpose;
  result: CallAIResult<unknown>;
  /** The input that was sent to the model (stored as inputSnapshot). */
  input: unknown;
  agencyId?: string | null;
  leadId?: string | null;
}

/** Safely coerce arbitrary values into a Prisma JSON value. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function saveAiRun(params: SaveAiRunParams) {
  const { result } = params;

  // `output` is required on the model — always store something meaningful.
  const output: Prisma.InputJsonValue = result.data
    ? toJson(result.data)
    : toJson({ raw: result.raw, error: result.error });

  return prisma.aiRun.create({
    data: {
      agencyId: params.agencyId ?? undefined,
      leadId: params.leadId ?? undefined,
      purpose: params.purpose,
      status: result.ok ? 'COMPLETED' : 'FAILED',
      model: result.model,
      promptVersion: result.promptVersion,
      inputSnapshot: toJson(params.input),
      output,
      usage: result.usage ? toJson(result.usage) : undefined,
      error: result.error,
    },
  });
}
