import { NextRequest, NextResponse } from 'next/server';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { quickRiskGuidePrompt } from '@/lib/ai/prompts';

/**
 * Dev/test harness for the AI foundation (Days 1–2). Lets a super admin run the
 * Quick Risk Guide prompt against a free-text description and see the structured,
 * schema-validated output. Not a production feature — it exists to verify the
 * AI service end-to-end before the real feature UIs are built.
 */
export async function POST(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  let body: { description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const description = body.description?.trim();
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const result = await callPrompt(quickRiskGuidePrompt, description);

  // Record every run for audit/history — successes and failures alike.
  const aiRun = await saveAiRun({
    purpose: quickRiskGuidePrompt.purpose,
    result,
    input: description,
    agencyId: auth.user!.agencyId,
  }).catch(() => null);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'AI request failed', disclaimer: result.disclaimer },
      { status: 502 }
    );
  }

  return NextResponse.json({
    aiRunId: aiRun?.id ?? null,
    data: result.data,
    disclaimer: result.disclaimer,
    model: result.model,
    promptVersion: result.promptVersion,
    usage: result.usage,
  });
}
