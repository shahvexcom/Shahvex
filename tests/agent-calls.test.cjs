const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies, fetchMock, transform = source => source) {
  const source = transform(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', code)(name => dependencies[name] ?? (name === "./vicidial-controls" ? { vicidialCallCommand: async () => null } : require(name)), mod, mod.exports, fetchMock);
  return mod.exports;
}

// A transaction-aware in-memory adapter: the second caller must wait at
// SELECT FOR UPDATE and see the first caller's committed active reservation.
function harness({ approved = true, provider = 'success', limit = 25, suppressed = false, schedule = null, setup = true } = {}) {
  let active = null, lock = Promise.resolve(), dials = 0, released = 0;
  const queries = [];
  const row = data => ({ rows: data ? [data] : [], rowCount: data ? 1 : 0 });
  const baseQuery = async (sql, args = []) => {
    queries.push({ sql, args });
    if (sql.startsWith('SELECT a.id FROM agents a WHERE a.id=$1')) { assert.match(sql, /voip_agent_assignments/); assert.match(sql, /script_assignments/); assert.match(sql, /vc.enabled=TRUE/); return row(setup ? {id:args[0]} : null); }
    if (sql.startsWith('SELECT is_enabled,start_time::text')) return row(schedule);
    if (sql.startsWith('SELECT id FROM agent_calls')) return row(active);
    if (sql.includes('SELECT a.name,a.daily_call_limit')) return row(approved ? { name: 'Test agent', daily_call_limit: limit, lead_headers: ['Customer Name', 'Phone Number'], lead_rows: [['Test customer', '+15555550123']], script_text: 'Test script', credential_id: 'test-credential', secret_ciphertext: 'encrypted', config: { outboundNumber: '+15555550456', connectionId: 'test-connection' } } : null);
    if (sql.startsWith('SELECT COUNT')) return row({ total: 0 });
    if (sql.startsWith('SELECT 1 FROM do_not_call')) return row(suppressed ? { found: true } : null);
    if (sql.startsWith('INSERT INTO lead_claims')) return row({ lead_number: args[0] });
    if (sql.startsWith('INSERT INTO agent_calls')) { active = { id: args[0], status: 'INITIATED' }; return row(active); }
    if (sql.includes("SET status='FAILED'")) { active = null; return row({ updated: true }); }
    return row(null);
  };
  const pool = {
    query: baseQuery,
    connect: async () => {
      let unlock;
      return {
        query: async (sql, args) => {
          if (sql.includes('FOR UPDATE')) {
            const previous = lock;
            lock = new Promise(resolve => { unlock = resolve; });
            await previous;
            return row({ id: args[0] });
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') { unlock?.(); unlock = null; return row(null); }
          return baseQuery(sql,args);
        },
        release: () => { released++; },
      };
    },
  };
  const fetchMock = async (url, options) => {
    if (url.includes('/call_control_applications/')) return Response.json({ data: { webhook_event_url: 'https://example.test/webhook' } });
    assert.equal(url, 'https://api.telnyx.com/v2/calls');
    assert(active, 'The active reservation must exist before sending a dial request');
    assert.equal(queries.at(-1).sql.startsWith('UPDATE lead_claims'), true);
    dials++;
    const body = JSON.parse(options.body);
    assert.equal(body.from, '+15555550456');
    assert.equal(body.to, '+15555550123');
    assert.equal(JSON.parse(Buffer.from(body.client_state, 'base64')).callId, active.id);
    if (provider === 'timeout') throw new Error('timeout');
    if (provider === 'rejected') return Response.json({}, { status: 422 });
    return Response.json({ data: { call_control_id: 'provider-id', call_session_id: 'session-id' } });
  };
  const service = load('lib/call-start.ts', { '@/lib/database': { db: async () => pool }, '@/lib/bpo-entitlements': { bpoEntitlements: async () => ({ calls: 1, minutes: 1 }), bpoLeadUsage: async () => ({ calls: 0, minutes: 0 }) }, '@/lib/credential-crypto': { decryptCredential: () => 'test-key' } }, fetchMock);
  return { ...service, dials: () => dials, active: () => active, released: () => released };
}

test('simultaneous agent/controller starts produce only one provider dial', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.startAgentCall('agent-a'), h.startAgentCall('agent-a')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.dials(), 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /already has a live/);
  await assert.rejects(h.startAgentCall('agent-a'), /already has a live/);
  assert.equal(h.released(), 3);
});

