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
}
main().catch(()=>{console.error('Tunnel verification failed. Check local credential presence, Access policy and tunnel routing; no credentials were printed.');process.exitCode=1;});
