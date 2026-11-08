const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const env = {
  ...process.env,
  HOME: os.homedir(),
  XDG_CONFIG_HOME: path.join(os.homedir(), '.jarvis'),
  GOOGLE_OAUTH_CREDENTIALS: path.join(os.homedir(), '.jarvis', 'google', 'credentials.json'),
};
const nick = process.argv[2];
const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npx -y @cocal/google-calendar-mcp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let authStarted = false;
let polls = 0;
const call = (id, name, args) =>
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args ?? {} } }) + '\n');
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 2) {
      const text = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg.result);
      try {
        const j = JSON.parse(text);
        if (j.auth_url && !authStarted) {
          authStarted = true;
          console.log('AUTH_URL:' + j.auth_url);
          console.log('Consent screen requested — browser should open; sign in with the ' + nick + ' account.');
          const poll = setInterval(() => { polls++; call(10 + polls, 'manage-accounts', { action: 'list' }); }, 5000);
          setTimeout(() => { clearInterval(poll); console.log('WINDOW ENDED — account not registered yet'); child.kill(); process.exit(2); }, 240000);
        } else if (j.accounts) {
          const found = (j.accounts ?? []).find((a) => a.account_id === nick);
          if (found && found.status === 'active') {
            console.log('REGISTERED ✓ ' + found.email + ' (' + found.calendar_count + ' calendars)');
            child.kill(); process.exit(0);
          }
        } else {
          console.log('add said:', text.slice(0, 300));
        }
      } catch { console.log(text.slice(0, 200)); }
    } else if (msg.id >= 10) {
      const text = msg.result?.content?.[0]?.text;
      try {
        const j = JSON.parse(text);
        const found = (j.accounts ?? []).find((a) => a.account_id === nick);
        if (found && found.status === 'active') {
          console.log('REGISTERED ✓ ' + found.email + ' (' + found.calendar_count + ' calendars)');
          child.kill(); process.exit(0);
        }
      } catch { /* keep polling */ }
    }
  }
});
child.stderr.on('data', (d) => {
  const m = /https:\/\/accounts\.google\.com[^\s"']+/.exec(d.toString());
  if (m && !authStarted) { authStarted = true; console.log('AUTH_URL:' + m[0]); }
});
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }) + '\n');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
setTimeout(() => { call(2, 'manage-accounts', { action: 'add', account_id: nick }); }, 3000);
