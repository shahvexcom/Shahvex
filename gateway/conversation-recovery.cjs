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
 const first = previous.content.split(/(?<=[.!])\s+/)[0].trim();
 const brief = first; // Keep a complete grounded sentence; never truncate a claim mid-phrase.
 const reply = `My last point was: ${brief}`;
 return spoken.some(m => m.content === reply) ? '' : reply;
}
module.exports = { recoveryReply, clarification };
