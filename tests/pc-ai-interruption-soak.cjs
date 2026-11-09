'use strict';
// Explicit local real-engine soak; uses the running authenticated adapter.
const fs=require('node:fs');
const assert=require('node:assert/strict');
async function main(){
  if(process.env.SHAHVEX_LIVE_PC_SOAK!=='1')throw Error('Explicit live soak opt-in required');
  const key=fs.readFileSync('.data/pc-ai/.env.pc-ai','utf8').split(/\r?\n/).find(l=>l.startsWith('SHAHVEX_PC_AI_SECRET=')).split('=')[1];
  const owner='interruption-soak',base='http://127.0.0.1:8774';
  const health=await fetch('http://127.0.0.1:8767/health',{signal:AbortSignal.timeout(5000)});
  assert.equal(health.status,200,'TTS must be ready before soak');
  const warm=await fetch('http://127.0.0.1:8767/synthesize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Ready.',voice_id:'male_01'}),signal:AbortSignal.timeout(60000)});
  assert.equal(warm.status,200,'Voice warmup failed');await warm.arrayBuffer();
  async function call(action,body,id,signal,turn){
    const r=await fetch(base+'/tester/'+action,{method:'POST',signal,headers:{'content-type':'application/json','x-shahvex-ai-key':key,'x-shahvex-owner':owner,...(id?{'x-shahvex-session':id}:{}),...(turn?{'x-shahvex-turn':turn}:{})},body:JSON.stringify(body)});
    assert.equal(r.status,200,`${action}: HTTP ${r.status}`);return r;
  }
  const config={name:'Soak Agent',voice:'male_01',first:'customer',goal:'Answer clinic questions',task:'Answer briefly',instructions:'Use two short sentences.',script:'Clinic hours are Monday to Friday from nine AM to five PM. Staff must confirm appointment requests.',knowledge:'',style:'Professional'};
  const {id}=await(await call('start',{agentId:'soak',config})).json();
  const started=Date.now();
  try{
    for(let index=0;index<16;index++){
      const round=Date.now(),control=new AbortController();
      const r=await call('turn',{text:'Tell me the opening hours and how appointments are confirmed.'},id,control.signal,`soak-${index}`);
      const reader=r.body.getReader(),decoder=new TextDecoder();let pending='',pcm=false,done=false;
      try{
        outer:while(true){const part=await reader.read();if(part.done)break;pending+=decoder.decode(part.value,{stream:true});let at;
          while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line)continue;const event=JSON.parse(line);assert.notEqual(event.type,'error',event.error);
            if(event.type==='pcm'){pcm=true;if(index%3!==2){control.abort();break outer;}}
            if(event.type==='done')done=true;
          }
        }
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      assert.ok(pcm,'No PCM');
      if(index%3!==2){const result=await(await call('interrupt',{},id)).json();assert.equal(result.interrupted,true);}
      else assert.ok(done,'Turn did not complete');
      console.log(`PASS round ${index+1}/16: ${index%3!==2?'interrupted and released':'completed'}; elapsed ${Math.round((Date.now()-started)/1000)}s`);
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,12000-(Date.now()-round))));
    }
    assert.ok(Date.now()-started>=180000);
    console.log('PASS >3-minute real-engine session with repeated mid-PCM interruptions and completed turns');
  }finally{await call('stop',{},id);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
