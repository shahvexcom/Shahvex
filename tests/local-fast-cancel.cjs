'use strict';
process.env.SHAHVEX_LOCAL_FAST_TTS='kokoro';process.env.SHAHVEX_PHRASE_STREAM='1';delete process.env.SHAHVEX_PC_AI_URL;
const {createTesterService}=require('../gateway/tester-service.cjs');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
async function main(){
 if(process.env.SHAHVEX_LOCAL_FAST_CANCEL!=='1')throw Error('Explicit local cancellation test opt-in required');
 const secret=crypto.randomBytes(32).toString('hex'),{dispatch}=createTesterService({secret});let id;
 const call=(action,body,signal)=>dispatch(new Request('http://127.0.0.1/tester/'+action,{method:'POST',signal,headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'fast-local-cancel','x-shahvex-session':id||'none','content-type':'application/json'},body:JSON.stringify(body)}));
 const config={name:'Local',voice:'af_heart',first:'customer',goal:'Answer clinic questions',task:'Answer clearly',instructions:'Reply in two sentences.',script:'Consultation costs 2,000 PKR. Staff must confirm appointment requests.',knowledge:'',style:'Professional'};
 id=(await(await call('start',{agentId:'cancel-local',config})).json()).id;
 try{for(let i=0;i<8;i++){
  const control=new AbortController(),response=await call('turn',{text:'Explain the consultation fee and appointment confirmation.'},control.signal);assert.equal(response.status,200);
  const reader=response.body.getReader();let seen=false,pending='';
  try{while(true){const p=await reader.read();if(p.done)break;pending+=Buffer.from(p.value).toString();if(pending.includes('"type":"error"'))throw Error('Turn failed');if(pending.includes('"type":"pcm"')){seen=true;control.abort();break;}}}finally{await reader.cancel().catch(()=>{});}
  assert.ok(seen);assert.equal((await call('interrupt',{})).status,200);
 }
 const last=await call('turn',{text:'What is the consultation fee?'});assert.equal(last.status,200);const events=(await last.text()).trim().split('\n').map(JSON.parse);assert.ok(events.some(e=>e.type==='done')&&!events.some(e=>e.type==='error'));
 console.log('PASS eight real mid-PCM interruptions followed by a complete reply; no BUSY stall');
 }finally{await call('stop',{});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
