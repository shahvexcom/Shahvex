const {test}=require('node:test');
const assert=require('node:assert/strict');
const {speechText}=require('../gateway/speech-text.cjs');
test('explicit currency amounts are spoken as values rather than digits',()=>{
  assert.equal(speechText('The fee is 2,000 PKR.'),'The fee is two thousand Pakistani rupees.');
  assert.equal(speechText('PKR 2000 and Rs. 1500'),'two thousand Pakistani rupees and one thousand five hundred Pakistani rupees');
  assert.equal(speechText('2000.50 PKR'),'two thousand Pakistani rupees and fifty paisa');
  assert.equal(speechText('USD 1'),'one US dollar');
  assert.equal(speechText('Call 03001234567 at 3 PM, reference 2000.'),'Call 03001234567 at 3 PM, reference 2000.');
});
