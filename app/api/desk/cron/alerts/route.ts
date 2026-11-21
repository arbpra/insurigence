import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { runAlertCheck } from '@/lib/desk/alerts';
import { cronSecret, isSchedulerRequest } from '@/lib/desk/alert-schedule';

/**
 * The scheduler's door to the alert check (Module 41). No session: the
 * caller proves itself with "Authorization: Bearer <DESK_CRON_SECRET>"
 * (lib/desk/alert-schedule.ts). Answers with counts only.
 */
export const dynamic = 'force-dynamic';

async function run(request: NextRequest) {
  if (!cronSecret()) return NextResponse.json({ error: 'The scheduled check is not set up (DESK_CRON_SECRET).' }, { status: 503 });
  if (!isSchedulerRequest(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runAlertCheck(prisma));
  } catch (err) {
    console.error('[desk/cron/alerts]', err);
    return NextResponse.json({ error: 'The check failed.' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
