const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const file = path.resolve('app/api/tts/route.ts');
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { POST } = loaded.exports;
const request = body => new Request('http://localhost/api/tts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const input = { provider: 'olares', baseUrl: 'https://router.example.olares.com/v1/', apiKey: 'test-key', text: 'Hello', model: 'Olares/Breeze-TTS-2' };

test('Breeze route validates configuration, preserves audio, and reports upstream failures', async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = async () => { throw new Error('Must not contact upstream'); };
    assert.equal((await POST(request({ provider: 'olares', text: 'Hello' }))).status, 400);
    assert.equal((await POST(request({ ...input, baseUrl: 'file:///tmp/model' }))).status, 400);
    assert.equal((await POST(request({ ...input, provider: 'typo' }))).status, 400);
    assert.equal((await POST(request({ ...input, text: 'a'.repeat(4097) }))).status, 400);
    for (const baseUrl of ['https://router.example.olares.com', 'https://router.example.olares.com/v1/']) {
      global.fetch = async (url, options) => {
        assert.equal(url, 'https://router.example.olares.com/v1/text-to-speech/en-m?output_format=mp3_44100_128');
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body), { model_id: input.model, text: 'Hello' });
        return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'audio/wav' } });
      };
      const response = await POST(request({ ...input, baseUrl }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'audio/wav');
      assert.match(response.headers.get('content-disposition'), /\.wav/);
      assert.equal((await response.arrayBuffer()).byteLength, 4);
    }
    global.fetch = async () => new Response('private upstream details', { status: 401 });
    const unauthorized = await POST(request(input));
    assert.equal(unauthorized.status, 502);
    assert.match((await unauthorized.json()).error, /HTTP 401/);
    global.fetch = async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } });
    assert.equal((await POST(request(input))).status, 502);
    global.fetch = async () => new Response('', { headers: { 'Content-Type': 'audio/mpeg' } });
    assert.equal((await POST(request(input))).status, 502);
  } finally { global.fetch = realFetch; }
});
