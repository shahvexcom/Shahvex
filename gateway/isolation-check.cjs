'use strict';
const { backendClient } = require('./backend-client.cjs');
const { localUrl } = require('./services.cjs');
async function check({ baseUrl = 'http://127.0.0.1:18787', token, config }) {
  localUrl(baseUrl); const client = backendClient({ baseUrl, token });
  let a, b;
  const remove = async session => fetch(new URL(`/sessions/${session.id}`, baseUrl), { method: 'DELETE', headers: { Authorization: `Bearer ${session.sessionToken}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  try {
    a = await client.create(config); await client.close(a);
    b = await client.create(config);
    // Sequential sessions respect the physical GPU's one-session admission limit.
    const stale = await remove({ id: b.id, sessionToken: a.sessionToken });
    if (stale.status !== 401) throw Error('Prior session token crossed the session boundary');
    const root = await remove({ id: b.id, sessionToken: token });
    if (root.status !== 403) throw Error('Service token substituted for scoped session token');
    await client.close(b); b = null;
    return { passed: true, staleTokenRejected: true, serviceTokenScoped: true, cleanup: true };
  } finally { if (b) await client.close(b); }
}
if (require.main === module) {
  try {
    const config = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
    check({ baseUrl: process.env.SHAHVEX_GATEWAY_URL, token: process.env.SHAHVEX_GATEWAY_TOKEN, config })
      .then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { check };
