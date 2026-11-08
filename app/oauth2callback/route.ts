import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GOOGLE_CREDENTIALS_PATH } from '@/app/lib/mcp/dynamic-config';
import { getGoogleTokenPath } from '@/app/lib/mcp/google-service-runtime';

/**
 * Gmail OAuth callback handler.
 *
 * The Gmail MCP package (@gongrzhe/server-gmail-autoauth-mcp) runs its OAuth
 * callback server on http://localhost:3000/oauth2callback — the same port the
 * Jarvis app itself serves. While Jarvis is running, the package's callback
 * server cannot bind, so its auth process dies right after printing the
 * consent URL. Google then redirects the browser back to
 * localhost:3000/oauth2callback, which lands HERE.
 *
 * This route completes the flow on the package's behalf: it exchanges the
 * authorization code for tokens and writes them to the token path the Gmail
 * MCP server and the wizard's auth-status check both use.
 *
 * The Calendar MCP package binds its own callback server on ports 3500-3505,
 * so it never hits this route.
 */
export const dynamic = 'force-dynamic';

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

function htmlResponse(title: string, message: string, ok: boolean, status = 200): NextResponse {
  const color = ok ? '#34d399' : '#f87171';
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { background:#050810; color:#e5e7eb; font-family:ui-monospace,Consolas,monospace;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  .card { text-align:center; padding:40px 48px; border:1px solid rgba(255,255,255,.08);
          border-radius:16px; background:rgba(255,255,255,.03); }
  h1 { color:${color}; font-size:20px; margin:0 0 12px; letter-spacing:.1em; text-transform:uppercase; }
  p { color:rgba(255,255,255,.55); font-size:13px; margin:0; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get('error');
  if (error) {
    return htmlResponse(
      'Authorization failed',
      `Google returned an error: ${error}. You can close this tab and retry.`,
      false,
      400,
    );
  }

  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return htmlResponse(
      'No authorization code',
      'This page handles the Gmail OAuth callback. Nothing to do here.',
      false,
      400,
    );
  }

  // Load the shared Google OAuth client (Desktop app credentials).
  let clientId: string;
  let clientSecret: string;
  try {
    const raw = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, 'utf8'));
    const keys = raw?.installed ?? raw?.web;
    if (!keys?.client_id || !keys?.client_secret) {
      throw new Error('credentials.json is missing client_id/client_secret');
    }
    clientId = keys.client_id;
    clientSecret = keys.client_secret;
  } catch (err) {
    return htmlResponse(
      'Missing Google credentials',
      `Could not read the shared OAuth client at ${GOOGLE_CREDENTIALS_PATH}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      false,
      500,
    );
  }

  // Exchange the authorization code for tokens.
  let tokens: Record<string, unknown>;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    if (!res.ok) {
      return htmlResponse(
        'Token exchange failed',
        `Google rejected the authorization code (HTTP ${res.status}). ${body.slice(0, 300)}`,
        false,
        502,
      );
    }
    tokens = JSON.parse(body) as Record<string, unknown>;
  } catch (err) {
    return htmlResponse(
      'Token exchange failed',
      `Could not reach Google's token endpoint: ${err instanceof Error ? err.message : String(err)}`,
      false,
      502,
    );
  }

  // Route the tokens to the service that matches the GRANTED scopes — the
  // same callback serves both flows, and a calendar consent must never land
  // in the Gmail store (or the calendar server finds no valid account).
  const scope = String((tokens as { scope?: string }).scope ?? '');
  const serviceId: 'calendar' | 'gmail' = scope.includes('auth/calendar') ? 'calendar' : 'gmail';
  try {
    const tokenPath = getGoogleTokenPath(serviceId);
    // The @cocal calendar package manages its own MULTI-ACCOUNT store here
    // ("{normal: {...}, personal: {...}}"). Never overwrite it with a flat
    // single-account token — its auth command writes it itself.
    if (serviceId === 'calendar' && fs.existsSync(tokenPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as Record<string, unknown>;
        const isPackageStore = Object.values(existing).some(
          (v) => v && typeof v === 'object' && 'access_token' in (v as Record<string, unknown>)
        );
        if (isPackageStore) {
          return htmlResponse(
            'Calendar connected',
            'Google Calendar authorized — the account was registered by the calendar service itself. You can close this tab.',
            true,
          );
        }
      } catch { /* unreadable — fall through and write */ }
    }
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  } catch (err) {
    return htmlResponse(
      'Could not save tokens',
      `Authorized, but writing the token file failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      false,
      500,
    );
  }

  return htmlResponse(
    serviceId === 'calendar' ? 'Calendar connected' : 'Gmail connected',
    `${serviceId === 'calendar' ? 'Google Calendar' : 'Gmail'} is now authorized for Jarvis. You can close this tab and return to the app.`,
    true,
  );
}
