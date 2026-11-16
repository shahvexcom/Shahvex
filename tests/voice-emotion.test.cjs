const {test}=require('node:test'),assert=require('node:assert/strict');
const {createEmotionSelector}=require('../gateway/voice-emotion.cjs');
const select=(customerText,extra={})=>createEmotionSelector({voice:'lissa',enabled:true,customerText,...extra});
test('only approved Lissa expressions are selected from matching customer and reply context',()=>{
 assert.equal(select('hahaha that was funny')('That really made me smile.'),'laugh');
 assert.equal(select('My father passed away.')("I'm really sorry to hear that."),'sad');
 assert.equal(select("You won't believe what happened unexpectedly.")("Oh, really? I wasn't expecting that."),'surprise');
 assert.equal(select('I got good news!')("That's wonderful news."),'neutral');
 assert.equal(select('I am confused.')('We can take this one step at a time.'),'reassure');
 assert.equal(select('hahaha that was funny',{voice:'af_heart'})('That was funny.'),'neutral');
 assert.equal(select('hahaha that was funny',{enabled:false})('That was funny.'),'neutral');
 assert.equal(select('')('That was funny.'),'neutral');
});
test('distress, refusals and emergency context cannot produce laughter or surprise',()=>{
 assert.equal(select('My father died, hahaha.')('That really made me smile.'),'neutral');
 assert.equal(select('It is not funny. Do not laugh, lol.')('That was funny.'),'neutral');
 assert.equal(select("I can't breathe. I'm terrified.")("I'm sorry to hear that."),'neutral');
 assert.equal(select('I have chest pain, suddenly.')('Oh, really?'),'neutral');
});
test('one expression per reply, cooldown across turns, and per-conversation cap',()=>{
 const state={turn:0};let choose=select('hahaha that was funny',{state});
 assert.equal(choose('That was funny.'),'laugh');assert.equal(choose('That was funny.'),'neutral');
 for(let n=0;n<3;n++)assert.equal(select('hahaha that was funny',{state})('That was funny.'),'neutral');
 assert.equal(select('hahaha that was funny',{state})('That was funny.'),'laugh');
 assert.equal(select('hahaha that was funny',{state:{turn:99,total:6}})('That was funny.'),'neutral');
});
test('calm reassurance is contextual and never replaces distress or crisis handling',()=>{
 assert.equal(select('I am feeling worried and confused.')('I understand.'),'reassure');
 assert.equal(select('I do not understand this.')('We can take this one step at a time.'),'reassure');
 assert.equal(select('I am worried, lol.')('That was funny.'),'neutral');
 assert.equal(select('I am worried, my father passed away.')("I'm sorry to hear that."),'sad');
 assert.equal(select("I can't breathe and feel anxious.")('I understand.'),'neutral');
 assert.equal(select('Everything is fine.')('I understand.'),'neutral');
});
test('explicit expression questions receive a voice-capability answer and requested laugh',()=>{
 const {expressionCapabilityReply}=require('../gateway/voice-emotion.cjs');
 assert.equal(expressionCapabilityReply('Do you have expressions?'),'Yes, I do have expressions.');
 assert.equal(expressionCapabilityReply('What expressions do you have?'),'Yes, I do have expressions.');
 assert.equal(expressionCapabilityReply('teray pass expression hay?'),'Yes, I do have expressions.');
 for(const q of ['Do you have a regular expression for phone numbers?','Do you have facial expressions?',"Please don't call me. Do you have expressions?",'Do you have real feelings and expressions?',"Do you have expressions? Don't laugh.",'My father died. Do you have expressions?'])assert.equal(expressionCapabilityReply(q),undefined);
 const state={turn:5,lastTurn:5,total:6};const choice=select('Do you have expressions?',{state});
 assert.equal(choice('Yes, I do have expressions.'),'laugh');assert.equal(choice('Yes, I do have expressions.'),'neutral');
 assert.equal(select('teray pass expression hay?')('Yes, I do have expressions.'),'laugh');
});
test('casual AI identity answers use a chuckle only with a truthful AI admission',()=>{
 const {isAiIdentityQuestion,identityVoiceReply}=require('../gateway/voice-emotion.cjs');
 for(const q of ['Are you an AI?','Are you human?','Am I speaking to a human?','tum AI ho?']){
  assert.equal(isAiIdentityQuestion(q),true);assert.equal(identityVoiceReply(q,"I'm an AI assistant."),true);assert.equal(select(q)("I'm an AI assistant."),'laugh');
 }
 for(const q of ["Are you AI? Please don't laugh.",'Are you AI? I am worried.','Are you AI? This is serious.',"I can't breathe. Are you human?"]){assert.equal(identityVoiceReply(q,"I'm an AI assistant."),false);assert.equal(select(q)("I'm an AI assistant."),'neutral');}
 assert.equal(identityVoiceReply('Are you AI?',"I'm a human, not an AI."),false);assert.equal(isAiIdentityQuestion('What is artificial intelligence?'),false);
});

test('explicit English and Roman Urdu smile/laugh requests use one acoustic chuckle',()=>{
 const {expressionCapabilityReply}=require('../gateway/voice-emotion.cjs');
 for(const q of ['Smile','Please laugh','Can you laugh for me?','Show me your smile','laugh kr k dikhao','hans kar ke dikhao','smile kr k dikhao']){
  assert.equal(expressionCapabilityReply(q),'Yes, I can.',q);
  const choose=select(q,{state:{turn:10,lastTurn:10,total:6}});
  assert.equal(choose('Yes, I can.'),'laugh',q);
  assert.equal(choose('Yes, I can.'),'neutral',q);
 }
 for(const q of ["Don't laugh",'My father died. Please laugh','What makes people laugh?','Show me a regular expression']) assert.equal(expressionCapabilityReply(q),undefined,q);
});

test('explicit sad, surprised and reassuring voice demonstrations select the approved expression',()=>{
 const {expressionCapabilityReply}=require('../gateway/voice-emotion.cjs');
 for(const [request,emotion]of [['Can you cry?','sad'],['Please sound surprised.','surprise'],['Use a reassuring voice.','reassure']]){const text=expressionCapabilityReply(request);assert.ok(text,request);assert.equal(select(request)(text),emotion);}
});
