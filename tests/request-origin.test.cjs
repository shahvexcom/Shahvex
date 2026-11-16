const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync('lib/request-origin.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(m, m.exports);
const check = (origin, host = 'localhost:3000', extra = {}) => m.exports.isSameRequestOrigin(new Request('http://0.0.0.0:3000/api/admin/agent-test', { headers: { host, ...(origin ? { origin } : {}), ...extra } }));
test('accepts the browser host when Next uses its listening address internally', () => {
  assert.equal(check('http://localhost:3000'), true);
  assert.equal(check('http://127.0.0.1:3000', '127.0.0.1:3000'), true);
});
test('rejects foreign, missing, malformed, different port and different scheme origins', () => {
  for (const origin of [undefined, 'null', 'garbage', 'http://evil.example', 'http://localhost:4000', 'https://localhost:3000', 'http://localhost:3000/path']) assert.equal(check(origin), false);
  assert.equal(check('http://evil.example', 'localhost:3000', { 'x-forwarded-host': 'evil.example' }), false);
});
