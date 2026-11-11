const {test}=require('node:test');
const assert=require('node:assert/strict');
const {speechText,createSpeechRenderer}=require('../gateway/speech-text.cjs');
test('explicit currency amounts are spoken as values rather than digits',()=>{
  assert.equal(speechText('The fee is 2,000 PKR.'),'The fee is two thousand Pakistani rupees.');
  assert.equal(speechText('PKR 2000 and Rs. 1500'),'two thousand Pakistani rupees and one thousand five hundred Pakistani rupees');
  assert.equal(speechText('2000.50 PKR'),'two thousand Pakistani rupees and fifty paisa');
  assert.equal(speechText('USD 1'),'one US dollar');
  assert.equal(speechText('Call 03001234567 at 3 PM, reference 2000.'),'Call 03001234567 at 3 PM, reference 2000.');
});

test('emoji and non-spoken status markers are removed without deleting facts or ordinary words',()=>{
  assert.equal(speechText('Hi 😊 [interrupted] there 👨‍👩‍👧‍👦!'),'Hi there!');
  assert.equal(speechText('Okay 👍🏽 🇺🇸 1️⃣.'),'Okay.');
  assert.equal(speechText('I was interrupted. Plan [A] costs 20 USD.'),'I was interrupted. Plan [A] costs twenty US dollars.');
  assert.equal(speechText('[laugh] <warm>Hello</warm> [breath] <|im_end|>'),'Hello');
  assert.equal(speechText('You qualify [surprised] only if approved.'),'You qualify only if approved.');
});

test('Lissa effects are opt-in, engine-specific and limited to one event per reply',()=>{
  assert.equal(speechText('[laugh] Hello.',{voice:'lissa'}),'Hello.');
  assert.equal(speechText('[laugh] Hello.',{voice:'af_heart',expressive:true}),'Hello.');
  const render=createSpeechRenderer({voice:'lissa',expressive:true});
  assert.equal(render('[laugh] That was funny.'),'[laughter] That was funny.');
  assert.equal(render('[breath] Thank you.'),'Thank you.');
  const other=createSpeechRenderer({voice:'lissa',expressive:true});
  assert.equal(other('[surprised] Oh. [breathing] Okay.'),'Oh. [quick_breath] Okay.');
});
