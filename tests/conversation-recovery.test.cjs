const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recoveryReply,clarification}=require('../gateway/conversation-recovery.cjs');
const {audioCheckReply}=require('../gateway/conversation-flow.cjs');
const assistant=content=>({role:'assistant',content});
test('clarifies once across intervening clear customer turns, then resumes context once',()=>{
 const history=[assistant('The licensed specialist can review the available options with you. We can discuss the next step afterward.')];
 assert.equal(recoveryReply(history),clarification);
 history.push(assistant(clarification),{role:'user',content:'Okay'});
 const resumed=recoveryReply(history);assert.match(resumed,/My last point was:/);assert.doesNotMatch(resumed,/repeat|catch|lost track|\?/i);
 history.push(assistant(resumed));assert.equal(recoveryReply(history),'');
});
test('mid-call hello acknowledges presence without restarting or repeating a question',()=>{
 const history=[assistant('Are you between 60 and 80?')];
 const reply=audioCheckReply('hello',history);assert.equal(reply,"Yes, I'm here and listening.");
 history.push(assistant(reply));assert.notEqual(audioCheckReply('hello',history),reply);
});
test('REC-166 recovery never resumes only Got it or an empty acknowledgement',()=>{
 const h=[assistant(clarification),assistant('Got it. You do not currently get any rebates or payments on a card each month.')];
 assert.equal(recoveryReply(h),'My last point was: You do not currently get any rebates or payments on a card each month.');
 assert.equal(recoveryReply([assistant(clarification),assistant('Got it. Okay. Thank you very much for that.')]),'');
});
test('REC-166 guessed translations and REC-178 unsupported positive acknowledgments never reach speech',()=>{
 const {groundedReplyText}=require('../gateway/conversation-recovery.cjs');
 assert.equal(groundedReplyText('I see you said "No las pagas de," which I think means you don’t get payments or rebates.','No las pagas de'),'');
 assert.equal(groundedReplyText("That’s really nice to hear! I'm calling about your account.","Oh we're making up smells comfortable."),"I'm calling about your account.");
 assert.equal(groundedReplyText("That's really nice to hear!", "I'm doing well."),"That's really nice to hear!");
 assert.equal(groundedReplyText('No means no.','What does no mean?'),'No means no.');
});
