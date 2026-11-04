import { readdir } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const modelsDir = path.join(process.cwd(), 'public', 'models');
    const files = await readdir(modelsDir);
    const models = files
      .filter(f => /\.(gltf|glb)$/i.test(f))
      .map(f => ({ file: f, name: f.replace(/\.(gltf|glb)$/i, '') }));
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
