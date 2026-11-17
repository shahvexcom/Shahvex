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
