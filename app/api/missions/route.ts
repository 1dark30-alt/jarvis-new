import { NextRequest, NextResponse } from 'next/server';
import {
  list, get, propose, cancel, peekNotices, clearNotices, resumeAll,
} from '../../lib/server/missions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let resumed = false;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const m = get(id);
    if (!m) return NextResponse.json({ error: 'No such mission' }, { status: 404 });
    return NextResponse.json({ mission: { ...m, sources: m.sources.map((s) => ({ n: s.n, url: s.url, title: s.title })) } });
  }
  return NextResponse.json({
    missions: list().map((m) => ({
      id: m.id, title: m.title, kind: m.kind, agent: m.agent,
      status: m.status, budgetMinutes: m.budgetMinutes, minutesUsed: m.minutesUsed,
      createdAt: m.createdAt, finishedAt: m.finishedAt,
      findings: m.findings.length, sources: m.sources.length,
      verified: m.findings.filter((f) => f.verified).length,
      error: m.error,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();

    switch (op) {
      // Client heartbeat: resumes crashed missions once, hands over
      // completion notices, and reports whether the assistant can speak.
      case 'poll': {
        if (!resumed) { resumed = true; resumeAll(); }
        return NextResponse.json({
          notices: Boolean(a.ready) ? peekNotices() : [],
          ready: Boolean(a.ready),
        });
      }
      case 'ack': {
        clearNotices();
        return NextResponse.json({ ok: true });
      }

      case 'start': {
        const result = propose({
          title: a.title ? String(a.title) : undefined,
          task: a.task ? String(a.task) : undefined,
          agent: a.agent ? String(a.agent) : undefined,
          minutes: a.minutes === undefined ? undefined : Number(a.minutes),
        });
        if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
        return NextResponse.json({
          ok: true, id: result.mission.id, title: result.mission.title,
          budgetMinutes: result.mission.budgetMinutes,
        });
      }

      case 'cancel': {
        const ok = cancel(String(a.id ?? ''));
        return ok
          ? NextResponse.json({ ok: true })
          : NextResponse.json({ error: 'No active mission with that id' }, { status: 404 });
      }

      default:
        return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[missions]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}