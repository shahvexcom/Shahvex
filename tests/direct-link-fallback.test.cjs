const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture({changes=false,wrongLead=false}={}){
 let fallback=0,writes=0,reads=0;
 const call={id:'call',agent_id:'agent',status:'ANSWERED',direct_audio_line:'3548',external_campaign_id:'DIALER'};
 const state={status:'INCALL',campaign_id:'DIALER',lead_id:'12',callerid:'Y0316001655000402028'};
 const deps={'./database':{db:async()=>({query:async(sql,args)=>{if(sql.startsWith('SELECT'))return {rows:[{remote_user:'78618'}]};writes++;return {rows:[{...call,vicidial_call_id:args[1]}]};}})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial-config':{vicidialLiveConfig:{parse:x=>x}},'./campaign-config':{parseVicidialTable:x=>x==='ERROR'?[]:JSON.parse(x)},'./vicidial':{vicidialRequest:async(_s,_u,_k,p)=>p.function==='lead_all_info'?'ERROR':JSON.stringify([{...state,...(++reads>1&&changes?{lead_id:'99'}:{})}])},'./vicidial-admin-lead':{readAdminLead:async()=>{fallback++;return {lead_id:wrongLead?'99':'12',phone_number:'5551234567'};}}};
 const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/vicidial-direct-link.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>deps[n],m,m.exports);
 return {run:()=>m.exports.linkDirectNativeCall(call,{id:'connection',live_config:{remoteUsers:['78618'],directAudioLines:[{prefix:'3548',agentId:'agent',remoteUser:'78618'}]}}),counts:()=>({fallback,writes}),call};
}
test('a rejected lead API still permits the existing verified read-only fallback',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.vicidial_call_id,'Y0316001655000402028');assert.deepEqual(f.counts(),{fallback:1,writes:1});
});
test('fallback cannot link a different lead or a native customer that changed during readback',async()=>{
 for(const options of [{wrongLead:true},{changes:true}]){const f=fixture(options);assert.equal(await f.run(),f.call);assert.equal(f.counts().writes,0);}
});
