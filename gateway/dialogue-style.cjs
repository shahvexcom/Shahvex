'use strict';
// Offline-reviewed policy helper. No inference, acoustics, TTS parameters or shared state.
const HINTS=Object.freeze({
  neutral:'Use clear, direct, respectful optional phrasing.',
  warm:'Use a friendly, restrained greeting or acknowledgement where permitted.',
  reassuring:'Acknowledge the stated confusion or concern and clarify provided information calmly. Do not promise an outcome.',
  serious:'Use plain, measured optional wording for the required condition or consent. Avoid jokes and enthusiasm.'
});
const FLOW=/\b(stop calling|do not call|don't call|remove (?:me|my number)|i (?:do not|don't) consent)\b/i;
const CLARIFY=/\b(i(?:'m| am) (?:confused|worried|concerned)|i (?:do not|don't) understand|can you (?:explain|clarify|repeat)|please (?:explain|clarify|repeat)|what do you mean)\b/i;
const ACK=/^(?:yes|ok(?:ay)?|please continue|go on|thank you|thanks)[.!\s]*$/i;
function normalize(text){return text.normalize('NFKC').replace(/\u2019/g,"'").trim();}
function selectIntent(customer,history=[],policy={}){
  if(typeof customer!=='string'||customer.length>8000)throw Error('Bounded customer text required');
  const text=normalize(customer);
  if(FLOW.test(text)||policy.flowAction==='stop'||policy.flowAction==='transfer')return Object.freeze({intent:'serious',evidence:'flow-reserved',styleAllowed:false});
  if(policy.responseIntent==='consent'||policy.responseIntent==='condition'||policy.responseIntent==='refusal')return Object.freeze({intent:'serious',evidence:'trusted-response-intent',styleAllowed:true});
  if(CLARIFY.test(text))return Object.freeze({intent:'reassuring',evidence:'explicit-clarification-or-concern',styleAllowed:true});
  const previous=history.filter(m=>m.role==='user').at(-1)?.content;
  if(ACK.test(text)&&typeof previous==='string'&&previous.length<=8000&&CLARIFY.test(normalize(previous)))return Object.freeze({intent:'reassuring',evidence:'immediate-clarification-followup',styleAllowed:true});
  if(text.length<=80&&/^(?:hello|hi|hey|good morning|good afternoon|good evening)(?:[.!?,\s]|$)/i.test(text))return Object.freeze({intent:'warm',evidence:'explicit-greeting',styleAllowed:true});
  return Object.freeze({intent:'neutral',evidence:'default-uncertain',styleAllowed:true});
}
function prepareStyleRequest(messages,policy={}){
  if(!Array.isArray(messages)||messages.length<2||messages.length>64||messages[0].role!=='system'||messages.at(-1).role!=='user'||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('Existing text-chat request required');
  const selected=selectIntent(messages.at(-1).content,messages.slice(1,-1),policy);
  const applied=policy.allowOptionalPhrasing===true&&selected.styleAllowed;
  const decision=Object.freeze({...selected,applied});
  if(!applied)return {messages,decision};
  const hint='\n\nOPTIONAL DELIVERY ONLY: '+HINTS[selected.intent]+' Preserve every mandatory script word, disclosure, fact, condition and workflow exactly. Change only permitted optional language. If no safe optional wording exists, follow the original response. Never add stage directions, emotion tags, filler or unsupported promises.';
  return {messages:[{...messages[0],content:messages[0].content+hint},...messages.slice(1)],decision};
}
module.exports={selectIntent,prepareStyleRequest};
