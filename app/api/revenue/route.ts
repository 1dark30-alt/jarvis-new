import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * League Revenue — membership payment log + royalty/investor percentage
 * settings. The weekly royalty and investor amounts are computed on the
 * page from the Financial Tracker's collected totals.
 */

function dataFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'league-revenue.json');
}

interface MembershipPayment {
  id: string;
  player: string;
  date: string;
  amount: number;
  season: string;
}

interface RevenueStore {
  membership: MembershipPayment[];
  royaltyPct: number;
  investorPct: number;
}

function load(): RevenueStore {
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile(), 'utf8')) as Partial<RevenueStore>;
    return {
      membership: raw.membership ?? [],
      royaltyPct: raw.royaltyPct ?? 20,
      investorPct: raw.investorPct ?? 10,
    };
  } catch {
    return { membership: [], royaltyPct: 20, investorPct: 10 };
  }
}

function save(s: RevenueStore): void {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(s, null, 2), 'utf8');
}

export async function GET() {
  const s = load();
  return NextResponse.json({
    membership: s.membership,
    royaltyPct: s.royaltyPct,
    investorPct: s.investorPct,
  });
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();
    const s = load();

    switch (op) {
      case 'add_membership': {
        const id = `m${Date.now().toString(36)}`;
        s.membership.push({
          id,
          player: String(a.player ?? '').trim(),
          date: String(a.date ?? new Date().toISOString().slice(0, 10)),
          amount: Number(a.amount ?? 0),
          season: String(a.season ?? ''),
        });
        save(s);
        return NextResponse.json({ ok: true, id });
      }

      case 'remove_membership': {
        const id = String(a.id ?? '');
        s.membership = s.membership.filter((m) => m.id !== id);
        save(s);
        return NextResponse.json({ ok: true });
      }

      case 'set_percentages': {
        s.royaltyPct = Number(a.royaltyPct ?? 20);
        s.investorPct = Number(a.investorPct ?? 10);
        save(s);
        return NextResponse.json({ ok: true, royaltyPct: s.royaltyPct, investorPct: s.investorPct });
      }

      default:
        return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[revenue]', err);
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}