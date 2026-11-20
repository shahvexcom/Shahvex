const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),ts=require('typescript');
const {createBridge,packet,signature}=require('../deployment/vicidial-bridge/server.cjs');
const {FLOW_REVISION}=require('../gateway/conversation-resume.cjs');
function callback(source){const c=crypto.randomUUID(),deps={'./database':{db:async()=>({query:async()=>({rows:[{id:c,bridge_secret_ciphertext:'fixture',secret_ciphertext:'fixture',enabled:true,live_config:{enabled:true}}]})})},'./credential-crypto':{decryptCredential:x=>x},'./vicidial-bridge':{verifyBridgeSignature:()=>true},'./vicidial-config':{vicidialLiveConfig:{parse:x=>x}},'../gateway/conversation-resume.cjs':{FLOW_REVISION}};const m={exports:{}};new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{const n=name.replace(/\.ts$/,'');return Object.hasOwn(deps,n)?deps[n]:n==='zod'?require('zod'):n.startsWith('node:')?require(n):{};},m,m.exports);return {c,run:m.exports.vicidialCallback};}
test('reported signed-schema failure is reproduced and current callback accepts either final-flag format',async()=>{
 const source=fs.readFileSync('lib/vicidial-callback.ts','utf8');
 for(const legacy of [true,false]){const fixture=callback(legacy?source.replace('turnFinal:z.boolean().optional(),',''):source);
 for(const final of [false,true]){const response=await fixture.run(new Request('http://fixture/api/telephony/vicidial',{method:'POST',headers:{'x-shahvex-connection':fixture.c},body:JSON.stringify({action:'listen',eventId:crypto.randomUUID(),externalCallId:crypto.randomUUID().replaceAll('-',''),...(final?{turnFinal:true}:{})})}));assert.equal(response.status,400);assert.equal((await response.json()).error,legacy&&final?'Invalid event':'Call ID required');if(!legacy)assert.equal(response.headers.get('x-shahvex-callback-revision'),FLOW_REVISION);}
 }
});
test('public route pins the exact updated TS callback rather than an extensionless alias',async()=>{
 const m={exports:{}};let imported;
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/api/telephony/vicidial/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{imported=name;return {vicidialCallback:async()=>Response.json({pinned:true})};},m,m.exports);
 assert.equal(imported,'../../../../lib/vicidial-callback.ts');assert.deepEqual(await(await m.exports.POST(new Request('http://fixture',{method:'POST'}))).json(),{pinned:true});
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f){for(let i=0;i<300;i++){if(f())return;await wait(10);}throw Error('Timed out');}
test('bridge omits the unneeded strict-schema flag and records real response worker revision without a timing event',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'compat-v12-')),secret='compat-v12-secret-'.repeat(4);let socket,heard=false,fallbacks=0,rejected=0;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret,spoolDir:dir,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
 const e=JSON.parse(init.body);
 if(e.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'customer',mediaReady:true});
 if(e.action==='listen'){if('turnFinal' in e){rejected++;return Response.json({error:'Invalid event'},{status:400});}return Response.json({text:'Hello'});}
 if(e.action==='turn'){if(e.audio)fallbacks++;if(e.text==='Hello')heard=true;return new Response('{"type":"done","turnId":"compat-v12"}\n',{headers:{'x-shahvex-flow-revision':FLOW_REVISION}});}
 return Response.json({saved:true});
 }});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));await new Promise(r=>b.control.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('error',()=>{});socket.on('data',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(70);
 const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?2400:-2400,i);socket.write(Buffer.concat([...Array.from({length:10},()=>packet(0x10,voice)),...Array.from({length:18},()=>packet(0x10,Buffer.alloc(320)))]));await until(()=>heard);await wait(40);
 const stamp=String(Date.now()),health=await(await fetch('http://127.0.0.1:'+b.control.address().port+'/health',{headers:{'x-shahvex-timestamp':stamp,'x-shahvex-signature':signature(secret,stamp,'GET','/health',Buffer.alloc(0))}})).json();assert.equal(rejected,0);assert.equal(fallbacks,0);assert.equal(health.streams[0].voiceFlowRevision,FLOW_REVISION);assert.equal(health.streams[0].speechProbeFailures,0);
 }finally{socket?.destroy();b.close();await wait(60);fs.rmSync(dir,{recursive:true,force:true});}
});
