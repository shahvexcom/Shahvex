'use strict';
// Authored generic offline examples only; no model calls, audio or campaign approval.
const {prepareStyleRequest}=require('../dialogue-style.cjs');
const {split}=require('./listening-harness.cjs');
const disclosure='I am Jennifer, an automated assistant.',consent='May I continue?';
const pairs=[
  {id:'neutral',customer:'What happens next?',intent:'neutral',baseline:'I would be happy to explain the next step clearly.',proposed:'I can explain the next step.'},
  {id:'warm',customer:'Hello, Jennifer.',intent:'warm',baseline:'Hello, I would be happy to explain the next step for you.',proposed:'Hello, I can explain the next step.'},
  {id:'reassuring',customer:'I am worried. Can you clarify?',intent:'reassuring',baseline:'I understand that you have concerns, and I would be happy to explain this clearly.',proposed:'I can explain this step by step.'},
  {id:'serious',customer:'What am I agreeing to?',intent:'serious',policy:{responseIntent:'consent'},baseline:'It is important that you understand the details before deciding whether to continue.',proposed:'Please review the details before deciding.'},
  {id:'mandatory-first-control',customer:'What happens next?',intent:'neutral',requiredFirst:true,baseline:disclosure+' I would be happy to explain the next step clearly.',proposed:disclosure+' I can explain the next step.'}
].map(p=>({...p,baseline:p.baseline+' '+consent,proposed:p.proposed+' '+consent,mandatory:p.requiredFirst?[disclosure,consent]:[consent]}));
function evaluate(){
  return {kind:'authored generic text/segmentation evaluation; no generated LLM or TTS outputs',
    campaignCompliance:'unverified; no campaign activation',recordedLatencyBaselineSeconds:5.62,
    workloadMeaning:'characters and job counts only; not audio tokens, GPU time, or predicted milliseconds',
    rows:pairs.map(p=>{
      const script=`GENERIC FOLLOW-UP TEST ONLY. Prior automation disclosure is retained in history. Optional phrasing may vary; do not invent facts or guarantees. Preserve these exact required spans, in order: ${JSON.stringify(p.mandatory)}. ${p.requiredFirst?'The disclosure must be first.':''}`;
      const messages=[{role:'system',content:script},{role:'assistant',content:disclosure},{role:'user',content:p.customer}];
      const r=prepareStyleRequest(messages,{allowOptionalPhrasing:true,...p.policy});
      function measure(text){const phrases=split(text);return {text,characters:text.length,firstPhraseCharacters:phrases[0].length,phraseCharacters:phrases.map(s=>s.length),jobs:phrases.length};}
      function intact(text){let pos=0;for(const s of p.mandatory){const at=text.indexOf(s,pos);if(at<0)return false;pos=at+s.length;}return !p.requiredFirst||text.startsWith(disclosure);}
      const a=measure(p.baseline),b=measure(p.proposed);
      return {scenario:p.id,customer:p.customer,intent:r.decision.intent,expectedIntent:p.intent,mandatory:p.mandatory,
        inputScriptUnchanged:r.messages[0].content.startsWith(script),historyUnchanged:JSON.stringify(r.messages.slice(1))===JSON.stringify(messages.slice(1)),
        baseline:a,proposed:b,exactRequiredSpansPreserved:intact(p.baseline)&&intact(p.proposed),
        firstPhraseCharacterReduction:a.firstPhraseCharacters-b.firstPhraseCharacters,
        extraNativeJobs:b.jobs-a.jobs,firstAudibleImprovementMs:null,betweenPhraseGapMs:null,
        gapRisk:'Shorter speech may provide less cover for the next sequential WAV; unchanged job count does not prove gap neutrality.'};
    })};
}
if(require.main===module)process.stdout.write(JSON.stringify(evaluate(),null,2)+'\n');
module.exports={evaluate};