test('unapproved, daily-limited and suppressed leads cannot dial', async () => {
  for (const options of [{ approved: false }, { limit: 0 }, { suppressed: true }]) {
    const h = harness(options);
    await assert.rejects(h.startAgentCall('agent-a'));
    assert.equal(h.dials(), 0);
    assert.equal(h.released(), 1);
  }
});

test('a saved controller schedule no longer blocks a manually started call', async () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const currentHour = Number(parts.find(part => part.type === 'hour').value);
  const blockedHour = (currentHour + 2) % 24;
  const endHour = (blockedHour + 1) % 24;
  const schedule = { is_enabled: true, start_time: `${String(blockedHour).padStart(2, '0')}:00:00`, end_time: `${String(endHour).padStart(2, '0')}:00:00` };
  const h = harness({ schedule });
  await h.startAgentCall('agent-a');
  assert.equal(h.dials(), 1);
});

test('uncertain provider response retains the active reservation and blocks retry', async () => {
  const h = harness({ provider: 'timeout' });
  await assert.rejects(h.startAgentCall('agent-a'), /still being confirmed/);
  assert(h.active());
  await assert.rejects(h.startAgentCall('agent-a'), /already has a live/);
  assert.equal(h.dials(), 1);
});

test('explicit provider rejection marks the reservation failed', async () => {
  const h = harness({ provider: 'rejected' });
  await assert.rejects(h.startAgentCall('agent-a'), /HTTP 422/);
  assert.equal(h.active(), null);
});

// The standalone agent portal was deleted in 34f7744. Do not recreate it to satisfy stale tests.
const retiredAgentPortal = { skip: 'Agent portal/routes removed in commit 34f7744; current portals are controller and BPO' };
test('agent start derives identity from session, ignoring a supplied agent ID', retiredAgentPortal, async () => {
  let calledAs;
  const route = load('app/api/agent/calls/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test-session' }) }) },
    '@/lib/session': { AGENT_SESSION_COOKIE: 'agent', readSession: async () => ({ role: 'AGENT', agentId: 'owner' }) },
    '@/lib/regular-agent': { requireRegularAgent: async () => ({ role: 'AGENT', agentId: 'owner' }) },
    '@/lib/database': {},
    '@/lib/call-start': { startAgentCall: async id => { calledAs = id; return { id: 'call-id' }; }, CallStartError: Error },
    '@/lib/agent-call-detail': {},
  });
  const response = await route.POST(new Request('http://localhost/api/agent/calls', { method: 'POST', body: JSON.stringify({ action: 'start-agent', agentId: 'someone-else' }) }));
  assert.equal(response.status, 201);
  assert.equal(calledAs, 'owner');
});

test('other agents cannot read details, change notes or issue commands', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const pool = { query: async (sql, args) => {
    assert.match(sql, /agent_id=\$/);
    assert.equal(args.at(-1), 'owner');
    return { rows: [], rowCount: 0 };
  } };
  const dependencies = { '@/lib/database': { db: async () => pool }, '@/lib/bpo-entitlements': { bpoEntitlements: async () => ({ recordings: 1 }), bpoLeadUsage: async () => ({ recordings: 0 }) }, '@/lib/call-start': {}, '@/lib/credential-crypto': {} };
  const service = load('lib/agent-call-detail.ts', dependencies, () => { throw new Error('No provider requests allowed'); });
  assert.equal((await service.agentCallDetail(id, 'owner')).status, 404);
  assert.equal((await service.agentCallCommand({ id, action: 'hangup' }, 'owner')).status, 404);
  assert.equal((await service.saveAgentCallNotes({ id, notes: 'test' }, 'owner')).status, 404);
});

