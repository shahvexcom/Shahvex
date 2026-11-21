const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('a brief input burst followed by suppressed silence is finalized and cannot freeze the conversation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'input-gap-')),uuid='3531'+crypto.randomUUID().slice(4),external='direct-'+uuid.replaceAll('-','');let socket,heartbeats,started=false,release,probes=0,interrupts=0,heardAudio,offset=0;const steps=[],realNow=Date.now;Date.now=()=>realNow()+offset;
 const b=createBridge({siteUrl:'https://fixture.invalid/',connectionId:crypto.randomUUID(),secret:'input-gap-fixture-'.repeat(4),spoolDir:dir,logger:()=>{},resolveRegistration:async()=>({uuid,audioUuid:uuid,externalCallId:external,agentUser:'78601'}),fetchImpl:async(_url,init)=>{const v=JSON.parse(init.body);if(v.action==='connected')return Response.json({callId:crypto.randomUUID(),mediaReady:true});if(v.action==='turn'&&v.opening){return new Response(new ReadableStream({start(controller){release=()=>{try{controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));controller.close();}catch{}};controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'pcm',sampleRate:24000,data:Buffer.alloc(4800,3).toString('base64')})+'\n'));started=true;init.signal.addEventListener('abort',release,{once:true});}}));}if(v.action==='listen'){probes++;heardAudio=Buffer.from(v.audio,'base64');return Response.json({text:'',kind:'ignore'});}if(v.action==='turn'){steps.push(v.silenceStep);return new Response((v.silenceStep===3?'{"type":"end_call","reason":"no_response"}\n':'')+'{"type":"done"}\n');}if(v.action==='interrupt')interrupts++;return Response.json({saved:true});}});
 try{await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',()=>{});socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')));for(let i=0;i<100&&!started;i++)await wait(5);assert.ok(started);const voice=Buffer.alloc(320);for(let i=0;i<320;i+=2)voice.writeInt16LE(2200,i);const quiet=Buffer.alloc(320);
 for(let i=0;i<320;i+=2)quiet.writeInt16LE(1350,i);
 const send=(frame,count)=>socket.write(Buffer.concat(Array.from({length:count},()=>packet(0x10,frame))));
 send(quiet,30);
 await wait(40);
 assert.equal(probes,0,'isolated below-threshold audio must not reach recognition');
 send(voice,12);
 send(quiet,15);
 await wait(40);assert.equal(probes,0);heartbeats=setInterval(()=>{if(!socket.destroyed)socket.write(packet(0x10,Buffer.alloc(0)));},5);await wait(30);offset+=500;await wait(80);assert.equal(probes,1,'Missing audio packets must finalize the buffered utterance');assert.equal(heardAudio.length,44+(5+12+15)*640,'The classifier must receive only the captured audio, without invented silence');
 const blockStartSample=index=>heardAudio.readInt16LE(44+index*640);
 assert.deepEqual(Array.from({length:32},(_,index)=>blockStartSample(index)),[
   ...Array(5).fill(1350), ...Array(12).fill(2200), ...Array(10).fill(1350), ...Array(5).fill(0),
 ],'STT receives 100 ms of raw pre-roll and 200 ms of hangover before the gate closes');assert.equal(interrupts,0);release();await wait(180);const closed=new Promise(r=>socket.once('close',r));offset+=25000;await wait(150);assert.equal(socket.destroyed,false);offset+=6000;await Promise.race([closed,wait(1000).then(()=>{throw Error('No-response call stayed open');})]);assert.ok(steps.length<=1);

 }finally{clearInterval(heartbeats);release?.();socket?.destroy();b.close();await wait(100);await b.flushEvents();Date.now=realNow;fs.rmSync(dir,{recursive:true,force:true});}
});
