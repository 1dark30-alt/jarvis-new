import { NextRequest, NextResponse } from 'next/server';
import { canUndo, peek, history, undoLast, clear } from '../../lib/server/undoJournal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    canUndo: canUndo(),
    next: peek(),
    history: history(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { op } = (await req.json()) as { op?: string };
    if (op === 'undo') {
      const message = await undoLast();
      return NextResponse.json({ ok: true, message, canUndo: canUndo(), next: peek() });
    }
    if (op === 'clear') {
      clear();
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: `Unknown op: ${op ?? '(none)'}` }, { status: 400 });
  } catch (err) {
    console.error('[undo]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}