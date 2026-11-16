'use strict';
const textOf=value=>String(value||'').normalize('NFKC').replace(/[’]/g,"'").trim();
const human='(?:(?:a|an|the|your|that) )?(?:(?:real|live|human|licensed|verified) )*(?:person|human|agent|representative|specialist|member|advisor|adviser)';
function withdrawsHumanRequest(value){
 const text=textOf(value);
 return /\b(?:don't|do not|never)\s+(?:want\s+(?:you\s+)?to\s+)?(?:transfer|connect|put)\b/i.test(text)
  || new RegExp("\\b(?:don't|do not|never) (?:want|need)(?: to (?:speak|talk) (?:to|with))? "+human+'\\b','i').test(text)
  || /^(?:no (?:transfer|agent)|cancel (?:the |my )?transfer)[.! ]*$/i.test(text);
}
function customerRequestsHuman(value){
 const text=textOf(value);
 if(withdrawsHumanRequest(text)||/\b(?:after|once|when) (?:I|we|you)\b|\bif\b.*\b(?:give|answer|complete|qualify|eligible)\b/i.test(text)||/\b(?:he|she|they) (?:said|says|asked)\b/i.test(text))return false;
 return /\b(?:transfer|connect) me(?: (?:please|now|right now))?[.! ]*$|\b(?:transfer|connect|put) me (?:to|through|with)\b|\b(?:transfer|connect) (?:my|this|the) calls?\b/i.test(text)
  || new RegExp('\\b(?:want|like|need|prefer)(?: to)? (?:speak|talk|deal) (?:to|with) '+human+'\\b','i').test(text)
  || new RegExp('\\b(?:can|could|may) I (?:speak|talk) (?:to|with) '+human+'\\b','i').test(text)
  || new RegExp("\\bI(?:'ll| will| would rather| prefer to) (?:give|share|provide|discuss) (?:my |the )?(?:details|information|answers) (?:directly )?(?:to|with) "+human+'\\b','i').test(text);
}
function waitingAcknowledgment(value){
 const text=textOf(value);
 return /^(?:yes|yeah|yep|sure|absolutely|certainly|of course|okay|ok|all right|alright|please do|go ahead)(?:[,.! ]+(?:please|go ahead|yes|sure|okay|ok))*[.! ]*$/i.test(text)
  || /^(?:(?:okay|ok|yes|yeah|sure|all right|alright|fine)[,.! ]*)?(?:I(?:'m| am) (?:still )?(?:here[, ]+I(?:'m| am) )?waiting|waiting|I(?:'m| am) (?:here|there))[.!?, ]*$/i.test(text);
}
function handoffWaiting(history){
 let waiting=false;
 for(const turn of history){
  if(turn.role==='user'&&withdrawsHumanRequest(turn.content))waiting=false;
  if(turn.role==='assistant'&&/^Please wait while I connect you to the [a-z ]+\.$/i.test(turn.content.trim()))waiting=true;
  if(turn.role==='assistant'&&/\b(?:cannot|can't|unable to) (?:connect|transfer)|transfer (?:failed|cancelled|canceled)/i.test(turn.content))waiting=false;
 }
 return waiting;
}
module.exports={handoffWaiting,customerRequestsHuman,withdrawsHumanRequest,waitingAcknowledgment};