test('retired agent recording route enforces ownership', retiredAgentPortal, async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const dependencies = { '@/lib/database': { db: async () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) } };
  const recording = load('app/api/agent/calls/[id]/recording/route.ts', {
    ...dependencies,
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test-session' }) }) },
    '@/lib/session': { AGENT_SESSION_COOKIE: 'agent', readSession: async () => ({ role: 'AGENT', agentId: 'owner' }) },
    '@/lib/regular-agent': { requireRegularAgent: async () => ({ role: 'AGENT', agentId: 'owner' }) },
  });
  assert.equal((await recording.GET(new Request('http://localhost/recording'), { params: Promise.resolve({ id }) })).status, 404);
});

function dialer({ starting = false, liveCall = null, fetchMock = async () => Response.json({ callId: 'new-call' }) } = {}) {
  const React = require('react');
  const data = { ready: true, setup: { outbound_number: '+15555550456' }, liveCall, nextLead: { name: 'Test', number: '+15555550123' } };
  const states = [starting, '', false, data, 'ALL', ''];
  const navigations = [];
  const hooks = { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {}, useRef: value => ({ current: value }) };
  const mod = load('app/agent/page.tsx', {
    react: hooks,
    'next/navigation': { useRouter: () => ({ push: url => navigations.push(url) }) },
    'next/link': { default: props => React.createElement('a',props) },
    '@/public/logomax.png': {},
    '@/app/components/agent-leads-docs-loading': { AgentLeadsDocsLoading: () => null },
    '@/app/components/agent-recordings': { AgentRecordings: () => null },
    '@/app/components/agent-call-queue': { AgentCallQueue: () => null },
    '@/app/components/agent-dashboard': { AgentDashboard: () => null },
  }, fetchMock, source => source.replace('function CallDialerPage(', 'export function CallDialerPage('));
  const tree = mod.CallDialerPage({ loading: false });
  const buttons = [];
  const visit = element => {
    if (!element || typeof element !== 'object') return;
    if (Array.isArray(element)) return element.forEach(visit);
    if (element.type === 'button' && ['start-call-btn','outline-call-btn'].includes(element.props.className)) buttons.push(element);
    visit(element.props?.children);
  };
  visit(tree);
  return { tree, buttons, navigations };
}

test('both start buttons are disabled and announce loading while a request is pending', retiredAgentPortal, () => {
  const ui = dialer({ starting: true });
  assert.equal(ui.buttons.length, 2);
  for (const button of ui.buttons) { assert.equal(button.props.disabled, true); assert.equal(button.props['aria-busy'], true); }
});

test('a live call disables both start buttons even if readiness response is stale', retiredAgentPortal, () => {
  const ui = dialer({ liveCall: { id: 'active-call', status: 'ANSWERED', lead_name: 'Test', lead_number: '+15555550123' } });
  assert.equal(ui.buttons.length, 2);
  for (const button of ui.buttons) assert.equal(button.props.disabled, true);
});

test('rapid clicks submit only once and navigate to the returned agent call page', retiredAgentPortal, async () => {
  let submits = 0, complete;
  const ui = dialer({ fetchMock: async () => { submits++; return new Promise(resolve => { complete = resolve; }); } });
  const first = ui.buttons[0].props.onClick();
  const second = ui.buttons[1].props.onClick();
  assert.equal(submits, 1);
  complete(Response.json({ callId: 'new-call' }, { status: 201 }));
  await Promise.all([first,second]);
  assert.deepEqual(ui.navigations, ['/agent/calls/new-call']);
});

test('controller start rejects missing script or verified VoIP before contacting provider', async () => {
 const h = harness({ setup:false });
 await assert.rejects(h.startAgentCall('agent-1'), /script.*VoIP/);
 assert.equal(h.dials(), 0);
});

