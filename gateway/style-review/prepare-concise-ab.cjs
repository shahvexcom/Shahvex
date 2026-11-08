'use strict';
// Offline preparation / injected mock evaluation only. No default network adapter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluate}=require('./concise-evaluation.cjs');
const {split,idle,renderSample}=require('./listening-harness.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function buildPlan(seed=crypto.randomBytes(16).toString('hex')){
  const evaluated=evaluate();
  if(!evaluated.rows.every(r=>r.exactRequiredSpansPreserved&&r.inputScriptUnchanged&&r.historyUnchanged))throw Error('Fixture preservation failed');
  const texts=evaluated.rows.flatMap(r=>['baseline','proposed'].map(variant=>({id:`${r.scenario}-${variant}`,scenario:r.scenario,variant,
    text:r[variant].text,sha256:sha(r[variant].text),mandatory:r.mandatory,phrases:split(r[variant].text)})));
  const trials=texts.flatMap(t=>[1,2,3].map(repeat=>({id:`${t.id}-r${repeat}`,textId:t.id,repeat,blindId:sha(`${seed}:blind:${t.id}:${repeat}`).slice(0,24)})));
  for(let i=trials.length-1;i>0;i--){const j=crypto.createHash('sha256').update(`${seed}:order:${i}`).digest().readUInt32LE()% (i+1);[trials[i],trials[j]]=[trials[j],trials[i]];}
  return {kind:'generic synthetic benchmark; no campaign approval or deployment',seed,texts,trials,
    plannedReplies:trials.length,plannedNativeRequests:trials.reduce((n,t)=>n+texts.find(x=>x.id===t.textId).phrases.length,0),
    phraseStreamSha256:sha(fs.readFileSync(path.join(__dirname,'../phrase-stream.cjs'))),
    requestBodyKeys:['text'],liveRequests:0,audioFiles:0,execution:'BLOCKED: independent authenticated health, competing-test exclusion and explicit native approval required'};
}
function prepare(root){
  const p=buildPlan();fs.mkdirSync(root,{recursive:false});
  for(const folder of ['texts','audio-labeled','audio-blind','phrase-wavs','metrics','private-key'])fs.mkdirSync(path.join(root,folder));
  const publicPlan={...p,trials:p.trials.map(({blindId,...t})=>t)};
  fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify(publicPlan,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(root,'private-key','blind-key.json'),JSON.stringify({status:'planned; no audio generated',trials:p.trials},null,2)+'\n',{flag:'wx'});
  for(const t of p.texts)fs.writeFileSync(path.join(root,'texts',t.id+'.txt'),t.text+'\n',{flag:'wx'});
  return p;
}
async function runInjected(plan,{approved=false,guard,noOtherTests,requestWav,save,clock}={}){
  if(approved!==true||typeof guard!=='function'||typeof noOtherTests!=='function'||typeof requestWav!=='function'||typeof save!=='function')throw Error('Explicit approval and authenticated live adapters required');
  const current=buildPlan(plan.seed);
  if(JSON.stringify(plan)!==JSON.stringify(current))throw Error('Plan/parser drift requires review');
  const results=[];
  const checkedGuard=async()=>{
    const h=await guard();idle(h);
    if(await noOtherTests()!==true)throw Error('Competing direct AI tests not excluded');
    return h;
  };
  for(const trial of plan.trials){
    const text=plan.texts.find(t=>t.id===trial.textId);
    try{
      const result=await renderSample(text,{approved:true,guard:checkedGuard,requestWav,clock});
      await save(trial,text,result);results.push({trial:trial.id,ok:true,metrics:result.metrics});
    }catch(error){
      results.push({trial:trial.id,ok:false,errorType:error.name,code:error.cause?.code??error.code??null});
      return {completed:results.filter(r=>r.ok).length,stopped:true,results,unrun:plan.trials.length-results.length};
    }
  }
  return {completed:results.length,stopped:false,results,unrun:0};
}
if(require.main===module){
  if(process.argv.length!==3||process.argv[2].startsWith('--'))throw Error('Preparation only: provide a new output directory');
  const root=path.resolve(process.argv[2]),p=prepare(root);console.log(JSON.stringify({prepared:root,texts:p.texts.length,trials:p.plannedReplies,plannedNativeRequests:p.plannedNativeRequests,liveRequests:0,audioFiles:0}));
}
module.exports={buildPlan,prepare,runInjected};
