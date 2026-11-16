const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
  const m = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', source)(name => name === 'node:crypto' ? { randomUUID: () => 'mapping-id' } : require(name), m, m.exports);
  return m.exports;
}
const { suggestedCampaignAgents } = load('lib/campaign-agent-selection.ts');
const { saveAgentCampaign, saveAgentCampaignPreference } = load('lib/agent-campaign-assignment.ts');
test('preselection matches category and external ID, excluding active calls and assigned agents', () => {
  const agents = [
    { id: 'category', preferred_category_id: 'cat' },
    { id: 'external', preferred_campaign_id: 'C01' },
    { id: 'both', preferred_category_id: 'cat', preferred_campaign_id: 'C01' },
    { id: 'wrong-category', preferred_category_id: 'other', preferred_campaign_id: 'C01' },
    { id: 'wrong-id', preferred_category_id: 'cat', preferred_campaign_id: 'C02' },
    { id: 'busy', preferred_category_id: 'cat', call_id: 'live' },
    { id: 'assigned', preferred_category_id: 'cat', campaign_id: 'old', enabled: true },
    { id: 'disabled-assigned', preferred_category_id: 'cat', campaign_id: 'old', enabled: false },
    { id: 'none' },
  ];
  assert.deepEqual(suggestedCampaignAgents(agents, 'cat', 'C01'), ['category', 'external', 'both']);
  assert.deepEqual(suggestedCampaignAgents(agents, null, 'C01'), ['external']);
});
test('campaign assignment saves the owned mapping and connection atomically in caller transaction', async () => {
  const calls = [];
  const tx = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT * FROM campaign_definitions')) return { rows: [{ id: 'new', connection_id: 'connection', external_campaign_id: 'C01' }] };
    if (sql.startsWith('INSERT INTO campaign_agent_assignments')) return { rows: [{ agent_id: 'agent' }], rowCount: 1 };
    return { rows: [] };
  } };
  await saveAgentCampaign(tx, 'agent', 'owner', 'new');
  const mapping = calls.find(call => call.sql.startsWith('INSERT INTO campaign_agent_assignments'));
  assert.match(mapping.sql, /AND campaign_agent_assignments.campaign_id=EXCLUDED.campaign_id/);
  assert.doesNotMatch(mapping.sql, /SET campaign_id=/);
  assert.match(mapping.sql, /owner_id=EXCLUDED.owner_id/);
  assert.deepEqual(mapping.values, ['agent', 'new', 'owner']);
  assert.deepEqual(calls.at(-1).values, ['mapping-id', 'owner', 'agent', 'connection', 'C01']);
});
test('active calls prevent changing campaign mappings', async () => {
  const writes = [];
  await assert.rejects(saveAgentCampaign({ query: async sql => {
    if (sql.includes('ai_agent_runtime_states')) return { rows: [{ agent_id: 'agent' }] };
    if (!sql.startsWith('SELECT')) writes.push(sql);
    return { rows: [] };
  } }, 'agent', 'owner', 'new'), /active call/);
  assert.deepEqual(writes, []);
});
test('preferences reject categories outside the owner account', async () => {
  const calls = [];
  await assert.rejects(saveAgentCampaignPreference({ query: async sql => { calls.push(sql); return { rows: [] }; } }, 'agent', 'owner', 'foreign', 'C01'), /owned category/);
  assert.equal(calls.length, 1);
});
test('unassigning clears the campaign while preserving the same owner VoIP connection', async () => {
  const calls = [];
  await saveAgentCampaign({ query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } }, 'agent', 'owner', '');
  const deletes = calls.filter(call => call.sql.startsWith('DELETE'));
  assert.equal(deletes.length, 1);
  const routeUpdate=calls.find(call=>call.sql.startsWith('UPDATE voip_agent_assignments'));assert.match(routeUpdate.sql,/SET campaign_id=''/);assert.match(routeUpdate.sql,/owner_id=\$2/);assert.deepEqual(routeUpdate.values,['agent','owner']);
  assert.ok(!calls.some(call=>call.sql.startsWith('DELETE FROM voip_agent_assignments')));
  for (const call of deletes) { assert.match(call.sql, /owner_id=\$2/); assert.deepEqual(call.values, ['agent', 'owner']); }
});

test('existing assignments block moving agents, including disabled assignments, after locking the agent', async () => {
  for (const enabled of [true, false]) {
    const calls = [];
    await assert.rejects(saveAgentCampaign({ query: async sql => {
      calls.push(sql);
      if (sql.startsWith('SELECT campaign_id,owner_id')) return { rows: [{ campaign_id: 'old', owner_id: 'owner', enabled }] };
      return { rows: [] };
    } }, 'agent', 'owner', 'new'), /Remove its current assignment first/);
    assert.match(calls[0], /FOR UPDATE/);
    assert.ok(calls.every(sql => sql.startsWith('SELECT')));
  }
});
test('saving the same campaign is allowed', async () => {
  await saveAgentCampaign({ query: async sql => {
    if (sql.startsWith('SELECT campaign_id,owner_id')) return { rows: [{ campaign_id: 'new', owner_id: 'owner' }] };
    if (sql.startsWith('SELECT * FROM campaign_definitions')) return { rows: [{ id: 'new', connection_id: 'conn', external_campaign_id: 'C01' }] };
    return { rows: [], rowCount: 1 };
  } }, 'agent', 'owner', 'new');
});
