import { NextRequest, NextResponse } from 'next/server';
import {
  remember, forget, searchMemory, promptBlock, panelData,
  listProjects, createProject, selectProject, deleteEntry, activeProject, deleteProject,
} from '../../lib/server/memoryStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get('op') ?? 'panel';
  if (op === 'core') {
    // The block appended to the session's system prompt.
    return NextResponse.json({ block: promptBlock(), activeProject: activeProject() });
  }
  return NextResponse.json(panelData());
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();
    const project = a.project ? String(a.project) : undefined;

    switch (op) {
      case 'remember':
        return NextResponse.json({ message: remember({
          key: String(a.key ?? ''), value: String(a.value ?? ''),
          category: a.category ? String(a.category) : undefined,
          project, source: a.source ? String(a.source) : undefined,
        }) });

      case 'forget':
        return NextResponse.json({ message: forget(String(a.key ?? ''), a.category ? String(a.category) : undefined, project) });

      case 'search':
        return NextResponse.json({ results: searchMemory(String(a.query ?? ''), project) });

      case 'project_list':
        return NextResponse.json(listProjects());

      case 'project_create':
        return NextResponse.json({ message: createProject(String(a.name ?? ''), a.folder ? String(a.folder) : undefined, a.context ? String(a.context) : undefined) });

      case 'project_select':
        return NextResponse.json({ message: selectProject(String(a.name ?? '')) });

      case 'project_delete':
        return NextResponse.json({ message: deleteProject(String(a.name ?? '')) });

      case 'entry_delete':
        return NextResponse.json({ ok: deleteEntry(String(a.category ?? ''), String(a.key ?? '')) });

      default:
        return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[memory]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}