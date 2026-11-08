'use strict';
// Text preparation only. No model, HTTP, audio, credential or service access.
const {scenarios,script,locked,request,auditExample}=require('./scenarios.cjs');
const {prepareStyleRequest}=require('../dialogue-style.cjs');
function prepareListening(){
  const definitions=[
    ['neutral','information','How long is the appointment?'],
    ['friendly','greeting','Hello, Jennifer.'],
    ['hesitant','clarification',"I'm not sure I understand. Can you explain?"],
    ['concerned','concern-followup','I am worried about the appointment.'],
    ['serious','consent','What am I agreeing to?']
  ];
  const pairs=definitions.map(([scenario,id,customer])=>{
    const original=scenarios.find(s=>s.id===id),s={...original,customer,history:[]};
    const decision=prepareStyleRequest(request(s),{allowOptionalPhrasing:true,...s.policy}).decision;
    const body=locked.join(' ');
    if(!auditExample(s,s.baseline)||!auditExample(s,s.styled)||s.baseline!==body||s.styled!==s.opening+body)throw Error('Fixture drift; review required');
    return {scenario,customer,intent:decision.intent,baseline:s.baseline,styleAware:s.styled,
      difference:{operation:s.opening?'prepend':'none',optionalText:s.opening,removedText:'',mandatoryOrFactualChanges:[]},
      exactFixtureAudit:locked.every(span=>s.baseline.includes(span)&&s.styled.includes(span)),
      identicalTextControl:s.baseline===s.styled};
  });
  return {status:'TEXT REVIEW ONLY; audio prohibited until separate approval',
    source:'Existing synthetic style-review fixture, not Jennifer campaign export; examples authored, not Ollama-generated.',
    fixtureScript:script,lockedFixtureWording:locked,
    realApprovedScriptValidation:'PENDING: exported Jennifer script and permitted optional regions unavailable',
    audioGenerated:false,liveRequests:0,pairs};
}
if(require.main===module)process.stdout.write(JSON.stringify(prepareListening(),null,2)+'\n');
module.exports={prepareListening};
