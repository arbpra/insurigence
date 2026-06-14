import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { quickRiskGuidePrompt } from '@/lib/ai/prompts';

/**
 * Feature 2 — Quick Risk Guide (agent-facing).
 * An agent types a short free-text description and gets quick INTERNAL guidance.
 * Available to any authenticated user; each run is logged under their agency.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return auth.response!;

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
  if (description.length > 2000) {
    return NextResponse.json({ error: 'description is too long (max 2000 chars)' }, { status: 400 });
  }

  const result = await callPrompt(quickRiskGuidePrompt, description);

  const aiRun = await saveAiRun({
    purpose: quickRiskGuidePrompt.purpose,
    result,
    input: description,
    agencyId: auth.user.agencyId,
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
