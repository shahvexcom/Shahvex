'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {decodeWav}=require('../wav.cjs');
const root=path.resolve(__dirname,'../../dist/Jennifer-Concise-AB-v1');
const data=JSON.parse(fs.readFileSync(path.join(root,'metrics','native-results.json'),'utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8'));
const key=JSON.parse(fs.readFileSync(path.join(root,'private-key','blind-key.json'),'utf8'));
function median(a){const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2;}
const rows=[...new Set(plan.texts.map(t=>t.scenario))].map(scenario=>{
  const get=variant=>data.results.filter(r=>r.ok&&r.textId===`${scenario}-${variant}`);
  const a=get('baseline'),b=get('proposed');
  const first=x=>median(x.map(r=>r.metrics.firstValidatedPcmMs));
  const full=x=>median(x.map(r=>r.metrics.completeSynthesisAndTransferMs));
  const gaps=x=>Math.max(0,...x.flatMap(r=>r.metrics.projectedBetweenPhraseGapMs));
  return {scenario,baselineN:a.length,proposedN:b.length,baselineFirstPcmMs:first(a),proposedFirstPcmMs:first(b),
    relativeFirstPcmReductionPercent:(first(a)-first(b))/first(a)*100,
    baselineCompleteMs:full(a),proposedCompleteMs:full(b),baselineWorstProjectedGapMs:gaps(a),proposedWorstProjectedGapMs:gaps(b)};
});
function overall(eligibleOnly){const selected=data.results.filter(r=>r.ok&&(!eligibleOnly||!r.textId.startsWith('mandatory-first-control')));return {
  baselineN:selected.filter(r=>r.textId.endsWith('-baseline')).length,proposedN:selected.filter(r=>r.textId.endsWith('-proposed')).length,
  baselineFirstPcmMedianMs:median(selected.filter(r=>r.textId.endsWith('-baseline')).map(r=>r.metrics.firstValidatedPcmMs)),
  proposedFirstPcmMedianMs:median(selected.filter(r=>r.textId.endsWith('-proposed')).map(r=>r.metrics.firstValidatedPcmMs))};}
const generated=[];
for(const r of data.results.filter(r=>r.ok)){
  const k=key.trials.find(t=>t.id===r.trial),labeled=path.join(root,'audio-labeled',r.trial+'.wav'),blind=path.join(root,'audio-blind',k.blindId+'.wav');
  const a=fs.readFileSync(labeled),b=fs.readFileSync(blind);if(!a.equals(b))throw Error('Blind copy differs');
  const d=decodeWav(a);if(a.readUInt32LE(4)+8!==a.length)throw Error('Saved WAV framing mismatch');
  generated.push({trial:r.trial,blindId:k.blindId,labeled:path.relative(root,labeled),blind:path.relative(root,blind),
    sha256:crypto.createHash('sha256').update(a).digest('hex'),sampleRate:d.sampleRate,audioSeconds:d.audio.length/d.sampleRate/2});
}
const summary={completed:data.completed,failed:data.failed,unrun:data.unrun,requestCount:data.requestCount,retries:data.retries,
  nativeFilesUnchanged:data.nativeFilesUnchanged,rows,allCases:overall(false),eligibleOptionalCases:overall(true),
  worstProjectedGapMs:Math.max(0,...data.results.filter(r=>r.ok).flatMap(r=>r.metrics.projectedBetweenPhraseGapMs)),
  audibleLatency:'not measured',naturalness:'pending blind listening',
  measurement:'native request to fully validated PCM; complete time sums native request/header/body waits, not GPU-only synthesis',
  preflight:'User-confirmed fresh signed-in maintenance/relays/no competing tests; independent authenticated Gateway ready/session/queue checked before every phrase'};
fs.writeFileSync(path.join(root,'metrics','summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(root,'private-key','completed-answer-key.json'),JSON.stringify({status:'generated and byte-verified',generated},null,2)+'\n',{flag:'wx'});
const listening=generated.map((g,i)=>`<section><label>Sample ${i+1}</label><audio controls preload="none" src="${g.blindId}.wav"></audio></section>`).join('\n');
fs.writeFileSync(path.join(root,'audio-blind','index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Jennifer blind comparison</title><body><h1>Jennifer blind comparison</h1><p>Rate naturalness, clarity, warmth, rhythm and Jennifer voice consistency before opening the answer key. No variant labels appear here. These clips omit the initial synthesis wait and concatenate native phrases; they do not measure browser response delay.</p>${listening}</body></html>`,{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
