'use strict';
// Separate temporary local tester + local candidate 8776. No production adapter.
process.env.SHAHVEX_LOCAL_FAST_TTS='1';
process.env.SHAHVEX_PHRASE_STREAM='1';
delete process.env.SHAHVEX_PC_AI_URL;
const {createTesterService}=require('../gateway/tester-service.cjs');
const crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs');
async function main(){
  if(process.env.SHAHVEX_LOCAL_NATIVE_SOAK!=='1')throw Error('Explicit local soak opt-in required');
  const candidate=await(await fetch('http://127.0.0.1:8776/candidate/health')).json();assert.equal(candidate.ready,true);
  const key=crypto.randomBytes(32).toString('hex'),{server}=createTesterService({secret:key});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,results=[];let id;
  async function call(action,body,extra={},signal){const r=await fetch(base+'/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':'local-native-soak','content-type':'application/json',...(id?{'x-shahvex-session':id}:{}),...extra},body:JSON.stringify(body),signal});assert.equal(r.status,200,`${action} HTTP ${r.status}`);return r;}
  try{
    const config={name:'Lauren',voice:'female_02',first:'customer',goal:'Help with appointments',task:'Answer clinic questions',instructions:'Use two short sentences. Do not confirm actual bookings.',script:'Consultation costs 2,000 PKR. The clinic opens Monday through Friday from 9 AM to 5 PM. Staff must confirm appointments.',knowledge:'',style:'Professional'};
    id=(await(await call('start',{agentId:'native-local-soak',config})).json()).id;
    const began=Date.now();
    for(let index=0;index<16;index++){
      const round=Date.now(),control=new AbortController();
      const r=await call('turn',{text:index%2?'Explain the clinic hours and confirmation process.':'What is the consultation fee and how is the appointment confirmed?'},{'x-shahvex-turn':`native-${index}`},control.signal);
      const reader=r.body.getReader(),decoder=new TextDecoder();let pending='',first=null,done=false;
      try{
        outer:while(true){const p=await reader.read();if(p.done)break;pending+=decoder.decode(p.value,{stream:true});let at;
          while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line)continue;const e=JSON.parse(line);assert.notEqual(e.type,'error',e.error);
            if(e.type==='pcm'&&first===null){first=Date.now()-round;if(index%3!==2){control.abort();break outer;}}
            if(e.type==='done')done=true;
          }
        }
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      assert.notEqual(first,null);
      if(index%3!==2)assert.equal((await(await call('interrupt',{})).json()).interrupted,true);else assert.ok(done);
      const row={round:index+1,firstPcmMs:first,interrupted:index%3!==2,elapsedSeconds:Math.round((Date.now()-began)/1000)};results.push(row);console.log('PASS '+JSON.stringify(row));
      fs.writeFileSync('.data/pc-ai/native-tts-compare/local-soak.json',JSON.stringify(results,null,2));
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,12000-(Date.now()-round))));
    }
    assert.ok(Date.now()-began>=180000);console.log('PASS >3-minute isolated local candidate with completed replies and mid-PCM cancellations');
  }finally{if(id)await call('stop',{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
