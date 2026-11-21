const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(states){let reads=0,writes=0;const deps={'./database':{db:async()=>({query:async()=>{writes++;return {rows:[{id:'call'}],rowCount:1}}})},'./vicidial':{vicidialRequest:async(_s,_u,_k,fields)=>{assert.equal(fields.function,'agent_status');const result=states[Math.min(reads++,states.length-1)];if(result instanceof Error)throw result;return result;}},'./campaign-config':{parseVicidialTable:raw=>{const[h,r]=raw.trim().split('\n');return [Object.fromEntries(h.split('|').map((k,i)=>[k,r.split('|')[i]]))]}}};const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/vicidial-call-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>deps[n],m,m.exports);return {run:(overrides={})=>m.exports.observeNativeCustomer({id:'call',status:'ANSWERED',vicidial_call_id:'Y0316001655000402028',vicidial_agent_user:'78601',vicidial_lead_id:'234',transfer_status:'',...overrides},{id:'connection'},'key'),reads:()=>reads,writes:()=>writes};}
const active='status|callerid|lead_id\nINCALL|Y0316001655000402028|234',ready='status|callerid|lead_id\nREADY||234';
test('only an exact active caller ID and lead are eligible for hangup after audio closes',async()=>{
 const exact=fixture([active]);
 assert.equal((await exact.run()).customerActive,true);
 assert.equal(exact.writes(),0);
 const mismatch=fixture([active.replace('|234','|235')]);
 assert.equal((await mismatch.run()).customerActive,false);
 assert.equal(mismatch.writes(),0);
});
test('two matching native ended states confirm customer-end without native call control',async()=>{const f=fixture([ready,ready]);assert.equal((await f.run()).customerEnded,true);assert.equal(f.reads(),2);assert.equal(f.writes(),1)});
test('active calls, changing readbacks, unknown errors and unlinked audio never become falsely ended',async()=>{for(const states of [[active],[ready,active]]){const f=fixture(states);assert.equal((await f.run()).customerEnded,false);assert.equal(f.writes(),0)}const failed=fixture([Error('network')]);await assert.rejects(failed.run(),/network/);assert.equal(failed.writes(),0);const unlinked=fixture([ready]);assert.equal((await unlinked.run({vicidial_call_id:null})).linked,false);assert.equal(unlinked.reads(),0)});
test('provider-confirmed transfer detaches AI without falsely marking the human customer ended',async()=>{const f=fixture([ready]);const result=await f.run({transfer_status:'SUBMITTED'});assert.equal(result.transferSubmitted,true);assert.equal(result.customerEnded,undefined);assert.equal(f.reads(),0);assert.equal(f.writes(),0)});
