'use strict';
// Synthetic, headless native benchmark ONLY. Never edits production or calls LLM/STT.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash,randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createServices,loadContract}=require('./services.cjs');
const sha=data=>createHash('sha256').update(data).digest('hex');
function phrases(source,text,minimum){
  if(source.split('sentence?24:40').length!==2)throw Error('Deployed parser differs; review before benchmarking');
  const sandbox={module:{exports:{}},Error};
  vm.runInNewContext(source.replace('sentence?24:40',`sentence?24:(this.benchmarkEmitted?40:${minimum})`),sandbox);
  const output=[];const p=new sandbox.module.exports.PhraseStream(new AbortController().signal,s=>{output.push(s);p.benchmarkEmitted++;});p.benchmarkEmitted=0;
  for(const c of text)p.push(c);p.finish(text);p.dispose();
  if(output.join(' ').replace(/\s+/g,' ').trim()!==text.replace(/\s+/g,' ').trim())throw Error('Text lost, duplicated or reordered');
  return output;
}
function plan(texts,source,seed){
  if(!Array.isArray(texts)||texts.length!==5||texts.some(t=>typeof t!=='string'||!t.trim()||t.length>16000))throw Error('Exactly five bounded reply texts required');
  const trials=[];
  texts.forEach((text,i)=>{for(const minimum of [40,32])for(let repeat=1;repeat<=3;repeat++)trials.push({fixture:i+1,variant:minimum===40?'A':'B',minimum,repeat,textHash:sha(text),phrases:phrases(source,text,minimum)});});
  for(let i=trials.length-1;i>0;i--){const j=createHash('sha256').update(`${seed}:${i}`).digest().readUInt32LE(0)%(i+1);[trials[i],trials[j]]=[trials[j],trials[i]];}
  return trials;
}
function wav(pcm){
  const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
async function runTrial(trial,services,voiceId,guard,clock=()=>performance.now()){
  await guard();
  const start=clock(),frames=[],gaps=[],segments=[];let first=null,end=null,totalBytes=0,guardMs=0;
  const logical=()=>clock()-guardMs;
  for(const [index,text] of trial.phrases.entries()){
    if(index){const before=clock();await guard();guardMs+=clock()-before;}
    if(clock()-start>300000)throw Error('Trial time bound exceeded');
    const segmentStart=logical();let segmentFirst=null;
    for await(const pcm of services.tts(text,voiceId,new AbortController().signal)){
      const now=logical();if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2)throw Error('Invalid PCM');
      first??=now;segmentFirst??=now;
      const scheduled=Math.max(end??now,now+30);
      if(end!==null && scheduled>end){const gap=scheduled-end;gaps.push(gap);frames.push(Buffer.alloc(Math.round(gap*16)*2));}
      frames.push(pcm);totalBytes+=pcm.length;if(totalBytes>4000000)throw Error('Reply audio limit exceeded');
      end=scheduled+pcm.length/32;
    }
    if(segmentFirst===null)throw Error('Native segment returned no PCM');
    segments.push({index,characters:text.length,firstPcmMs:segmentFirst-segmentStart,completeMs:logical()-segmentStart});
  }
  return {firstPcmMs:first-start,synthesisCompleteMs:logical()-start,wallCompleteMs:clock()-start,guardOverheadMs:guardMs,projectedPlaybackCompleteMs:end-start,
    projectedGapMs:gaps,projectedGapTotalMs:gaps.reduce((a,b)=>a+b,0),projectedGapWorstMs:Math.max(0,...gaps),
    speechAudioSeconds:totalBytes/32000,segments,pcm:Buffer.concat(frames)};
}
async function main(){
  const args=process.argv.slice(2);const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'native-ab-fixtures.json'),'utf8'));
  const source=fs.readFileSync('C:\\Shahvex-AI\\integration-gateway\\phrase-stream.cjs','utf8');
  const seed=randomBytes(16).toString('hex'),trials=plan(fixtures,source,seed);
  if(!args.includes('--quiet-window-approved')){console.log(JSON.stringify({synthetic:true,dryRun:true,trials:30,seed,plan:trials.map(({phrases,...t})=>({...t,phraseCharacters:phrases.map(p=>p.length)}))},null,2));return;}
  const token=process.env.SHAHVEX_GATEWAY_TOKEN;if(!token)throw Error('Existing private credential required');
  const contract=loadContract();const voices=contract.voices?.filter(v=>v.verified===true)||[];
  if(voices.length!==1)throw Error('Exactly one existing verified voice required; do not guess voice selection');
  async function guard(){
    const r=await fetch('http://127.0.0.1:8787/health',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!r.ok){await r.body?.cancel();throw Error('Authenticated Gateway health failed');}
    const h=await r.json();if(h.ready!==true||h.activeSessions!==0||h.queue?.active!==0||h.queue?.pending!==0)throw Error('Gateway not ready and idle; benchmark stopped');
  }
  await guard();
  const root=path.resolve('.env.native-ab',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(root,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify({synthetic:true,seed,parserSHA256:sha(source),fixtureSHA256:sha(JSON.stringify(fixtures)),plan:trials.map(({phrases,...t})=>({...t,phraseCharacters:phrases.map(p=>p.length)}))},null,2),{flag:'wx',mode:0o600});
  const nativeRequests=[];
  const fetcher=async(url,options)=>{
    const start=performance.now(),r=await fetch(url,options);const item={atUnixMs:Date.now(),status:r.status,headersMs:performance.now()-start,bytes:0};nativeRequests.push(item);
    async function* body(){try{for await(const chunk of r.body){item.bytes+=chunk.length;yield chunk;}}finally{item.completeMs=performance.now()-start;}}
    const stream=body();stream.cancel=()=>r.body?.cancel();return {ok:r.ok,status:r.status,headers:r.headers,body:stream};
  };
  const services=createServices(contract,fetcher);let failures=0;
  async function snapshot(){
    let gpu=null,models=null;
    try{gpu=execFileSync('nvidia-smi.exe',['--query-gpu=name,memory.total,memory.used,utilization.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();}catch{}
    try{const r=await fetch('http://127.0.0.1:11434/api/ps',{redirect:'error',signal:AbortSignal.timeout(3000)});if(r.ok){const data=await r.json();models=(data.models||[]).map(m=>({name:m.name,sizeVram:m.size_vram}));}else await r.body?.cancel();}catch{}
    return{gpuCsv:gpu,ollamaResidentModels:models};
  }
  for(const [order,trial] of trials.entries()){
    const base={synthetic:true,order:order+1,fixture:trial.fixture,variant:trial.variant,repeat:trial.repeat,textHash:trial.textHash};const before=nativeRequests.length;
    try{
      const stateBefore=await snapshot();
      const result=await runTrial(trial,services,voices[0].id,guard);const {pcm,...metrics}=result;
      fs.writeFileSync(path.join(root,`trial-${order+1}.wav`),wav(pcm),{flag:'wx',mode:0o600});
      const row={...base,ok:true,...metrics,stateBefore,nativeRequests:nativeRequests.slice(before),measurement:'headless first PCM; gaps/playback projected, not browser or audible-onset measurements'};
      fs.appendFileSync(path.join(root,'results.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});console.log(JSON.stringify(row));
    }catch(error){failures++;const row={...base,ok:false,errorType:error.name,httpStatus:error.httpStatus??null,causeCode:error.cause?.code??null,nativeRequests:nativeRequests.slice(before)};fs.appendFileSync(path.join(root,'results.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});console.log(JSON.stringify(row));break;}
  }
  console.log(JSON.stringify({output:root,failures,scheduledTrials:30,prosody:'requires blind listening to saved WAVs; not automatically certified'}));if(failures)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({failed:true,errorType:error.name}));process.exitCode=1;});
module.exports={phrases,plan,runTrial};
