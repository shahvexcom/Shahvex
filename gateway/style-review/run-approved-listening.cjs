'use strict';
// One explicitly approved generic listening run. No service/configuration mutation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {makePlan,renderSample,saveSample}=require('./listening-harness.cjs');
const root=path.resolve(__dirname,'../../dist/Jennifer-Generic-Listening-v1');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
  if(!process.argv.includes('--user-browser-idle-confirmed'))throw Error('Fresh user authenticated-browser idle confirmation required');
  const token=process.env.SHAHVEX_GATEWAY_TOKEN;if(!token)throw Error('Existing credential unavailable');
  const plan=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8')),expected=makePlan();
  if(JSON.stringify(plan.samples)!==JSON.stringify(expected.samples)||plan.parserSha256!==expected.parserSha256||
    plan.order.length!==10||new Set(plan.order).size!==10||plan.order.some(id=>!plan.samples.some(s=>s.id===id)))throw Error('Approved plan/parser changed');
  for(const s of plan.samples)if(fs.readFileSync(path.join(root,'texts',s.id+'.txt'),'utf8')!==s.text+'\n')throw Error('Approved text changed');
  // Maintenance and relay counts are attested by the user's fresh signed-in browser check.
  // Direct authenticated health below refreshes readiness/session/queue checks, not browser state.
  async function guard(){
    const r=await fetch('http://127.0.0.1:8787/health',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(r.status!==200){await r.body?.cancel();throw Error('Authenticated Gateway health failed');}
    const h=await r.json();if(h.ready!==true||h.activeSessions!==0||h.queue?.active!==0||h.queue?.pending!==0)throw Error('Gateway readiness/idle changed');
    return {status:200,authenticated:true,ready:h.ready,activeSessions:h.activeSessions,queue:h.queue,
      maintenance:true,activeRelays:0,startingRelays:0};
  }
  await guard();
  fs.writeFileSync(path.join(root,'metrics','run-start.json'),JSON.stringify({at:new Date().toISOString(),
    userApproved:true,maintenanceAndRelaySource:'fresh user-confirmed authenticated browser check; not independently polled',
    gatewayGuard:'live authenticated health before each phrase',planSha256:sha(fs.readFileSync(path.join(root,'plan.json')))},null,2),{flag:'wx'});
  let current,requestMetadata;
  async function requestWav(body){
    const start=performance.now();requestMetadata={characters:body.text.length,atUnixMs:Date.now(),receivedBytes:0};
    const r=await fetch('http://127.0.0.1:8765/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});
    requestMetadata.status=r.status;requestMetadata.headersMs=performance.now()-start;
    requestMetadata.declaredBytes=r.headers.has('content-length')?Number(r.headers.get('content-length')):null;
    const chunks=[];let prefix=Buffer.alloc(0),dataStart=null;
    for await(const chunk of r.body){
      requestMetadata.firstBodyByteMs??=performance.now()-start;
      requestMetadata.receivedBytes+=chunk.length;if(requestMetadata.receivedBytes>4000000)throw Error('Body exceeds limit');
      chunks.push(Buffer.from(chunk));
      if(dataStart===null){prefix=Buffer.concat([prefix,Buffer.from(chunk)]);if(prefix.length>=12){
        for(let off=12;off+8<=prefix.length;){const size=prefix.readUInt32LE(off+4);if(prefix.toString('ascii',off,off+4)==='data'){dataStart=off+8;break;}off+=8+size+(size%2);}
      }}
      if(dataStart!==null&&requestMetadata.receivedBytes>=dataStart+2)requestMetadata.firstPcmTransportMs??=performance.now()-start;
    }
    requestMetadata.bodyCompleteMs=performance.now()-start;
    const wav=Buffer.concat(chunks);return {status:r.status,wav,...requestMetadata};
  }
  try{
    for(const id of plan.order){
      current=plan.samples.find(s=>s.id===id);const requests=[];
      const result=await renderSample(current,{approved:true,guard,requestWav:async body=>{
        const r=await requestWav(body);requests.push({...requestMetadata});return r;
      }});
      result.metrics.requests=requests;result.metrics.completeSynthesisAndTransferMs=result.metrics.segments.reduce((n,s)=>n+s.requestMs,0);
      result.metrics.firstPcmTransportMs=requests[0].firstPcmTransportMs??null;
      result.metrics.transportErrors=0;result.metrics.nativeInferenceMs=null;
      saveSample(root,current,result);
      console.log(JSON.stringify({sample:id,firstPcmTransportMs:result.metrics.firstPcmTransportMs,firstPlayableMs:result.metrics.firstPlayableMs,totalWallMs:result.metrics.totalWallMs}));
    }
    await guard();fs.writeFileSync(path.join(root,'metrics','run-complete.json'),JSON.stringify({at:new Date().toISOString(),completedSamples:10,transportErrors:0},null,2),{flag:'wx'});
  }catch(e){
    const failure={sample:current?.id,errorType:e.name,causeCode:e.cause?.code??e.code??null,request:requestMetadata,
      noRetry:true,nativeWorkDrain:'If timeout/disconnect occurred, no subsequent request is issued; native drain remains unverified.'};
    fs.writeFileSync(path.join(root,'metrics','run-failure.json'),JSON.stringify(failure,null,2),{flag:'wx'});console.error(JSON.stringify(failure));process.exitCode=1;
  }
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({stopped:true,errorType:e.name,reason:e.message}));process.exitCode=1;});
