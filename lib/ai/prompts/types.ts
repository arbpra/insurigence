import type { ZodType, ZodTypeDef } from 'zod';
import type { AiPurpose } from '../config';

/**
 * A PromptDefinition bundles everything that makes one AI feature reproducible
 * and auditable: which feature it is, the prompt version (recorded on every
 * AiRun), the feature-specific instructions, and the output schema.
 *
 * Shared guardrails and the JSON contract are NOT part of `instructions` —
 * the service layer prepends those for every call.
 */
export interface PromptDefinition<T> {
  purpose: AiPurpose;
  /** Bump when instructions or schema change, so AiRun history stays traceable. */
  version: string;
  /** Feature-specific guidance only. Do not repeat the global guardrails. */
  instructions: string;
  /**
   * Output contract; the model's JSON is validated against this. Input is
   * `unknown` so schemas using z.preprocess/transform (whose input type differs
   * from their output type) still fit.
   */
  schema: ZodType<T, ZodTypeDef, unknown>;
  /** Optional per-feature model/sampling overrides. */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}
