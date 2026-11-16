const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
function load(deps){const module={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/live-monitor-settings.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>deps[name]||require(name),module,module.exports);return module.exports;}
function harness(owner='owner-a'){
  const scripts=new Map(),queries=[];
  const api=load({'./database':{db:async()=>({query:async(sql,args)=>{queries.push({sql,args});if(sql.startsWith('INSERT'))scripts.set(args[0],args[1]);return {rows:scripts.has(args[0])?[{initial_script:scripts.get(args[0])}]:[]};}})},'./voip-controller':{principal:async()=>owner},'./agent-script-details':{defaultInitialScript:'Built-in initial script'}});
  return {api,scripts,queries};
}
const request=body=>new Request('http://localhost/api/admin/live-monitor/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('settings require authorized VoIP access before querying or saving',async()=>{
  const h=harness(null);
  assert.equal((await h.api.monitorSettings('admin')).status,403);
  assert.equal((await h.api.monitorSettings('bpo',request({initialScript:'Customer greeting'}))).status,403);
  assert.equal(h.queries.length,0);
});
test('saved scripts are scoped to the authenticated owner and survive reload',async()=>{
  const h=harness();h.scripts.set('other-owner','Private script');
  assert.equal((await (await h.api.monitorSettings('admin')).json()).initialScript,'Built-in initial script');
  const saved=await h.api.monitorSettings('admin',request({initialScript:'  Introduce yourself, then listen to the customer.  '}));
  assert.equal(saved.status,200);
  assert.equal(h.scripts.get('owner-a'),'Introduce yourself, then listen to the customer.');
  assert.equal(h.scripts.get('other-owner'),'Private script');
  assert.equal((await (await h.api.monitorSettings('admin')).json()).initialScript,h.scripts.get('owner-a'));
  assert.ok(h.queries.every(q=>q.args[0]==='owner-a'));
});
test('blank, excessive and owner-spoofed script updates are rejected',async()=>{
  const h=harness();
  for(const body of [{initialScript:' '},{initialScript:'x'.repeat(16001)},{initialScript:'A valid greeting script',owner_id:'other-owner'}])assert.equal((await h.api.monitorSettings('bpo',request(body))).status,400);
  assert.equal(h.queries.length,0);
});
