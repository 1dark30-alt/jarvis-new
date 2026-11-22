/**
 * Finance OAuth callback server — local HTTPS on port 3443.
 *
 * Plaid requires an HTTPS redirect_uri outside Sandbox. This server serves
 * a tiny self-closing page at https://localhost:3443/finance-oauth — the
 * registered redirect — so Plaid Link's OAuth popup closes itself and the
 * Link session resumes inside Jarvis. The public token travels through
 * Plaid Link's onSuccess (in the app), not through this page.
 *
 * Certs: <vault>/certs/localhost{,-key}.pem (mkcert, trusted in Windows).
 *
 * Usage: node scripts/finance-oauth-server.cjs   (daemon — stays running)
 */

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3543;
const DATA = process.env.JARVIS_DATA_DIR || process.cwd();
const CERT_DIR = path.join(DATA, 'certs');

const certFile = path.join(CERT_DIR, 'localhost.pem');
const keyFile = path.join(CERT_DIR, 'localhost-key.pem');

if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
  console.error('Missing certificates at ' + CERT_DIR + ' — run mkcert first.');
  process.exit(1);
}

const CLOSE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Jarvis — Bank connected</title>
<style>body{background:#0a0f14;color:#eaf2f7;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.c{text-align:center;padding:40px 48px;border:1px solid rgba(52,211,153,.4);border-radius:16px}
h1{color:#34d399;font-size:20px;letter-spacing:.1em}p{color:rgba(255,255,255,.5);font-size:13px}</style></head>
<body><div class="c"><h1>✓ BANK CONNECTED</h1><p>Authorization complete — you can close this window.<br>Jarvis is saving the connection.</p></div>
<script>try{window.close()}catch(e){}</script></body></html>`;

const server = https.createServer(
  { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) },
  (req, res) => {
    if (req.url && req.url.startsWith('/finance-oauth')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(CLOSE_PAGE);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<script>window.close()</script>Bank OAuth callback — you can close this window.');
    }
  }
);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`finance-oauth server listening on https://localhost:${PORT}/finance-oauth`);
});