const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),ts=require('typescript');
const {start}=require('../../../tools/persistent-local-audio.cjs');
const {signature,packet}=require('../deployment/vicidial-bridge/server.cjs');
const secret='local-test-only-voice-selection-secret';
const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
async function signed(port,agent,key=secret){const method=agent?'POST':'GET',body=agent?JSON.stringify({agent}):'',stamp=String(Date.now());return fetch(`http://127.0.0.1:${port}/local-monitor`,{method,headers:{'content-type':'application/json','x-shahvex-timestamp':stamp,'x-shahvex-signature':signature(key,stamp,method,'/local-monitor',Buffer.from(body))},...(agent?{body}:{})});}
const initial=()=>({name:'Lissa',voice:'lissa',first:'customer',script:'Use your configured name. Ask whether the audio is clear.'});
test('incoming local calls use each selected voice; authenticated selections persist and active calls block changes',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-voice-select-')),configPath=path.join(folder,'config.json'),requests=[];
 const config={enabled:true,secret,audioHost:'127.0.0.1',audioPort:0,controlPort:0,stateDirectory:folder,allowUnregisteredAudio:true,agent:initial()};
 fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const server=await start(config,{configPath,request:async(action,init)=>{
  if(action==='start'){requests.push(JSON.parse(init.body));return Response.json({id:crypto.randomUUID(),derivedFromScript:true});}
  return Response.json({stopped:true});
 }});let socket;
 try{
  const port=server.bridge.control.address().port;
  assert.equal((await signed(port,null,'wrong-key')).status,401);
  for(const id of ['lissa','emma','olivia']){
   const agent={...initial(),name:id[0].toUpperCase()+id.slice(1),voice:id};
   assert.equal((await signed(port,agent)).status,200);
   assert.equal(JSON.parse(fs.readFileSync(configPath)).agent.voice,id);
   const expected=requests.length+1;
   socket=net.connect(server.bridge.audio.address().port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));
   socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));
   await wait(()=>requests.length===expected);
   assert.equal(requests.at(-1).config.voice,id);assert.equal(requests.at(-1).config.name,agent.name);
   const blocked=await signed(port,{...agent,voice:id==='lissa'?'emma':'lissa'});
   assert.equal(blocked.status,400);assert.match((await blocked.json()).error,/Finish the current local call/);
   assert.equal(JSON.parse(fs.readFileSync(configPath)).agent.voice,id);
   socket.destroy();socket=undefined;
   await wait(async()=>{await server.bridge.flushEvents();return !(await(await signed(port)).json()).calls.some(c=>c.status==='ANSWERED');});
  }
  const invalid=await signed(port,{...initial(),voice:'af_heart'});assert.equal(invalid.status,400);
  assert.equal((await(await signed(port)).json()).agent.voice,'olivia');
 }finally{socket?.destroy();await server.close();fs.rmSync(folder,{recursive:true,force:true});}
});
test('failed selection persistence restores the old in-memory agent',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-voice-failure-'));
 const server=await start({enabled:true,secret,audioHost:'127.0.0.1',audioPort:0,controlPort:0,stateDirectory:folder,agent:initial()},{configPath:path.join(folder,'missing','config.json'),request:async()=>Response.json({})});
 try{assert.throws(()=>server.monitor({agent:{...initial(),voice:'emma',name:'Emma'}}));assert.equal(server.monitor().agent.voice,'lissa');assert.equal(server.monitor().agent.name,'Lissa');}finally{await server.close();fs.rmSync(folder,{recursive:true,force:true});}
});
function apiHarness({allowed=true,owner='owner',row={initial_script:'Use your configured name and answer naturally.',local_url:'http://127.0.0.1:8792',local_secret_ciphertext:'stored-secret'}}={}){
 const m={exports:{}},queries=[];
 const deps={'./database':{db:async()=>({query:async(sql,args)=>{queries.push({sql,args});return {rows:[row]};}})},'./voip-controller':{principal:async()=>owner},'./credential-crypto':{encryptCredential:v=>'encrypted:'+v,decryptCredential:()=>secret},'./agent-script-details':{defaultInitialScript:'Default initial script'},'./local-voice-registry':{savedVoiceCatalog:async id=>{assert.equal(id,'owner');return {voices:allowed?[{id:'lissa'},{id:'emma'},{id:'olivia'}]:[]};}}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/local-monitor-connection.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>deps[n]||require(n),m,m.exports);return {api:m.exports,queries};
}
const req=(voice,extra={})=>new Request('http://localhost/api/admin/live-monitor/local',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body:JSON.stringify({url:'http://127.0.0.1:8792',name:'Voice agent',voice,first:'ai',...extra})});
test('website API forwards all three approved choices using the authenticated owner and rejects unknown, unapproved or spoofed choices',async()=>{
 const original=global.fetch,requests=[];
 global.fetch=async(url,init)=>{requests.push({url,init});const {agent}=JSON.parse(init.body);return Response.json({testOnly:true,calls:[],agent});};
 try{
  for(const voice of ['lissa','emma','olivia']){const h=apiHarness();const response=await h.api.localMonitorConnection('admin',req(voice));assert.equal(response.status,200);assert.equal(JSON.parse(requests.at(-1).init.body).agent.voice,voice);assert.equal(h.queries.at(-1).args[0],'owner');}
  const prior=requests.length;
  assert.equal((await apiHarness().api.localMonitorConnection('admin',req('af_heart'))).status,400);
  assert.equal((await apiHarness().api.localMonitorConnection('admin',req('emma',{owner:'foreign'}))).status,400);
  assert.equal((await apiHarness({allowed:false}).api.localMonitorConnection('bpo',req('emma'))).status,403);
  assert.equal((await apiHarness({owner:null}).api.localMonitorConnection('admin',req('emma'))).status,403);
  const cross=req('emma');cross.headers.set('origin','https://other.example');assert.equal((await apiHarness().api.localMonitorConnection('admin',cross)).status,403);
  assert.equal(requests.length,prior);
 }finally{global.fetch=original;}
});
