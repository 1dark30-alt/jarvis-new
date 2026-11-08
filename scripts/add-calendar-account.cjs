/**
 * Add a Google account to the calendar MCP server's multi-account store.
 *
 * Usage: node scripts/add-calendar-account.cjs <nickname>
 *
 * Starts the @cocal/google-calendar-mcp auth flow for a new account, opens
 * the consent screen in the default browser, and polls until the account is
 * registered — the auth server stays alive the whole time, so the OAuth
 * callback (on its own port) is never left hanging.
 *
 * Exit codes: 0 registered · 2 window ended without registration · 1 error.
 */

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const nick = process.argv[2];
if (!nick) {
  console.error('Usage: node scripts/add-calendar-account.cjs <nickname>');
  process.exit(1);
}

const env = {
  ...process.env,
  HOME: os.homedir(),
  XDG_CONFIG_HOME: path.join(os.homedir(), '.jarvis'),
  GOOGLE_OAUTH_CREDENTIALS: path.join(os.homedir(), '.jarvis', 'google', 'credentials.json'),
};

const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npx -y @cocal/google-calendar-mcp'], {
  env, stdio: ['pipe', 'pipe', 'pipe'],
});

const log = (m) => console.log(m);
const fs = require('fs');
const URL_FILE = path.join(process.env.TEMP || os.tmpdir(), `calendar-add-${process.argv[2] ?? 'acct'}.url.txt`);

/** Open a URL in the default browser — via PowerShell, because cmd's `start`
 *  eats the & separators and Google receives a truncated URL. */
function openBrowser(url) {
  spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}
let buf = '';
let authStarted = false;
let registered = false;

const call = (id, name, args) =>
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args ?? {} } }) + '\n');

const finish = (code) => {
  try { child.kill(); } catch { /* ignore */ }
  process.exit(code);
};

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    // Registration check (poll results, ids >= 10)
    if (msg.id >= 10) {
      const text = msg.result?.content?.[0]?.text;
      try {
        const j = JSON.parse(text);
        const found = (j.accounts ?? []).find((a) => a.account_id === nick);
        if (found && found.status === 'active') {
          registered = true;
          log(`REGISTERED ✓ ${found.email} (${found.calendar_count} calendars)`);
          finish(0);
        }
      } catch { /* keep polling */ }
      continue;
    }

    if (msg.id !== 2) continue;
    const text = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg.result);
    try {
      const j = JSON.parse(text);
      if (j.auth_url && !authStarted) {
        authStarted = true;
        log(`Consent screen opening for account "${nick}" — sign in with the OTHER Google account.`);
        try { fs.writeFileSync(URL_FILE, j.auth_url); } catch { /* best effort */ }
        openBrowser(j.auth_url);
        // Poll for registration every 5 s for up to 5 minutes.
        let polls = 0;
        const poll = setInterval(() => {
          polls++;
          if (polls > 60) { clearInterval(poll); log('WINDOW ENDED — account not registered in time.'); finish(2); }
          call(10 + polls, 'manage-accounts', { action: 'list' });
        }, 5000);
      } else {
        log('add said: ' + text.slice(0, 300));
        finish(1);
      }
    } catch {
      log(text.slice(0, 200));
    }
  }
});

child.stderr.on('data', (d) => {
  const m = /https:\/\/accounts\.google\.com[^\s"']+/.exec(d.toString());
  if (m && !authStarted) {
    authStarted = true;
    log('Consent screen opening (from stderr) — sign in with the OTHER Google account.');
    try { fs.writeFileSync(URL_FILE, m[0]); } catch { /* best effort */ }
    openBrowser(m[0]);
    let polls = 0;
    const poll = setInterval(() => {
      polls++;
      if (polls > 60) { clearInterval(poll); log('WINDOW ENDED — account not registered in time.'); finish(2); }
      call(10 + polls, 'manage-accounts', { action: 'list' });
    }, 5000);
  }
});

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'jarvis-setup', version: '1' } } }) + '\n');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
setTimeout(() => { call(2, 'manage-accounts', { action: 'add', account_id: nick }); }, 3000);