import { NextResponse } from 'next/server';
import { SkillManager } from '@/app/lib/skills/config-loader';

export async function GET() {
  try {
    const manager = SkillManager.getInstance();
    manager.initialize();
    const skills = manager.getSkills();
    const tools = manager.getTools();
    return NextResponse.json({ skills, tools });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
