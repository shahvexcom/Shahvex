'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareLockedChoice,hash}=require('../gateway/style-review/locked-response-review.cjs');
function fixture(){
  const first='I am Jennifer, an automated assistant. ',fact='This is a synthetic demonstration. ',optional='I can explain the next step. ',last='May I continue?';
  const script=first+fact+optional+last;let pos=0;
  const regions=[['disclosure','verbatim',first],['fact','fact',fact],['opening','optional',optional],['consent','verbatim',last]].map(([id,kind,text])=>{const r={id,kind,start:pos,end:pos+text.length};pos=r.end;if(kind==='optional')r.choices=[optional,'I can explain this step by step. '];return r;});
  const parts=choice=>[{region:'disclosure'},{region:'fact'},{region:'opening',choice},{region:'consent'}];
  const policy={approved:true,agentId:'fixture',campaignId:'fixture',scriptSha256:hash(script),regions,responses:[0,1].map(n=>({id:'reply_'+n,states:['consent-step'],requiredInOrder:['disclosure','fact','consent'],parts:parts(n)}))};
  return {enabled:true,localAuthorized:true,agentId:'fixture',campaignId:'fixture',script,state:'consent-step',policy};
}
test('default-off, wrong script/context/state or unclassified regions deny activation',()=>{
  assert.equal(prepareLockedChoice(),null);
  for(const edit of [{enabled:false},{localAuthorized:false},{agentId:'other'},{campaignId:'other'},{script:'changed'},{state:'not-authorized'}])assert.equal(prepareLockedChoice({...fixture(),...edit}),null);
  const f=fixture();f.policy.regions[2].kind='unclear';assert.equal(prepareLockedChoice(f),null);
});
test('only approved response IDs render exact server-source literals; generated paraphrases/extra fields rejected',()=>{
  const f=fixture(),r=prepareLockedChoice(f);assert.ok(r.ids.includes('reply_1'));
  const text=r.render('{"responseId":"reply_1"}');assert.ok(text.startsWith('I am Jennifer, an automated assistant. This is a synthetic demonstration. '));assert.ok(text.endsWith('May I continue?'));
  for(const x of ['{"responseId":"unknown"}','{"responseId":"reply_1","text":"Changed mandatory words"}','Free-form model speech'])assert.throws(()=>r.render(x));
  f.policy.regions[0].start=9;f.policy.responses[1].parts=[];assert.equal(r.render('{"responseId":"reply_1"}'),text);
});
test('missing/reordered required text, literal override and unapproved optional choice fail before audio',()=>{
  const edits=[f=>f.policy.responses[0].parts.shift(),f=>f.policy.responses[0].parts.reverse(),f=>f.policy.responses[0].parts[0].choice=0,f=>f.policy.responses[0].parts[2].choice=99];
  for(const edit of edits){const f=fixture();edit(f);assert.throws(()=>prepareLockedChoice(f));}
});
