import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pythonExe } from '@/app/lib/server/python-exe';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import { callGemini, SMART } from '../../lib/server/geminiLadder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_STEPS_CAP = 12;
const MAX_TIMEOUT_MS = 480_000;

/**
 * Screen Agent — does a task on screen by LOOKING at it, step by step.
 * Port of Mark 58's screen_agent + _screen_loop, with one deliberate
 * simplification for this first port: the model answers in a 0-1000
 * normalised space and the actuator maps that to real pixels — the
 * numbered-boxes overlay (Mark's answer to pixel-guessing) comes later;
 * the confirmation gate is here: the agent never runs without the user
 * having asked for the task by voice, and it never types passwords.
 *
 * Each step: screenshot → the vision ladder picks ONE action → the
 * pyautogui actuator executes it → repeat until "done" or the cap.
 */

interface AgentAction {
  action?: 'click' | 'double_click' | 'right_click' | 'type' | 'key' | 'hotkey' | 'scroll' | 'move' | 'done';
  x?: number;
  y?: number;
  text?: string;
  keys?: string;
  amount?: number;
  summary?: string;
}

function runAction(spec: AgentAction): Promise<{ ok: boolean; screen?: number[]; error?: string }> {
  const script = path.join(process.cwd(), 'scripts', 'agent_action.py');
  return new Promise((resolve) => {
    execFile(pythonExe(), [script, JSON.stringify(spec)], {
      timeout: 30_000,
      windowsHide: false,
      encoding: 'utf8',
    }, (err, stdout) => {
      if (err && !stdout) { resolve({ ok: false, error: String(err).slice(0, 200) }); return; }
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ ok: false, error: `unreadable output: ${String(stdout).slice(0, 120)}` }); }
    });
  });
}

async function grabScreen(): Promise<{ base64: string; width: number; height: number }> {
  const png = (await screenshot({ format: 'png' })) as Buffer;
  const resized = await sharp(png).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  const meta = await sharp(resized).metadata();
  return { base64: resized.toString('base64'), width: meta.width ?? 1440, height: meta.height ?? 0 };
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const { task, maxSteps } = (await req.json()) as { task?: string; maxSteps?: number };
    const goal = (task ?? '').trim();
    if (goal.length < 4) return NextResponse.json({ error: 'Describe the task for the agent.' }, { status: 400 });

    const cap = Math.max(1, Math.min(MAX_STEPS_CAP, Number(maxSteps ?? 6)));
    const realScreen = { w: 0, h: 0 };
    try {
      // The actuator reports the true pixel size on its first call.
      const probe = await runAction({ action: 'move', x: 500, y: 500 });
      if (probe.screen) { realScreen.w = probe.screen[0]; realScreen.h = probe.screen[1]; }
    } catch { /* sizes come from the screenshot instead */ }

    const transcript: { step: number; action: string; detail: string }[] = [];
    let lastVision = '';

    for (let step = 1; step <= cap; step++) {
      if (Date.now() - started > MAX_TIMEOUT_MS) {
        return NextResponse.json({ ok: false, stopped: 'timeout', transcript });
      }
      const shot = await grabScreen();
      if (!realScreen.w) { realScreen.w = shot.width; realScreen.h = shot.height; }

      const decision = await callGemini({
        contents: `TASK: ${goal}
Screen size (real pixels): ${realScreen.w}x${realScreen.h} — the screenshot is scaled; use the 0-1000 normalised coordinates below regardless.

ACTIONS SO FAR:
${transcript.length ? transcript.map((t) => `${t.step}. ${t.action}: ${t.detail}`).join('\n') : '(none yet — this is the first look)'}

Look at the screenshot and decide the NEXT single action toward the task.
Answer ONLY JSON, one of:
  {"action":"click","x":0-1000,"y":0-1000}
  {"action":"double_click","x":...,"y":...} | {"action":"right_click","x":...,"y":...}
  {"action":"type","text":"..."} — type into the focused field
  {"action":"key","keys":"enter"} or {"action":"hotkey","keys":"ctrl+s"}
  {"action":"scroll","amount":-3} (negative = down)
  {"action":"done","summary":"what was accomplished"}
Never type passwords or confirm payments — if the task requires that, answer {"action":"done","summary":"stopped: needs the user to enter credentials"}.
If the task is already complete, answer done. If it is impossible from this screen, answer done with why.`,
        system: 'You are a careful screen automation agent. One action at a time; look before acting; never guess coordinates that are not on the screenshot.',
        images: [{ mimeType: 'image/jpeg', data: shot.base64 }],
        timeoutMs: 120_000,
      }, SMART);

      let act: AgentAction;
      try {
        const cleaned = resultText(decision.text);
        act = JSON.parse(cleaned) as AgentAction;
      } catch {
        transcript.push({ step, action: 'parse-error', detail: decision.text.slice(0, 120) });
        return NextResponse.json({ ok: false, stopped: 'model did not answer in JSON', transcript, lastVision: decision.text.slice(0, 500) });
      }

      const actionName = String(act.action ?? 'done').toLowerCase();
      if (actionName === 'done') {
        transcript.push({ step, action: 'done', detail: String(act.summary ?? '') });
        return NextResponse.json({ ok: true, done: true, summary: act.summary ?? '', steps: step, transcript, seconds: Math.round((Date.now() - started) / 1000) });
      }

      const exec = await runAction(act);
      transcript.push({
        step,
        action: actionName,
        detail: actionName === 'type' ? `typed "${String(act.text ?? '').slice(0, 60)}"`
          : actionName === 'key' || actionName === 'hotkey' ? String(act.keys ?? '')
          : actionName === 'scroll' ? `scroll ${act.amount}`
          : `at ${act.x ?? ''},${act.y ?? ''}${exec.ok ? '' : ` — FAILED: ${exec.error ?? ''}`}`,
      });
      if (!exec.ok) {
        return NextResponse.json({ ok: false, stopped: `action failed at step ${step}`, transcript });
      }
      await new Promise((r) => setTimeout(r, 700)); // let the UI settle before the next look
      void lastVision;
    }

    return NextResponse.json({ ok: false, stopped: `step cap (${cap}) reached`, transcript, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (err) {
    console.error('[screen-agent]', err);
    return NextResponse.json({ error: String(err).slice(0, 300), seconds: Math.round((Date.now() - started) / 1000) }, { status: 500 });
  }
}

function resultText(text: string): string {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}
