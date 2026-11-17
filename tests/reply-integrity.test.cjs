const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReplayGuard,scriptQuestionProgress,nextScriptQuestion,customerFloorReply}=require('../gateway/reply-integrity.cjs');
const script=`Are you currently getting any rebate or money back on a card each month?
If customer say yes
That's wonderful.
If customer says No
Got it, do you currently have medicare part A or part B or medicaid?
Whatever customer answer,
Great, are you currently between 60 and 80 years old?
Let me connect you with a licensed specialist.`;
const q1='Are you currently getting any rebate or money back on a card each month?',q2='Got it, do you currently have medicare part A or part B or medicaid?',q3='are you currently between 60 and 80 years old?';
test('yes and no branches both retain age as required; unknown branch is unresolved',()=>{
 for(const response of ['Yes.','No.']){
 const memory={completed:[{question:q1,response}],pendingQuestion:null};const p=scriptQuestionProgress(script,memory);
 assert.equal(p.length,3);assert.equal(p[1].applicability,response==='Yes.'?'not_applicable':'required');assert.equal(p[2].applicability,'required');assert.equal(p[2].status,'pending');
 assert.equal(nextScriptQuestion(script,memory,response),response==='Yes.'?q3:q2.slice(8));
 }
 assert.equal(scriptQuestionProgress(script,{completed:[]})[1].applicability,'unresolved');
});
test('the supplied call cannot jump from coverage to transfer while age is missing',()=>{
 const memory={completed:[{question:q1,response:'Yes.'},{question:q2,response:'Part A and B.'}]};
 assert.equal(nextScriptQuestion(script,memory,'Part A and B.'),q3);
 for(const text of ['What does that mean?','Just tell me one thing.',"I don't know."])assert.equal(nextScriptQuestion(script,memory,text),undefined);
});
test('customer asking for the floor is invited to ask, without a sales question',()=>{
 for(const text of ['So really just tell me one thing.','Just tell me one thing.',"I'm saying just tell me one thing.",'Can I ask you a question?','Let me ask.'])assert.equal(customerFloorReply(text),'Of course. What would you like to ask?');
 for(const text of ['Tell me one thing, is it free?','Yes.','What is Medicare?'])assert.equal(customerFloorReply(text),undefined);
});
test('explicit repeats are allowed and new explanations are not suppressed',()=>{
 const history=[{role:'assistant',content:'Your appointment is on Tuesday.'}];
 assert.equal(createReplayGuard(history,'Repeat that please.').allow('Your appointment is on Tuesday.'),true);
 assert.equal(createReplayGuard(history,'Why Tuesday?').allow('The office has availability that day.'),true);
 const guard=createReplayGuard(history,'Okay.');assert.equal(guard.allow('Your appointment is on Tuesday.'),false);
 assert.equal(guard.blocked,1);
});

test('near-verbatim pitch replays and unsolicited copies of customer facts are rejected',()=>{
 const h=[{role:'assistant',content:"I'm calling because 2026 rebate updates just came out and many people are overcharged by Medicare."},{role:'user',content:'Part A and B.'}];
 const guard=createReplayGuard(h,'Are you serious?');
 assert.equal(guard.allow("I'm calling because 2026 rebate updates just came out, and many people are overcharged by Medicare."),false);
 assert.equal(guard.allow('Part A and B.'),false);
 assert.equal(createReplayGuard(h,'What do you need?').allow('Part A and B.'),false);
});
test('a fragmented request for the floor remains pending; refund skepticism gets a truthful limitation',()=>{
 const h=[{role:'user',content:'So really just tell me one thing.'}];
 assert.equal(customerFloorReply('It is good.',h),'Of course. What would you like to ask?');
 assert.match(customerFloorReply('Are you serious?',[{role:'assistant',content:'It looks like you may have a refund owed.'}]),/can.t confirm.*refund/);
});
test('complex conditions and optional wording stay with the grounded model',()=>{
 for(const prefix of ['Optional: ','If you live in Texas, ','Read exactly: '])assert.equal(nextScriptQuestion(prefix+script,{completed:[{question:q1,response:'Yes.'}]},'Yes.'),undefined);
});

test('initials in a coverage answer cannot hide a copied customer line inside a combined speech unit',()=>{const guard=createReplayGuard([{role:'user',content:'Part A and B.'},{role:'assistant',content:'Perfect, it looks like you may have a refund owed.'}],'Okay');assert.equal(guard.allow('Part A and B. Perfect, it looks like you may have a refund owed.'),false);});

test('routine completion offers a human without claiming a refund and cannot re-offer after a consent refusal',()=>{
 const {routineHandoffOffer}=require('../gateway/handoff-intent.cjs');
 const s=script.replace('Let me connect you with a licensed specialist.','Let me connect you with a licensed specialist who can review your plan.');
 const completed=[{question:q1,response:'No.'},{question:q2,response:'Medicaid.'},{question:q3,response:'Yeah.'}];
 const offer=routineHandoffOffer(s,{completed},'Yeah.');assert.match(offer,/Would you like me to connect you\?/);assert.doesNotMatch(offer,/refund owed|eligible|please wait/);
 assert.equal(routineHandoffOffer(s,{completed:completed.slice(0,2)},'Medicaid.'),undefined);
 assert.equal(routineHandoffOffer(s,{completed:[...completed,{question:offer,response:'No.'}]},'No.'),undefined);
 assert.equal(routineHandoffOffer(s,{completed:[...completed,{question:offer,response:'Yes.'}]},'Yes.'),undefined);
});
