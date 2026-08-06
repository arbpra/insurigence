import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { COVERAGE_LIBRARY } from '@/lib/coverage/library';

/**
 * Super-admin editor for coverage rules.
 * GET → every library coverage merged with its override (enabled + explanation)
 *       plus any custom coverages.
 * PUT → save the edited rules (enable/disable, explanation override, custom coverages).
 * The engine's level logic stays in code; this edits the practical, non-code parts.
 */

const VALID_LEVELS = ['STRONGLY_RECOMMENDED', 'RECOMMENDED', 'CONSIDER', 'NOT_TYPICALLY_NEEDED'];

export async function GET(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  const configs = await prisma.coverageRuleConfig.findMany();
  const byName = new Map(configs.map((c) => [c.coverageName.toLowerCase(), c]));

  const libraryRules = COVERAGE_LIBRARY.map((lib) => {
    const c = byName.get(lib.coverageName.toLowerCase());
    return {
      coverageName: lib.coverageName,
      isCustom: false,
      enabled: c?.enabled ?? true,
      defaultExplanation: lib.agentExplanation,
      agentExplanation: c?.agentExplanation ?? '',
      customLevel: '',
      customReason: '',
    };
  });

  const libNames = new Set(COVERAGE_LIBRARY.map((l) => l.coverageName.toLowerCase()));
  const customRules = configs
    .filter((c) => c.isCustom && !libNames.has(c.coverageName.toLowerCase()))
    .map((c) => ({
      coverageName: c.coverageName,
      isCustom: true,
      enabled: c.enabled,
      defaultExplanation: '',
      agentExplanation: c.agentExplanation ?? '',
      customLevel: c.customLevel ?? 'CONSIDER',
      customReason: c.customReason ?? '',
    }));

  return NextResponse.json({ rules: [...libraryRules, ...customRules], levels: VALID_LEVELS });
}

interface RuleInput {
  coverageName?: string;
  enabled?: boolean;
  agentExplanation?: string;
  isCustom?: boolean;
  customLevel?: string;
  customReason?: string;
}

export async function PUT(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  let body: { rules?: RuleInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.rules)) {
    return NextResponse.json({ error: 'rules array required' }, { status: 400 });
  }

  for (const r of body.rules) {
    const name = r.coverageName?.trim();
    if (!name) continue;
    const explanation = r.agentExplanation?.trim() || null;
    const level = VALID_LEVELS.includes(r.customLevel ?? '') ? r.customLevel! : 'CONSIDER';

    await prisma.coverageRuleConfig.upsert({
      where: { coverageName: name },
      create: {
        coverageName: name,
        enabled: r.enabled ?? true,
        agentExplanation: explanation,
        isCustom: Boolean(r.isCustom),
        customLevel: r.isCustom ? level : null,
        customReason: r.isCustom ? (r.customReason?.trim() || null) : null,
      },
      update: {
        enabled: r.enabled ?? true,
        agentExplanation: explanation,
        ...(r.isCustom ? { isCustom: true, customLevel: level, customReason: r.customReason?.trim() || null } : {}),
      },
    });
  }

  return NextResponse.json({ success: true });
}
