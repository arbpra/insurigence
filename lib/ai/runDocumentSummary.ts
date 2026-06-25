import { callPrompt } from './aiService';
import { saveAiRun } from './persistence';
import { documentSummaryPrompt } from './prompts';

/**
 * Run the Document Summary extraction on raw text and persist the run.
 * Shared by the pasted-text route and the PDF-upload route so both produce
 * identical output and audit records.
 */
export async function runDocumentSummary(
  text: string,
  ctx: { agencyId: string | null; leadId: string; fileName?: string | null }
) {
  const result = await callPrompt(documentSummaryPrompt, text);

  const aiRun = await saveAiRun({
    purpose: documentSummaryPrompt.purpose,
    result,
    input: { fileName: ctx.fileName ?? null, textLength: text.length, text },
    agencyId: ctx.agencyId,
    leadId: ctx.leadId,
  }).catch(() => null);

  return { result, aiRun };
}
