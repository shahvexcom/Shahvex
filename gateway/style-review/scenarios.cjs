'use strict';
// Entirely synthetic: neither historical transcripts nor approved business facts.
const disclosure='I am Jennifer, an automated assistant.';
const fact='The sample appointment lasts 20 minutes.';
const consent='May I continue?';
const script=`SYNTHETIC BENCHMARK ONLY. Always say exactly: ${disclosure} Then state exactly: ${fact} Then ask exactly: ${consent} Optional acknowledgement before these statements is permitted. Never promise eligibility or change the consent workflow.`;
const locked=[disclosure,fact,consent];
const body=locked.join(' ');
const scenarios=[
  {id:'greeting',customer:'Hello, Jennifer.',intent:'warm',opening:'Hello, thanks for speaking with me. '},
  {id:'information',customer:'How long is the appointment?',intent:'neutral',opening:''},
  {id:'clarification',customer:"I don't understand. Can you explain?",intent:'reassuring',opening:'I can clarify the appointment details. '},
  {id:'concern-followup',customer:'Okay.',history:[{role:'user',content:'I am worried about the appointment.'},{role:'assistant',content:'Would you like the appointment details?'}],intent:'reassuring',opening:'We can go through the details. '},
  {id:'consent',customer:'What am I agreeing to?',policy:{responseIntent:'consent'},intent:'serious',opening:'Please review the following information. '}
].map(s=>({...s,baseline:body,styled:s.opening+body}));
function request(s){return [{role:'system',content:script},...(s.history||[]),{role:'user',content:s.customer}];}
function auditExample(s,response){
  // Closed-world fixture oracle, NOT a general-purpose semantic response validator.
  return response===s.baseline||response===s.styled;
}
module.exports={scenarios,script,locked,request,auditExample};
