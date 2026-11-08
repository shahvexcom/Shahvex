'use strict';
// Default CLI prepares files only. No network client, credentials or service control.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {PhraseStream}=require('../phrase-stream.cjs');
const {decodeWav}=require('../wav.cjs');
const {pairs}=require('./approved-listening.cjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
function split(text){
  const out=[],p=new PhraseStream(new AbortController().signal,s=>out.push(s));
  try{for(const c of text)p.push(c);p.finish(text);}finally{p.dispose();}
  if(out.join(' ')!==text)throw Error('Text changed across phrase boundaries');return out;
}
function makePlan(){
  const samples=pairs.flatMap(p=>[['baseline',p.baseline],['style-aware',p.styleAware]].map(([variant,text])=>({
    id:`${p.scenario}-${variant}`,scenario:p.scenario,variant,text,textSha256:sha(text),phrases:split(text)})));
  // Random order, recorded once. No repeated trials unless separately approved.
  const order=samples.map(s=>s.id);
  for(let i=order.length-1;i>0;i--){const j=randomBytes(4).readUInt32LE()% (i+1);[order[i],order[j]]=[order[j],order[i]];}
  return {version:1,scope:'approved generic demonstration only; not a campaign script',samples,order,
    parserSha256:sha(fs.readFileSync(path.join(__dirname,'../phrase-stream.cjs'))),
    ttsBodyKeys:['text'],nativeVoiceAndSettings:'unchanged resident Jennifer voice; no reference upload or generation overrides',
    audioGenerated:false,liveAdapter:'NOT CONNECTED: separate approval and authenticated maintenance/idle verification required'};
}
function idle(h){
  if(h?.status!==200||h.authenticated!==true||h.ready!==true||h.maintenance!==true||h.activeSessions!==0||
     h.queue?.active!==0||h.queue?.pending!==0||h.activeRelays!==0||h.startingRelays!==0)throw Error('Authenticated maintenance/idle guard failed');
}
function joinWav(parts){
  const decoded=parts.map(decodeWav),rate=decoded[0].sampleRate;
  if(decoded.some(p=>p.sampleRate!==rate))throw Error('Native sample rate changed');
  const pcm=Buffer.concat(decoded.map(p=>p.audio)),h=Buffer.alloc(44);
  h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
async function renderSample(sample,{approved=false,guard,requestWav,clock=()=>performance.now()}){
  if(approved!==true||typeof guard!=='function'||typeof requestWav!=='function')throw Error('Separate approval and live adapters required');
  const parts=[],segments=[],projectedGaps=[];let start,playbackEnd;
  for(const [index,text] of sample.phrases.entries()){
    // guard must perform a fresh authenticated server health read, not load proof JSON.
    idle(await guard());const before=clock();start??=before;
    const r=await requestWav({text}); // exactly one bounded request; no retries
    const end=clock();if(r.status!==200)throw Error('TTS HTTP failure');
    if(!Buffer.isBuffer(r.wav)||r.wav.length>4000000)throw Error('Invalid/bounded WAV required');
    if(r.declaredBytes!==null&&r.declaredBytes!==r.wav.length)throw Error('Content-Length mismatch');
    const d=decodeWav(r.wav);if(!d.audio.length||r.wav.readUInt32LE(4)+8!==r.wav.length)throw Error('Incomplete WAV');
    const validatedAt=clock();
    const durationMs=d.audio.length/d.sampleRate/2*1000;
    if(playbackEnd!==undefined)projectedGaps.push(Math.max(0,validatedAt-playbackEnd));
    playbackEnd=Math.max(playbackEnd??validatedAt,validatedAt)+durationMs;
    segments.push({index,characters:text.length,requestMs:end-before,headersMs:r.headersMs??null,
      firstBodyByteMs:r.firstBodyByteMs??null,bodyCompleteMs:r.bodyCompleteMs??null,
      declaredBytes:r.declaredBytes,receivedBytes:r.wav.length,audioDurationMs:durationMs,
      decodeValidationMs:validatedAt-end,firstPlayableMs:validatedAt-start});parts.push(r.wav);
  }
  return {wav:joinWav(parts),phraseWavs:parts,metrics:{segments,firstPlayableMs:segments[0].firstPlayableMs,
    firstValidPcmMs:segments[0].firstPlayableMs,synthesisAndTransferMs:segments.reduce((n,s)=>n+s.requestMs,0),totalWallMs:clock()-start,
    projectedBetweenPhraseGapMs:projectedGaps,actualAudibleLatencyMs:null,actualAudibleGapsMs:null,
    nativeInferenceMs:null,voiceConsistency:'pending blinded listening; no automatic identity claim'}};
}
function prepare(root){
  const plan=makePlan();fs.mkdirSync(root,{recursive:false});
  for(const name of ['texts','audio-labeled','audio-blind','phrase-wavs','metrics','private-key'])fs.mkdirSync(path.join(root,name));
  for(const s of plan.samples)fs.writeFileSync(path.join(root,'texts',s.id+'.txt'),s.text+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});return plan;
}
function saveSample(root,sample,result){
  if(!makePlan().samples.some(s=>s.id===sample.id&&s.text===sample.text))throw Error('Unapproved sample');
  const blindId=randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(root,'audio-labeled',sample.id+'.wav'),result.wav,{flag:'wx'});
  fs.writeFileSync(path.join(root,'audio-blind',blindId+'.wav'),result.wav,{flag:'wx'});
  for(const [i,wav] of result.phraseWavs.entries())fs.writeFileSync(path.join(root,'phrase-wavs',`${sample.id}-${i+1}.wav`),wav,{flag:'wx'});
  fs.appendFileSync(path.join(root,'private-key','blind-key.jsonl'),JSON.stringify({blindId,sample:sample.id})+'\n');
  fs.writeFileSync(path.join(root,'metrics',sample.id+'.json'),JSON.stringify(result.metrics,null,2)+'\n',{flag:'wx'});
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==1||args[0].startsWith('--'))throw Error('Preparation only: node gateway/style-review/listening-harness.cjs <new-output-directory>');
  const root=path.resolve(args[0]);const p=prepare(root);console.log(JSON.stringify({prepared:root,textSamples:p.samples.length,liveRequests:0,audioFiles:0}));
}
module.exports={makePlan,split,idle,joinWav,renderSample,prepare,saveSample};
