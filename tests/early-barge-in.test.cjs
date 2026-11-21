const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {setTimeout:wait}=require('node:timers/promises');
const {createBridge,packet}=require('../deployment/vicidial-bridge/server.cjs');
const {createTelephoneDownsampler}=require('../deployment/vicidial-bridge/audio-quality.cjs');

async function until(condition){
  const deadline=Date.now()+2000;
  while(!condition()){
    if(Date.now()>deadline)throw Error('Early barge-in was delayed');
    await wait(5);
  }
}

test('a priority phrase pauses native playback and an unconfirmed phrase resumes it',{timeout:10000},async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'early-barge-'));
  const openingPcm=Buffer.alloc(480000);
  for(let i=0;i<openingPcm.length;i+=2)openingPcm.writeInt16LE(1000+Math.floor(i/960)*20,i);
  const expectedPcm=createTelephoneDownsampler().push(openingPcm);
  const played=[];
  let pending=Buffer.alloc(0);
  let socket,text='Yeah.',interrupts=0,turns=0,probes=0,lastText;
  const bridge=createBridge({
    siteUrl:'https://fixture.example',
    connectionId:crypto.randomUUID(),
    secret:'early-barge-secret-'.repeat(3),
    spoolDir:folder,
    testOnly:true,
    allowUnregisteredManualAudio:true,
    logger:()=>{},
    fetchImpl:async(_url,init)=>{
      const event=JSON.parse(init.body);
      if(event.action==='connected')return Response.json({callId:crypto.randomUUID(),first:'ai'});
      if(event.action==='listen'){
        probes++;
        return Response.json({text,kind:'filler'});
      }
      if(event.action==='interrupt'){
        interrupts++;
        return Response.json({interrupted:true});
      }
      if(event.action==='turn'){
        turns++;
        lastText=event.text;
        return new Response(JSON.stringify({type:'pcm',sampleRate:24000,data:openingPcm.toString('base64')})+'\n'+JSON.stringify({type:'done'})+'\n');
      }
      return Response.json({saved:true});
    },
  });
  try{
    bridge.audio.listen(0,'127.0.0.1');
    await once(bridge.audio,'listening');
    socket=net.connect(bridge.audio.address().port,'127.0.0.1');
    socket.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);
      while(pending.length>=3){
        const size=pending.readUInt16BE(1);
        if(pending.length<3+size)break;
        if(pending[0]===0x10)played.push(pending.subarray(3,3+size));
        pending=pending.subarray(3+size);
      }
    });
    await once(socket,'connect');
    socket.write(packet(1,Buffer.from(crypto.randomUUID().replaceAll('-',''),'hex')));
    await until(()=>played.length>0);

    const voice=Buffer.alloc(320);
    for(let i=0;i<320;i+=2)voice.writeInt16LE(i%4?3000:-3000,i);
    const burst=Buffer.concat(Array.from({length:16},()=>packet(0x10,voice)));
    const silence=Buffer.concat(Array.from({length:38},()=>packet(0x10,Buffer.alloc(320))));
    socket.write(burst);
    await until(()=>probes>=1);
    assert.equal(interrupts,0);
    const before=played.length;
    await until(()=>played.length>before);

    text='Wait a second.';
    socket.write(burst);
    await until(()=>probes>=2);
    assert.equal(interrupts,0);
    assert.equal(turns,1,'do not answer before the caller finishes');
    await wait(60);
    const pausedFrames=played.length;
    await wait(100);
    assert.equal(played.length,pausedFrames,'old playback stays stopped while caller keeps the floor');

    text='Well.';
    socket.write(silence);
    await until(()=>probes>=3&&played.length>=pausedFrames+5);
    const checkedFrames=pausedFrames+5;
    assert.deepEqual(Buffer.concat(played.slice(0,checkedFrames)),expectedPcm.subarray(0,checkedFrames*320),
      'resumed PCM must continue at the next unsent frame');
    assert.equal(turns,1,'resume the existing stream without a new speech turn');
    assert.equal(interrupts,0);

    text='Wait a second.';
    socket.write(burst);
    await until(()=>probes>=4);
    socket.write(silence);
    await until(()=>turns===2);
    assert.equal(lastText,'Wait a second.');
    assert.equal(interrupts,1);
  }finally{
    socket?.destroy();
    bridge.close();
    await wait(40);
    await bridge.flushEvents();
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
