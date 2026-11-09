'use strict';
// Uses local credentials without logging headers, secrets, URLs with tokens or bodies.
const fs=require('node:fs');
const path=require('node:path');
const {loadEnvConfig}=require('@next/env');
async function main(){
  loadEnvConfig(path.resolve(__dirname,'..'));
  const local=fs.readFileSync(path.resolve(__dirname,'../.data/pc-ai/.env.pc-ai'),'utf8');
  const key=local.split(/\r?\n/).find(line=>line.startsWith('SHAHVEX_PC_AI_SECRET='))?.slice('SHAHVEX_PC_AI_SECRET='.length);
  const id=process.env.SHAHVEX_CF_CLIENT_ID,secret=process.env.SHAHVEX_CF_CLIENT_SECRET;
  if(!key||!id||!secret)throw Error('Required local PC/Cloudflare credentials are not configured');
  const headers={'CF-Access-Client-Id':id,'CF-Access-Client-Secret':secret,'x-shahvex-ai-key':key};
  const health=await fetch('https://ai.shahvex.com/engine/8767/health',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  console.log('Authenticated engine health HTTP:',health.status);
  if(!health.ok){await health.body?.cancel();throw Error('Authenticated tunnel engine check failed');}
  const data=await health.json();if(!data.status)throw Error('Unexpected engine health response');
  const session=await fetch('https://ai.shahvex.com/tester/stop',{method:'POST',headers:{...headers,'x-shahvex-owner':'deployment-verification','x-shahvex-session':'nonexistent-verification','content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await session.json();
  if(session.status!==404||typeof result.error!=='string'||!result.error.includes('expired'))throw Error('Tester routing verification failed');
  console.log('Authenticated tester route verified; unknown session rejected');
  if(process.argv.includes('--phrase')){
    const owner='phrase-release-verification';let sessionId;
    const config={name:'Verification',voice:'male_02',first:'customer',goal:'Answer briefly',task:'Repeat requested wording exactly',instructions:'Repeat the supplied sentence exactly, including the comma. No preamble.',script:'Clinic consultation fee is 2,000 PKR. Staff must confirm appointments.',knowledge:'',style:'Professional'};
    const post=(action,body,extra={})=>fetch('https://ai.shahvex.com/tester/'+action,{method:'POST',headers:{...headers,'x-shahvex-owner':owner,'content-type':'application/json',...extra},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(90000)});
    try{
      const started=await post('start',{agentId:'phrase-release-verification',config});if(!started.ok)throw Error('Verification session could not start');
      sessionId=(await started.json()).id;
      const response=await post('turn',{text:'The consultation fee for your first clinic visit is 2,000 PKR, and our staff will confirm the appointment.'},{'x-shahvex-session':sessionId,'x-shahvex-turn':'release-check'});
      if(!response.ok)throw Error('Verification turn failed');
      const events=(await response.text()).trim().split('\n').map(JSON.parse);
      if(!events.some(e=>e.type==='timing'&&e.stage==='first-speakable-phrase')||!events.some(e=>e.type==='pcm')||!events.some(e=>e.type==='done')||events.some(e=>e.type==='error'))throw Error('Phrase-mode streaming verification failed');
      console.log('Public tunnel verified: approved phrase mode, real streamed PCM and completed turn');
    }finally{if(sessionId){const stopped=await post('stop',{}, {'x-shahvex-session':sessionId});await stopped.body?.cancel();}}
  }
}
main().catch(()=>{console.error('Tunnel verification failed. Check local credential presence, Access policy and tunnel routing; no credentials were printed.');process.exitCode=1;});
