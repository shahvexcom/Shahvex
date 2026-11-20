'use strict';
const {isListeningSignal}=require('./conversation-resume.cjs');
const {explicitlyEndsCall}=require('./customer-conduct.cjs');
const {handoffWaiting}=require('./handoff-intent.cjs');
const clarification = 'Please repeat your last question.';
const isRecovery = text => /lost track|didn.t catch|could you (?:say|tell)|repeat your last question|could you repeat/i.test(text);
function isCustomerQuestion(value) {
 const text=String(value || '').trim();
 if(isListeningSignal(text)||explicitlyEndsCall(text))return false;
 return /\?$/.test(text) || /^(?:what|why|when|where|who|which|how|can you|could you|would you|do you|did you|are you|is it|have you)\b/i.test(text);
}
function recoveryReply(history) {
 const customer=history.filter(m=>m.role==='user').at(-1)?.content || '';
 if(!isCustomerQuestion(customer)||handoffWaiting(history))return '';
 if(history.some(m=>m.role==='assistant'&&isRecovery(m.content)))return '';
 return clarification;
}
/** A guessed translation must never become a recorded qualification answer. */
function groundedReplyText(value,customer=''){
 let text=String(value||'');
 if(!/\b(?:what .*mean|translat|interpret|meaning of)\b/i.test(customer))text=text.replace(/[^.!?]*\b(?:which I (?:think|assume|guess) means|I (?:assume|guess) (?:you mean|that you))\b[^.!?]*[.!?]?/gi,'');
 const positive=/\b(?:I(?:['’]m| am) (?:doing |feeling )?(?:fine|good|great|well|happy)|doing (?:fine|good|great|well)|not bad)\b|^(?:fine|good|great|well|okay|ok)[.! ,]*$/i.test(customer)&&!/\b(?:not|isn't|is not) (?:good|great|well|fine)\b/i.test(customer);
 if(customer&&!positive)text=text.replace(/\b(?:that(?:['’]s| is) (?:really |very )?(?:nice|good|great|wonderful) to hear|(?:I(?:['’]m| am) )?(?:so )?glad to hear (?:that|it))[.! ]*/gi,'');
 return text;
}
module.exports = { isCustomerQuestion, recoveryReply, clarification, groundedReplyText };

