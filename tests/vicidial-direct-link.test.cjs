const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(statuses){let writes=0;const original={id:'call',agent_id:'agent',status:'ANSWERED',direct_audio_line:'3533',external_campaign_id:'DIALER'},connection={id:'connection',live_config:{directAudioLines:[{prefix:'3533',agentId:'agent',remoteUser:'78603'}],remoteUsers:['78603']}};let reads=0;
 const query=async(sql,p)=>{if(sql.startsWith('SELECT q.remote_user'))return {rows:[{remote_user:'78603'}]};writes++;assert.match(sql,/NOT EXISTS/);assert.equal(p[1],'Y0316001655000402028');return {rows:[{...original,vicidial_call_id:p[1],vicidial_lead_id:p[2]}]};};
 const m={exports:{}},deps={'./database':{db:async()=>({query})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial-config':{vicidialLiveConfig:{parse:x=>x}},'./campaign-config':{parseVicidialTable:s=>JSON.parse(s)},'./vicidial':{vicidialRequest:async(_s,_u,_k,f)=>JSON.stringify(f.function==='lead_all_info'?[{lead_id:'12',phone_number:'5551234567'}]:[statuses[Math.min(reads++,statuses.length-1)]])}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/vicidial-direct-link.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>deps[n],m,m.exports);
 return {run:()=>m.exports.linkDirectNativeCall(original,connection),writes:()=>writes,original};}
const native={status:'INCALL',campaign_id:'DIALER',lead_id:'12',callerid:'Y0316001655000402028'};
test('direct remote audio links only after stable native customer and exact campaign readback',async()=>{const f=fixture([native,native]);const c=await f.run();assert.equal(c.vicidial_call_id,native.callerid);assert.equal(f.writes(),1);});
test('READY, wrong campaign, or a changing native call cannot be linked or transferred',async()=>{for(const statuses of [[{...native,status:'READY'}],[{...native,campaign_id:'OTHER'}],[native,{...native,lead_id:'13'}]]){const f=fixture(statuses);assert.equal(await f.run(),f.original);assert.equal(f.writes(),0);}});

test('native-only hangup sends the historical call code and refuses an unlinked or transferred leg', async()=>{
 const call={id:'old-call',status:'ANSWERED',telephony_provider:'AUDIOSOCKET',vicidial_agent_user:'78603',vicidial_call_id:native.callerid};
 const commands=[];
 const deps={
  './database':{db:async()=>({query:async(sql,params)=>{
   assert.equal(params[0],call.id);
   return {rows:sql.startsWith('SELECT')?[call]:[]};
  }})},
  './credential-crypto':{decryptCredential:value=>value},
  './vicidial':{vicidialRequest:async(_server,_user,_key,fields)=>{
   commands.push(fields);
   return 'ERROR: no active call found';
  }},
  './vicidial-config':{},
  './vicidial-bridge':{requestBridge:async()=>assert.fail('Native-only hangup must not close AudioSocket')},
  './vicidial-results':{},
 };
 const m={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/vicidial-controls.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>deps[name],m,m.exports);
 const hangup=()=>m.exports.vicidialCallCommand(call.id,'hangup',undefined,false,true);
 assert.equal((await hangup()).status,200);
 assert.deepEqual(commands,[{function:'ra_call_control',agent_user:'78603',value:native.callerid,stage:'HANGUP'}]);
 call.transfer_status='SUBMITTED';
 assert.equal((await hangup()).status,409);
 call.transfer_status='';
 call.vicidial_call_id=null;
 const unlinked=await hangup();
 assert.equal(unlinked.status,409);
 assert.equal((await unlinked.json()).nativeHangupPending,true);
 assert.equal(commands.length,1);
});
