const {test}=require('node:test'),assert=require('node:assert/strict');
const {rememberQuestions:memory}=require('../gateway/question-memory.cjs');
const A=content=>({role:'assistant',content}),U=content=>({role:'user',content});
test('retains spoken-number answers and earlier facts over long side conversations',()=>{
 const h=[A('Are you getting a rebate?'),U('Yes.'),A('How old are you?'),U('Sixty-seven.')];
 for(let i=0;i<80;i++)h.push(U('Who are you?'),A("I'm Lauren."));
 h.push(A('May I know your full name?'),U('Hassan Ali.'));
 assert.deepEqual(memory(h).completed,[{question:'Are you getting a rebate?',response:'Yes.'},{question:'How old are you?',response:'Sixty-seven.'},{question:'May I know your full name?',response:'Hassan Ali.'}]);assert.equal(memory(h).pendingQuestion,null);
});
test('courtesy and audio checks preserve the unanswered business question',()=>{
 const h=[A('How old are you?'),U('Who are you?'),A('How are you today?'),U("I'm good."),A('Are you still there?'),U("Yes, I'm here.")];
 assert.equal(memory(h).pendingQuestion,'How old are you?');assert.ok(!memory(h).completed.some(a=>a.question==='How old are you?'));
 h.push(A('How old are you?'),U("I'm sixty seven."));assert.equal(memory(h).pendingQuestion,null);
});
test('repeated completed questions cannot erase an answer and corrections preserve the latest raw reply',()=>{
 const h=[A('How old are you?'),U('Sixty-seven.'),A('How old are you?'),U('You already asked me.'),U("Actually, I'm sixty-eight.")];
 assert.deepEqual(memory(h).completed,[{question:'How old are you?',response:"Actually, I'm sixty-eight."}]);assert.equal(memory(h).pendingQuestion,null);
});
test('okay and unrelated numbers are not age answers; unanswered earlier steps remain deferred',()=>{
 const h=[A('How old are you?'),U('Okay.'),U('I have 3 dogs.'),A('Which state do you live in?'),U('New York.')];
 const m=memory(h);assert.ok(!m.completed.some(a=>a.question==='How old are you?'));assert.equal(m.pendingQuestion,'How old are you?');
});
test('an interrupted question never turns a bare yes into a confirmed answer',()=>{
 const m=memory([A('Do you have coverage? [interrupted]'),U('Yes')]);assert.equal(m.completed.length,0);
});
test('an age correction cannot overwrite the name answer',()=>{
 const m=memory([A('How old are you?'),U('Sixty-seven.'),A('What is your full name?'),U('Hassan Ali.'),U("Actually, I'm sixty-eight.")]);assert.deepEqual(m.completed,[{question:'How old are you?',response:"Actually, I'm sixty-eight."},{question:'What is your full name?',response:'Hassan Ali.'}]);
});
test('a direct age answer after a courtesy detour still belongs to the pending age question',()=>{
 const m=memory([A('How old are you?'),U('How are you?'),A('How is your day?'),U("I'm fine."),A('Thank you.'),U('Sixty-seven.')]);assert.deepEqual(m.completed,[{question:'How old are you?',response:'Sixty-seven.'}]);assert.equal(m.pendingQuestion,null);
});
test('refused personal details stay unknown and an explicit deferred answer can still be remembered',()=>{
 let m=memory([A('What is your full name?'),U('Not saying.')]);assert.equal(m.completed.length,0);
 m=memory([A('How old are you?'),U('Wait.'),A('Which state do you live in?'),U('I live in New York.'),U("I'm sixty-seven.")]);assert.equal(m.completed.length,2);assert.equal(m.completed[1].response,"I'm sixty-seven.");assert.equal(m.pendingQuestion,null);
});

test('an old wellbeing greeting never becomes the pending business step after screening is complete',()=>{const h=[{role:'assistant',content:'How are you today?'},{role:'user',content:"I'm good."},{role:'assistant',content:'Do you have coverage?'},{role:'user',content:'Yes.'}];assert.equal(memory(h).pendingQuestion,null);});

test('current audio or side questions are not reused as an earlier qualification answer with the same text',()=>{
 const h=[A('Do you receive a rebate?'),U('No.'),A('Do you have Medicaid?'),U('Yes.'),A('Can you hear me clearly?'),U('Yes.')];
 const m=memory(h);assert.equal(m.latestAnswer,null);assert.equal(m.completed.find(a=>a.question==='Do you have Medicaid?').response,'Yes.');
});
