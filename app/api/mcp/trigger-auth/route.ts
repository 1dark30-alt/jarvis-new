import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import { getGoogleServiceRuntime } from '@/app/lib/mcp/google-service-runtime';
import fs from 'fs';

// Keep the auth process alive between requests so the OAuth callback server
// keeps listening even after this route returns.
let activeAuthProcess: ChildProcess | null = null;

export async function POST(req: NextRequest) {
  // Kill any previous auth attempt
  if (activeAuthProcess) {
    try { activeAuthProcess.kill(); } catch { /* ignore */ }
    activeAuthProcess = null;
  }

  let serviceId = 'calendar';
  try {
    const body = await req.json();
    serviceId = typeof body?.serviceId === 'string' ? body.serviceId : serviceId;
  } catch {
    // Backwards-compatible default for callers that send no JSON body.
  }

  const service = getGoogleServiceRuntime(serviceId);
  if (!service) {
    return NextResponse.json(
      { error: `Unknown Google service "${serviceId}"` },
      { status: 400 },
    );
  }

  if (!fs.existsSync(service.credentialsPath)) {
    return NextResponse.json(
      { error: `Missing shared Google credentials file at ${service.credentialsPath}` },
      { status: 400 },
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...service.env,
  };

  return new Promise<Response>((resolve) => {
    const proc = spawn(service.command, service.authArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeAuthProcess = proc;

    let accumulated = '';
    let settled = false;

    const settle = (body: Record<string, unknown>, status = 200) => {
      if (settled) return;
      settled = true;
      resolve(NextResponse.json(body, { status }));
    };

    const tryExtract = (chunk: string) => {
      accumulated += chunk;
      // Google OAuth consent screen URLs
      const match = accumulated.match(/https?:\/\/accounts\.google\.com[^\s"'\n\r]*/);
      if (match) {
        settle({ serviceId: service.id, authUrl: match[0] });
      }
      // Also handle localhost OAuth redirects (some implementations use this)
      const localMatch = accumulated.match(/http:\/\/localhost:\d+[^\s"'\n\r]*/);
      if (localMatch && !match) {
        settle({ serviceId: service.id, authUrl: localMatch[0] });
      }
    };

    proc.stdout?.on('data', (d: Buffer) => tryExtract(d.toString()));
    proc.stderr?.on('data', (d: Buffer) => tryExtract(d.toString()));

    proc.on('close', (code) => {
      activeAuthProcess = null;
      settle(
        settled
          ? { serviceId: service.id, done: true }
          : { serviceId: service.id, error: `Auth process exited (code ${code ?? '?'}) without a URL`, output: accumulated.slice(0, 600) },
        settled ? 200 : 500,
      );
    });

    proc.on('error', (err) => {
      activeAuthProcess = null;
      settle({ serviceId: service.id, error: err.message }, 500);
    });

    // Give the process 20 seconds to print an auth URL
    setTimeout(() => {
      settle(
        settled
          ? { serviceId: service.id, done: true }
          : { serviceId: service.id, error: 'Timed out waiting for auth URL', output: accumulated.slice(0, 600) },
        settled ? 200 : 408,
      );
    }, 20_000);
  });
}

// DELETE kills any running auth process (clean-up)
export async function DELETE() {
  if (activeAuthProcess) {
    try { activeAuthProcess.kill(); } catch { /* ignore */ }
    activeAuthProcess = null;
  }
  return NextResponse.json({ success: true });
}
