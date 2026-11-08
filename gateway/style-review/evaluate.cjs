'use strict';
// Offline only: no fetch, model requests, credentials, microphone or service access.
const {performance}=require('node:perf_hooks');
const {prepareStyleRequest}=require('../dialogue-style.cjs');
const {scenarios,request,auditExample}=require('./scenarios.cjs');
function evaluate(){
  const pairs=scenarios.map(s=>{
    const input=request(s),result=prepareStyleRequest(input,{allowOptionalPhrasing:true,...s.policy});
    return {id:s.id,customer:s.customer,intent:result.decision.intent,expectedIntent:s.intent,
      originalPromptPreserved:result.messages[0].content.startsWith(input[0].content),
      addedPromptCharacters:result.messages[0].content.length-input[0].content.length,
      baselineAuthoredExample:s.baseline,styleAuthoredExample:s.styled,
      fixtureContentAudit:auditExample(s,s.baseline)&&auditExample(s,s.styled)};
  });
  const durations=[];
  const workloads=scenarios.map(s=>[...request(s)]);
  // Exercise a longer script/history as well as the short paired scenarios.
  workloads.push([{role:'system',content:'Required exact script. '.repeat(600)},
    ...Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'Historical turn, retained without alteration.'})),
    {role:'user',content:'Can you explain?'}]);
  for(let i=0;i<12000;i++){
    const begin=performance.now();prepareStyleRequest(workloads[i%workloads.length],{allowOptionalPhrasing:true});
    if(i>=2000)durations.push(performance.now()-begin);
  }
  durations.sort((a,b)=>a-b);
  let seed=11032026;const plan=[];
  for(let repeat=1;repeat<=3;repeat++)for(const s of scenarios)for(const variant of ['baseline','style-aware'])plan.push({scenario:s.id,repeat,variant});
  for(let i=plan.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[plan[i],plan[j]]=[plan[j],plan[i]];}
  return {kind:'offline synthetic request/fixture evaluation; no LLM or audio generated',pairs,
    controllerCpuMilliseconds:{samples:durations.length,p50:durations[5000],p95:durations[9500],worst:durations.at(-1)},
    nativeModelAddedLatency:null,firstAudibleLatency:null,perceivedNaturalness:null,
    pending:'Approved native A/B and blinded listening required. Authored examples do not predict generated responses.',
    randomizedFutureTrialPlan:plan};
}
if(require.main===module)process.stdout.write(JSON.stringify(evaluate(),null,2)+'\n');
module.exports={evaluate};
