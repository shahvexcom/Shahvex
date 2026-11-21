'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createBridge,signature}=require('./deployment/vicidial-bridge/server.cjs');
async function start(config){
 const origin=new URL(config.websiteUrl);
 if(origin.origin!=='http://127.0.0.1:3000'||origin.pathname!=='/')throw Error('Use the local website origin');
 const logicalSite='https://native.shahvex.invalid/';
 const callback=async(url,init)=>{
  const target=new URL(url);
  if(target.origin!=='https://native.shahvex.invalid'||target.pathname!=='/api/telephony/vicidial')throw Error('Invalid local callback destination');
  const response=await fetch(new URL(target.pathname,origin),{...init,redirect:'error'});
  const action=JSON.parse(Buffer.from(init.body).toString()).action;
  if(action==='connected'||(!response.ok&&action!=='maintenance'))console.log(`Campaign callback ${action}: HTTP ${response.status}`);
  return response;
 };
 const resolveRegistration=async (uuid,signal)=>{
  const body=Buffer.from(JSON.stringify({action:'resolve-prefix',eventId:crypto.randomUUID(),externalCallId:uuid.replaceAll('-',''),audioUuid:uuid}));
  for(let attempt=0;attempt<3;attempt++){
   const stamp=String(Date.now());
   const response=await callback(new URL('/api/telephony/vicidial',logicalSite),{method:'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{'content-type':'application/json','x-shahvex-connection':config.connectionId,'x-shahvex-timestamp':stamp,'x-shahvex-signature':signature(config.secret,stamp,'POST','/api/telephony/vicidial',body)},body});
   if(response.ok)return response.json();
   const failure=await response.json().catch(()=>({}));
   console.log(`Direct prefix ${uuid.slice(0,4)} rejected: HTTP ${response.status}; ${typeof failure.error==='string'?failure.error.slice(0,140):'no details'}`);
   if(response.status!==409)break;
   if(attempt<2)await new Promise(r=>setTimeout(r,400));
  }
  throw Error('Direct audio line has no verified ready campaign call');
 };
 const enforceInitialSilence=process.env.SHAHVEX_INITIAL_SILENCE_GUARD==='1';
 const runtime=path.join(__dirname,'.silero-runtime');
 const {loadSilero}=require('./deployment/vicidial-bridge/initial-audio.cjs');
 const createSpeechScorer=enforceInitialSilence ? await loadSilero(path.join(runtime,'silero_vad.onnx'),require(path.join(runtime,'node_modules/onnxruntime-node'))) : undefined;
 const bridge=createBridge({createSpeechScorer,enforceInitialSilence,siteUrl:logicalSite,connectionId:config.connectionId,secret:config.secret,spoolDir:config.stateDirectory,maxCalls:config.maxCalls,fetchImpl:callback,resolveRegistration:config.directAudio===true?resolveRegistration:undefined});
 const listen=(server,port,host)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
 return (async()=>{
  try{await listen(bridge.control,config.controlPort,'127.0.0.1');await listen(bridge.audio,config.audioPort,config.audioHost);}catch(e){bridge.close();throw e;}
  const close=()=>{bridge.close();};process.once('SIGTERM',close);process.once('SIGINT',close);
  console.log(`Production campaign bridge ready: ${config.maxCalls} configured lines; control ${config.controlPort}; audio ${config.audioPort}`);
  return bridge;
 })();
}
if(require.main===module)start(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))).catch(()=>{console.error('Production campaign bridge startup failed; check protected configuration and bound ports');process.exitCode=1;});
module.exports={start};
