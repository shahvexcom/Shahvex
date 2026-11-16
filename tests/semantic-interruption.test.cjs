const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const wait=async predicate=>{const deadline=Date.now()+4000;while(!predicate()){if(Date.now()>deadline)throw Error('Timed out waiting for bridge');await new Promise(r=>setTimeout(r,10));}};
test('native playback continues for yeah/um and only a recognized question cancels it',{timeout:10000},async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-semantic-'));let socket,turns=0,interrupts=0,probes=0,bytes=0,kind='acknowledgment',text='Yeah.',lastText;
 const b=createBridge({siteUrl:'https://fixture.example/',connectionId:crypto.randomUUID(),secret:'isolated-semantic-secret-'.repeat(2),spoolDir:folder,testOnly:true,allowUnregisteredManualAudio:true,logger:()=>{},fetchImpl:async(_url,init)=>{
  const v=JSON.parse(init.body);
  if(v.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'ai'});
  if(v.action==='listen'){probes++;assert.ok(v.audio);return Response.json({text,kind});}
  if(v.action==='interrupt'){interrupts++;return Response.json({interrupted:true});}
  if(v.action==='turn'){turns++;lastText=v.text;const pcm=Buffer.alloc(144000);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(i%4?1500:-1500,i);return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:pcm.toString('base64')})+'\n'+JSON.stringify({type:'done'})+'\n');}
  return Response.json({saved:true});
 }});
 try{
  await new Promise(r=>b.audio.listen(0,'127.0.0.1',r));socket=net.connect(b.audio.address().port,'127.0.0.1');socket.on('data',chunk=>bytes+=chunk.length);socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));await wait(()=>bytes>0&&turns===1);
  const speak=()=>{const frame=Buffer.alloc(320);for(let i=0;i<320;i+=2)frame.writeInt16LE(i%4?2400:-2400,i);socket.write(Buffer.concat([...Array.from({length:12},()=>packet(0x10,frame)),...Array.from({length:38},()=>packet(0x10,Buffer.alloc(320)))]));};
  let before=bytes;speak();await wait(()=>probes===1);await new Promise(r=>setTimeout(r,60));assert.equal(interrupts,0);assert.equal(turns,1);assert.ok(bytes>before);
  kind='filler';text='Um.';before=bytes;speak();await wait(()=>probes===2);await new Promise(r=>setTimeout(r,60));assert.equal(interrupts,0);assert.equal(turns,1);assert.ok(bytes>before);
  kind='filler';text='Wait a second.';speak();await wait(()=>interrupts===1&&turns===2);assert.equal(lastText,'Wait a second.');
 }finally{socket?.destroy();b.close();await new Promise(r=>setTimeout(r,60));await b.flushEvents();fs.rmSync(folder,{recursive:true,force:true});}
});
