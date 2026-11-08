import { NextRequest, NextResponse } from 'next/server';
import {
  list, add, update, remove, quietHours, setQuietHours,
  runNow, poll, delivered, ensureBuiltin, BUILTINS,
  type Trigger, type TimeRule,
} from '../../lib/server/routines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function describe(r: { trigger?: Trigger; nextTs?: number }): string {
  const t = r.trigger;
  if (!t) return 'unscheduled';
  if (t.type === 'startup') return 'at startup';
  if (t.type === 'idle') return `when idle ${t.minutes} min (cooldown ${t.cooldown} min)`;
  const rule = t.rule;
  if (rule.at) return `once at ${rule.at}`;
  if (rule.everyMinutes) return `every ${rule.everyMinutes} min${rule.between ? ` between ${rule.between}` : ''}`;
  if (rule.monthlyDay) return `day ${rule.monthlyDay} of the month at ${rule.time ?? ''}`;
  if (rule.time) {
    const days = rule.days?.length ? `days ${rule.days.join(',')}` : 'every day';
    return `${days} at ${rule.time}`;
  }
  return 'custom time rule';
}

function triggerFrom(a: Record<string, unknown>): Trigger | null {
  const on = String(a.on ?? '').trim().toLowerCase();
  if (on === 'startup') return { type: 'startup' };
  if (on === 'idle') {
    return { type: 'idle', minutes: Number(a.idleMinutes ?? 15), cooldown: Number(a.cooldownMinutes ?? 20) };
  }
  const rule: TimeRule = {};
  if (a.at) rule.at = String(a.at);
  if (a.time) rule.time = String(a.time);
  if (Array.isArray(a.days) && a.days.length) rule.days = (a.days as unknown[]).map(Number).filter(Number.isFinite);
  if (a.monthlyDay) rule.monthlyDay = Number(a.monthlyDay);
  if (a.everyMinutes) rule.everyMinutes = Number(a.everyMinutes);
  if (a.between) rule.between = String(a.between);
  if (rule.at || rule.time || rule.monthlyDay || rule.everyMinutes) return { type: 'time', rule };
  return null;
}

export async function GET() {
  const routines = list().map((r) => ({
    id: r.id, name: r.name, kind: r.kind, text: r.text, enabled: r.enabled,
    quiet: r.quiet, deliver: r.deliver, builtin: r.builtin,
    when: describe(r), nextTs: r.nextTs, lastOutcome: r.lastOutcome,
  }));
  return NextResponse.json({ routines, quietHours: quietHours(), builtins: Object.keys(BUILTINS) });
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();

    switch (op) {
      case 'poll': {
        const result = poll({
          ready: Boolean(a.ready),
          speaking: Boolean(a.speaking),
          idleSeconds: Number(a.idleSeconds ?? 0),
        });
        return NextResponse.json(result);
      }

      case 'delivered':
      case 'failed': {
        delivered(String(a.id ?? ''), op === 'delivered');
        return NextResponse.json({ ok: true });
      }

      case 'list':
        return NextResponse.json({ routines: list() });

      case 'add': {
        const trigger = triggerFrom(a);
        const result = add({
          name: a.name ? String(a.name) : undefined,
          kind: a.kind ? String(a.kind) : undefined,
          text: a.text ? String(a.text) : undefined,
          trigger: trigger ?? undefined,
          deliver: a.deliver ? String(a.deliver) : undefined,
          quiet: a.quiet === undefined ? undefined : Boolean(a.quiet),
        });
        if ('error' in result) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({
          ok: true, id: result.routine.id, name: result.routine.name,
          when: describe(result.routine), nextTs: result.routine.nextTs,
        });
      }

      case 'update': {
        const fields: Parameters<typeof update>[1] = {};
        const trigger = triggerFrom(a);
        if (trigger) fields.trigger = trigger;
        if (a.name !== undefined) fields.name = String(a.name);
        if (a.text !== undefined) fields.text = String(a.text);
        if (a.enabled !== undefined) fields.enabled = Boolean(a.enabled);
        if (a.quiet !== undefined) fields.quiet = Boolean(a.quiet);
        if (a.deliver !== undefined) fields.deliver = String(a.deliver) as 'voice' | 'panel' | 'silent';
        const r = update(String(a.id ?? ''), fields);
        if (!r) return NextResponse.json({ error: 'no routine with that id' }, { status: 404 });
        return NextResponse.json({ ok: true, id: r.id, name: r.name, enabled: r.enabled, when: describe(r) });
      }

      case 'remove': {
        const ok = remove(String(a.id ?? ''));
        return ok
          ? NextResponse.json({ ok: true })
          : NextResponse.json({ error: 'no routine with that id' }, { status: 404 });
      }

      case 'run_now': {
        const d = runNow(String(a.id ?? ''));
        return d
          ? NextResponse.json({ ok: true, delivery: d })
          : NextResponse.json({ error: 'no enabled routine with that id' }, { status: 404 });
      }

      case 'quiet_hours': {
        const value = setQuietHours(String(a.between ?? ''));
        return NextResponse.json({ ok: true, quietHours: value || 'off' });
      }

      case 'builtin': {
        const r = ensureBuiltin(String(a.builtin ?? ''));
        if (!r) return NextResponse.json({ error: 'unknown builtin' }, { status: 404 });
        return NextResponse.json({ ok: true, id: r.id, name: r.name, enabled: r.enabled, when: describe(r) });
      }

      default:
        return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[routines]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}