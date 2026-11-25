'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { Client } = require('pg');

for (const file of ['.env', '.env.production.local', '.env.local']) {
  if (!fs.existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadServerModule(name) {
  const ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', name + '.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    name => name === 'server-only' ? {} : require(name), module, module.exports,
  );
  return module.exports;
}

async function main() {
  const ids = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!Array.isArray(ids) || !ids.every(id => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))) {
    throw Error('Invalid call IDs');
  }
  if (!ids.length) return process.stdout.write('{}\n');

  const db = new Client({
    connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
    connectionTimeoutMillis: 5000,
    options: '-c default_transaction_read_only=on -c statement_timeout=15000',
  });
  let rows;
  try {
    await db.connect();
    await db.query('BEGIN READ ONLY');
    ({ rows } = await db.query(`
      SELECT a.id, a.ended_at, a.outcome, a.vicidial_call_id, v.server_url, v.username, v.secret_ciphertext
      FROM agent_calls a LEFT JOIN voip_connections v ON v.id=a.voip_connection_id
      WHERE a.id::text=ANY($1::text[]) AND a.status IN ('COMPLETED','FAILED')
    `, [ids]));
    await db.query('ROLLBACK');
  } finally {
    await db.end();
  }

  const { decryptCredential } = loadServerModule('credential-crypto');
  const { vicidialRequest } = loadServerModule('vicidial');
  const results = {};
  async function lookup(row) {
    const result = results[row.id] = { final_status: null, ended_at: row.ended_at, website_outcome: row.outcome || null };
    if (!row.vicidial_call_id || !row.secret_ciphertext) return;
    try {
      const body = await vicidialRequest(row.server_url, row.username, decryptCredential(row.secret_ciphertext), {
        function: 'callid_info', call_id: row.vicidial_call_id, stage: 'pipe', header: 'YES', detail: 'YES',
      }, false, 4500);
      const [header, data] = body.trim().split(/\r?\n/).map(line => line.split('|'));
      const status = data?.[header.indexOf('status')];
      if (data?.[header.indexOf('call_id')] === row.vicidial_call_id && /^[A-Z0-9_]{1,12}$/i.test(status || '')) {
        result.final_status = status.toUpperCase();
      }
    } catch {
      // A later read-only poll can retry inaccessible reports.
    }
  }
  for (let offset = 0; offset < rows.length; offset += 4) {
    await Promise.all(rows.slice(offset, offset + 4).map(lookup));
  }
  process.stdout.write(JSON.stringify(results) + '\n');
}

main().catch(error => {
  process.stderr.write(`Read-only call status poll failed (${error.code || error.name})\n`);
  process.exitCode = 1;
});
