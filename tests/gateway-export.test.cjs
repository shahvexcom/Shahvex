const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function route(role, rows) {
  const code = ts.transpileModule(fs.readFileSync('app/api/admin/agents/gateway-export/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} }; let queries = 0;
  const deps = {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture' }) }) },
    '@/lib/session': { ADMIN_SESSION_COOKIE: 'admin', readSession: async () => role ? { role } : null },
    '@/lib/database': { db: async () => ({ query: async (sql, values) => { queries++; assert.match(sql, /a.status='APPROVED'/); assert.match(sql, /NOT EXISTS/); assert.deepEqual(values, ['agent']); return { rows }; } }) },
  };
  new Function('require', 'module', 'exports', code)(name => deps[name], mod, mod.exports);
  return { GET: mod.exports.GET, queries: () => queries };
}
test('gateway agent export rejects non-controller identities before database access', async () => {
  for (const role of [null, 'AGENT', 'BPO']) {
    const r = route(role, []); assert.equal((await r.GET(new Request('http://localhost/?agentId=agent'))).status, 401); assert.equal(r.queries(), 0);
  }
});
test('gateway export contains only approved agent rehearsal configuration', async () => {
  const r = route('ADMIN', [{ name: 'Nadia', script_text: 'Assigned script', secret_ciphertext: 'must-not-export' }]);
  const response = await r.GET(new Request('http://localhost/?agentId=agent'));
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await response.json(), { agentName: 'Nadia', script: 'Assigned script', campaignId: 'website-rehearsal:agent', direction: 'inbound', voiceId: 'existing-chatterbox-default' });
  assert.equal((await route('ADMIN', []).GET(new Request('http://localhost/?agentId=agent'))).status, 404);
});
