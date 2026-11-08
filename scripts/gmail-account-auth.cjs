#!/usr/bin/env node
/**
 * gmail-account-auth.cjs — Add an EXTRA Gmail account to Jarvis.
 *
 * The Gmail MCP package (@gongrzhe/server-gmail-autoauth-mcp) is
 * single-account: one token file per server instance. Jarvis runs one
 * instance per account, so this helper performs the Google OAuth sign-in
 * for one additional account and stores its tokens in a dedicated file.
 *
 * Usage:
 *   node scripts/gmail-account-auth.cjs <label> [port]
 *
 *   <label>  account label, e.g. "work"  -> tokens saved to
 *            ~/.jarvis/gmail-mcp-work/tokens.json
 *   [port]   loopback port for the OAuth callback (default 3551;
 *            Desktop-type OAuth clients allow any localhost port)
 *
 * After a successful sign-in, register the account with Jarvis:
 *   POST /api/mcp/dynamic  { name: "gmail-<label>",
 *     command: "npx", args: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
 *     env: { GMAIL_OAUTH_PATH: <shared credentials>, GMAIL_CREDENTIALS_PATH: <token file> } }
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const label = process.argv[2];
if (!label || !/^[a-z0-9_-]{1,32}$/.test(label)) {
  console.error('Usage: node scripts/gmail-account-auth.cjs <label> [port]');
  console.error('  label: lowercase letters, numbers, dashes, underscores');
  process.exit(1);
}

const CREDENTIALS_FILE = path.join(os.homedir(), '.jarvis', 'google', 'credentials.json');
const TOKEN_DIR = path.join(os.homedir(), '.jarvis', `gmail-mcp-${label}`);
const TOKEN_FILE = path.join(TOKEN_DIR, 'tokens.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];
const WAIT_TIMEOUT_MS = 5 * 60 * 1000;

function readClient() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const keys = raw.installed ?? raw.web;
  if (!keys?.client_id || !keys?.client_secret) {
    throw new Error(`No Desktop OAuth client found in ${CREDENTIALS_FILE}`);
  }
  return keys;
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function postTokenEndpoint(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`token endpoint HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function getJson(url, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 },
      (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
          else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

(async () => {
  const keys = readClient();

  // Find a free loopback port (Google Desktop clients allow any localhost port).
  const basePort = Number(process.argv[3]) || 3551;
  let server;
  let port = basePort;
  for (let attempt = 0; attempt < 10; attempt++) {
    try { server = await listen(port); break; }
    catch { port++; }
  }
  if (!server) {
    console.error(`Could not bind a callback port between ${basePort} and ${port}`);
    process.exit(1);
  }

  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: keys.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES.join(' '),
    }).toString().replace(/\+/g, '%20');

  console.log(`\n[gmail-account-auth] account label: ${label}`);
  console.log(`[gmail-account-auth] token file:  ${TOKEN_FILE}`);
  console.log(`[gmail-account-auth] opening browser for Google sign-in...\n`);
  console.log(`  If it does not open, visit:\n  ${authUrl}\n`);
  console.log('  IMPORTANT: sign in with the EXTRA account for this label');
  console.log('  (not the account already connected as your main Gmail).\n');
  openBrowser(authUrl);

  const timeout = setTimeout(() => {
    console.error('[gmail-account-auth] timed out waiting for the browser callback');
    server.close();
    process.exit(1);
  }, WAIT_TIMEOUT_MS);

  server.on('request', async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end();
      return;
    }
    const error = url.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>Authorization failed</h1><p>Google error: ${error}</p>`);
      console.error(`[gmail-account-auth] Google returned an error: ${error}`);
      clearTimeout(timeout);
      server.close();
      process.exit(1);
    }
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>No code</h1>');
      return;
    }

    try {
      const tokens = await postTokenEndpoint({
        code,
        client_id: keys.client_id,
        client_secret: keys.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      fs.mkdirSync(TOKEN_DIR, { recursive: true });
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

      // Best-effort: report which account was just connected.
      let email = '(unknown)';
      try {
        const info = await getJson('https://www.googleapis.com/oauth2/v2/userinfo', tokens.access_token);
        email = info.email ?? email;
      } catch { /* userinfo requires the email scope; not fatal */ }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<h1 style="font-family:monospace;color:#34d399">Gmail account "${label}" connected</h1>` +
        `<p style="font-family:monospace;color:#888">Signed in as ${email}. You can close this tab.</p>`,
      );
      console.log(`[gmail-account-auth] SUCCESS: ${email}`);
      console.log(`[gmail-account-auth] tokens saved: ${TOKEN_FILE}`);
      clearTimeout(timeout);
      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>Token exchange failed</h1><pre>${err.message}</pre>`);
      console.error(`[gmail-account-auth] token exchange failed: ${err.message}`);
      clearTimeout(timeout);
      server.close();
      process.exit(1);
    }
  });
})();
