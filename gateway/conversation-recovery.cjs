'use strict';
const {handoffWaiting}=require('./handoff-intent.cjs');
const clarification = 'Please repeat your last question.';
const isRecovery = text => /lost track|didn.t catch|could you (?:say|tell)|repeat your last question|could you repeat/i.test(text);
function recoveryReply(history) {
 if(handoffWaiting(history)||/^(?:bye(?: bye)?|goodbye)[.! ]*$/i.test(history.filter(m=>m.role==='user').at(-1)?.content||''))return '';
 const spoken = history.filter(m => m.role === 'assistant');
 if (!spoken.some(m => isRecovery(m.content))) return clarification;
 const previous = [...spoken].reverse().find(m => !isRecovery(m.content) && !/\b(?:goodbye|end the call|end this call|connect|transfer|please wait)\b/i.test(m.content) && !/^My last point was:/i.test(m.content) && !/\?/.test(m.content) && m.content.trim().split(/\s+/).length > 6);
 if (!previous) return '';
 // Resume verified context only, without inventing an answer or repeating a question.
 const first = (previous.content.match(/[^.!?\n]+[.!?]?/g)||[]).map(s=>s.trim()).find(s=>!s.includes('?')&&s.split(/\s+/).length>6&&!/^(?:got it|okay|ok|thank you|thanks)[.! ]*$/i.test(s));
 if(!first)return '';
 const brief = first; // Keep a complete grounded sentence; never truncate a claim mid-phrase.
 const reply = `My last point was: ${brief}`;
 return spoken.some(m => m.content === reply) ? '' : reply;
}
/** A guessed translation must never become a recorded qualification answer. */
function groundedReplyText(value,customer=''){
 let text=String(value||'');
 if(!/\b(?:what .*mean|translat|interpret|meaning of)\b/i.test(customer))text=text.replace(/[^.!?]*\b(?:which I (?:think|assume|guess) means|I (?:assume|guess) (?:you mean|that you))\b[^.!?]*[.!?]?/gi,'');
 const positive=/\b(?:I(?:['’]m| am) (?:doing |feeling )?(?:fine|good|great|well|happy)|doing (?:fine|good|great|well)|not bad)\b|^(?:fine|good|great|well|okay|ok)[.! ,]*$/i.test(customer)&&!/\b(?:not|isn't|is not) (?:good|great|well|fine)\b/i.test(customer);
 if(customer&&!positive)text=text.replace(/\b(?:that(?:['’]s| is) (?:really |very )?(?:nice|good|great|wonderful) to hear|(?:I(?:['’]m| am) )?(?:so )?glad to hear (?:that|it))[.! ]*/gi,'');
 return text;
}
module.exports = { recoveryReply, clarification, groundedReplyText };
