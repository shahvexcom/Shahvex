'use strict';
// Explicitly approved authored-text benchmark; no production file/configuration writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildPlan}=require('./prepare-concise-ab.cjs');
const {renderSample}=require('./listening-harness.cjs');
const {decodeWav}=require('../wav.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const root=path.resolve(__dirname,'../../dist/Jennifer-Concise-AB-v1');
async function main(){
  if(!process.argv.includes('--approved-with-fresh-browser-check'))throw Error('Explicit native approval and fresh signed-in health confirmation required');
  const token=process.env.SHAHVEX_GATEWAY_TOKEN;if(!token)throw Error('Existing Gateway credential unavailable');
  const publicPlan=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8'));
  const privatePlan=JSON.parse(fs.readFileSync(path.join(root,'private-key','blind-key.json'),'utf8'));
  const plan={...publicPlan,trials:privatePlan.trials},expected=buildPlan(publicPlan.seed);
  if(JSON.stringify(plan)!==JSON.stringify(expected))throw Error('Plan/text/parser drift');
  for(const t of plan.texts)if(fs.readFileSync(path.join(root,'texts',t.id+'.txt'),'utf8')!==t.text+'\n')throw Error('Text file drift');
  const userConfirmation={maintenance:true,activeRelays:0,startingRelays:0,noCompetingAiTests:true,
    source:'fresh signed-in browser health and explicit user confirmation in current instruction; not independently polled browser state'};
  async function guard(){
    const r=await fetch('http://127.0.0.1:8787/health',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(r.status!==200){await r.body?.cancel();throw Error('Gateway authenticated health failed');}
    const h=await r.json();if(h.ready!==true||h.activeSessions!==0||h.queue?.active!==0||h.queue?.pending!==0)throw Error('Gateway readiness/idle changed');
    return {status:r.status,authenticated:true,ready:h.ready,activeSessions:h.activeSessions,queue:h.queue,
      maintenance:userConfirmation.maintenance,activeRelays:userConfirmation.activeRelays,startingRelays:userConfirmation.startingRelays};
  }
  const nativePaths=['C:/Shahvex-AI/chatterbox-testing/chatterbox_voice_server.py','C:/Shahvex-AI/emotion_samples/shahvex_female_reference.wav'];
  const before=nativePaths.map(p=>({path:p,sha256:sha(fs.readFileSync(p))}));
  await guard();
  const start={at:new Date().toISOString(),userConfirmation,planSha256:sha(fs.readFileSync(path.join(root,'plan.json'))),nativeFiles:before,
    plannedReplies:30,plannedPhraseRequests:66,requestKeys:['text']};
  fs.writeFileSync(path.join(root,'metrics','native-start.json'),JSON.stringify(start,null,2),{flag:'wx'});
  const results=[];let current,phraseIndex=0,requestRecord,requestCount=0;
  async function requestWav(body){
    const began=performance.now();requestCount++;
    const rec=requestRecord={trial:current.id,phraseIndex:phraseIndex++,characters:body.text.length,
      requestUnixMs:Date.now(),receivedBytes:0,completed:false};
    try{
      const r=await fetch('http://127.0.0.1:8765/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});
      rec.headersMs=performance.now()-began;rec.status=r.status;rec.declaredBytes=r.headers.has('content-length')?Number(r.headers.get('content-length')):null;
      const chunks=[];
      for await(const c of r.body){rec.firstBodyByteMs??=performance.now()-began;rec.receivedBytes+=c.length;if(rec.receivedBytes>4000000)throw Error('WAV bound exceeded');chunks.push(Buffer.from(c));}
      rec.bodyCompleteMs=performance.now()-began;const wav=Buffer.concat(chunks);
      if(rec.status!==200||rec.declaredBytes!==null&&rec.declaredBytes!==wav.length)throw Error('HTTP integrity failed');
      const d=decodeWav(wav);if(!d.audio.length||wav.readUInt32LE(4)+8!==wav.length)throw Error('WAV integrity failed');
      rec.firstValidatedPcmMs=performance.now()-began;rec.sampleRate=d.sampleRate;rec.audioDurationMs=d.audio.length/d.sampleRate/2*1000;rec.wavSha256=sha(wav);rec.completed=true;
      fs.writeFileSync(path.join(root,'phrase-wavs',`${current.id}-p${rec.phraseIndex+1}.wav`),wav,{flag:'wx'});
      return {status:r.status,wav,declaredBytes:rec.declaredBytes,headersMs:rec.headersMs,firstBodyByteMs:rec.firstBodyByteMs,bodyCompleteMs:rec.bodyCompleteMs};
    }catch(e){rec.errorType=e.name;rec.code=e.cause?.code??e.code??null;throw e;}
    finally{rec.totalRequestWallMs=performance.now()-began;fs.appendFileSync(path.join(root,'metrics','native-requests.jsonl'),JSON.stringify(rec)+'\n');}
  }
  try{
    for(const trial of plan.trials){
      current=trial;phraseIndex=0;const text=plan.texts.find(t=>t.id===trial.textId),requests=[];
      const r=await renderSample(text,{approved:true,guard,requestWav:async body=>{const out=await requestWav(body);requests.push({...requestRecord});return out;}});
      r.metrics.firstValidatedPcmMs=requests[0].firstValidatedPcmMs;
      r.metrics.completeSynthesisAndTransferMs=requests.reduce((n,x)=>n+x.bodyCompleteMs,0);
      r.metrics.nativeGpuInferenceMs=null;r.metrics.transportErrors=0;r.metrics.requests=requests;
      fs.writeFileSync(path.join(root,'audio-labeled',trial.id+'.wav'),r.wav,{flag:'wx'});
      fs.writeFileSync(path.join(root,'audio-blind',trial.blindId+'.wav'),r.wav,{flag:'wx'});
      fs.writeFileSync(path.join(root,'metrics',trial.id+'.json'),JSON.stringify(r.metrics,null,2),{flag:'wx'});
      results.push({trial:trial.id,textId:trial.textId,repeat:trial.repeat,ok:true,metrics:r.metrics});
      console.log(JSON.stringify({completed:results.length,trial:trial.id,firstValidatedPcmMs:r.metrics.firstValidatedPcmMs,completeSynthesisAndTransferMs:r.metrics.completeSynthesisAndTransferMs,projectedGapsMs:r.metrics.projectedBetweenPhraseGapMs}));
    }
    await guard();
  }catch(e){
    results.push({trial:current?.id,ok:false,errorType:e.name,code:e.cause?.code??e.code??null,request:requestRecord});
    console.error(JSON.stringify({stopped:true,trial:current?.id,errorType:e.name,code:e.cause?.code??e.code??null,receivedBytes:requestRecord?.receivedBytes,declaredBytes:requestRecord?.declaredBytes}));process.exitCode=1;
  }finally{
    const summary={results,requestCount,completed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,unrun:30-results.length,
      retries:0,maintenanceChanged:false,nativeFilesUnchanged:before.every(x=>sha(fs.readFileSync(x.path))===x.sha256),
      scope:'native text-to-validated-PCM; gaps projected, not browser audible measurements; user-confirmed maintenance/relays, live Gateway session/queue guard'};
    fs.writeFileSync(path.join(root,'metrics','native-results.json'),JSON.stringify(summary,null,2),{flag:'wx'});
    console.log(JSON.stringify({completed:summary.completed,failed:summary.failed,unrun:summary.unrun,requestCount,nativeFilesUnchanged:summary.nativeFilesUnchanged,retries:0}));
  }
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({stoppedBeforeRun:true,errorType:e.name,reason:e.message}));process.exitCode=1;});
