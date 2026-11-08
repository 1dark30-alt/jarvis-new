const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const spoken = [];
const file = path.resolve('app/lib/local-voice.ts');
const loaded = new Module(file, module);
loaded.filename = file; loaded.paths = module.paths;
loaded.require = name => name === './breeze-speech' ? {
  BreezeSpeaker: class { stop() {} async speak(text) { spoken.push(text); } },
} : require(name);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { LocalVoice } = loaded.exports;
const settings = { localLlmProvider: 'olares', localLlmUrl: 'https://router.example.olares.com/v1',
  localLlmApiKey: 'test', localLlmModel: 'Olares/local-model', initialPrompt: 'Be concise.' };

test('local conversation transcribes, maintains context, and speaks; cancelled turns stay silent', async () => {
  const original = global.fetch;
  const transcript = [], phases = [], requests = [];
  const callbacks = { phase: value => phases.push(value), transcript: (...value) => transcript.push(value),
    error: value => assert.fail(value), level() {} };
  const voice = new LocalVoice(settings, callbacks);
  try {
    global.fetch = async (url, options) => {
      requests.push(url);
      if (url === '/api/stt') return Response.json({ text: 'Hello Jarvis' });
      assert.equal(url, '/api/local-llm');
      const body = JSON.parse(options.body);
      assert.equal(body.model, settings.localLlmModel);
      assert.equal(body.provider, 'olares');
      return Response.json({ reply: 'Hello, how can I help?' });
    };
    await voice.respond(new Blob(['audio']), 0);
    assert.deepEqual(requests, ['/api/stt', '/api/local-llm']);
    assert.deepEqual(spoken, ['Hello, how can I help?']);
    assert.equal(transcript.length, 2);
    assert.equal(voice.messages.length, 2);
    assert.equal(phases.at(-1), 'Listening — speak, then pause');
    let finish;
    global.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = voice.respond(new Blob(['audio']), 0);
    voice.stop();
    finish(Response.json({ text: 'This turn was cancelled' }));
    await pending;
    assert.equal(spoken.length, 1);
    assert.equal(transcript.length, 2);
  } finally { voice.stop(); global.fetch = original; }
});
