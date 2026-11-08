'use strict';
// Operator-approved, model-only run. No native audio or production credentials.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {evaluate}=require('./intelligence-compatibility.cjs');
const {createServices}=require('./services.cjs');
async function main(){
  if(!process.argv.includes('--approved-quiet-window'))throw Error('Fresh operator authenticated idle confirmation required');
  const dir=path.resolve('dist',`Agent-Intelligence-Compatibility-${new Date().toISOString().replace(/[:.]/g,'-')}`);fs.mkdirSync(dir,{recursive:true});
  const start=Date.now(),checks=[];let busy=false;
  function check(){
    // Fail closed on observation errors; do not inspect credentials or process memory.
    const count=Number(execFileSync('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -LocalPort 8787 -State Established -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',timeout:8000}).trim());
    const gpu=execFileSync('nvidia-smi',['--query-gpu=memory.used,utilization.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:5000}).trim();
    const values=gpu.split(',').map(Number);checks.push({at:new Date().toISOString(),establishedGatewayConnections:count,gpuMiB:values[0],gpuUtilization:values[1]});
    if(!Number.isFinite(count)||count!==0||!values.every(Number.isFinite)||values[0]>7600)throw Error('Activity/resource guard stopped evaluation');
    if(Date.now()-start>600000)throw Error('Quiet-window evaluation bound exceeded');
  }
  check();
  // Inspect loaded models only; this does not initiate model generation.
  const ps=await fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(3000)});if(!ps.ok)throw Error('Ollama availability failed');
  const loaded=await ps.json();fs.writeFileSync(path.join(dir,'resources.json'),JSON.stringify({operatorAttested:{authenticated:true,ready:true,maintenance:true,activeSessions:0,queue:{active:0,pending:0},activeRelays:0,startingRelays:0},loadedModels:loaded.models?.map(m=>({name:m.name,size_vram:m.size_vram})),note:'Health and relay counts are operator-attested; TCP guard is conservative, not an authenticated session counter.'},null,2));
  const services=createServices({ollamaStreaming:true});
  const result=await evaluate({live:true,variants:['candidate','baseline'],beforeRequest:async()=>check(),llm:async(messages,signal,timing,delta)=>{
    const stop=new AbortController();let guardFailure;
    const timer=setInterval(()=>{if(busy)return;busy=true;try{check();}catch(e){guardFailure=e;stop.abort(e);}finally{busy=false;}},2500);
    try{return await services.llm(messages,AbortSignal.any([signal,stop.signal]),timing,delta);}
    catch(e){fs.appendFileSync(path.join(dir,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),error:guardFailure?.message||e.message})+'\n');throw e;}
    finally{clearInterval(timer);}
  }});
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(dir,'resource-checks.json'),JSON.stringify(checks,null,2));
  console.log(JSON.stringify({directory:dir,calls:result.calls,stopped:result.stopped,rows:result.rows.map(({raw,reply,customer,...r})=>r)},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
