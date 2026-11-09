const {test}=require('node:test');
const assert=require('node:assert/strict');
const {speechBoundary}=require('../gateway/speech-boundary.cjs');
test('phrase mode emits a substantial complete clause before a sentence finishes',()=>{
  const clause='We can help you arrange a clinic appointment,';
  assert.equal(speechBoundary(clause+' and staff will confirm the time',true),clause.length);
  assert.equal(speechBoundary(clause,true),0,'wait for next-token whitespace');
});
test('phrase mode retains decimal amounts, times, abbreviations and small fragments',()=>{
  for(const text of ['Yes, please continue','Please speak to Dr. Smith about your visit','The consultation fee is 2,000.50 PKR','Please arrive at 3:30 PM','The consultation fee is PKR, 2000'])assert.equal(speechBoundary(text,true),0,text);
  const sentence='The consultation fee is 2,000.50 PKR.';
  assert.equal(speechBoundary(sentence+' Staff will confirm.',true),sentence.length);
});
