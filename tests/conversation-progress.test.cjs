const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const {createTesterService}=require('../gateway/tester-service.cjs');
const mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-test.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n==='server-only'?{}:require(n),mod,mod.exports);
const {conversationProgress,questionToRepeat,directConversationReply,briefTimeOffer,isInitialGreetingReply}=mod.exports;
const assistant=content=>({role:'assistant',content}),user=content=>({role:'user',content});

test('only a greeting immediately after the introduction takes the short outbound-purpose path',()=>{
  const history=[assistant('Hi, this is Max from Shahvex.')];
  for(const text of ['Hi Max, how are you?','Hello.','How are you doing?','Okay.'])assert.equal(isInitialGreetingReply(history,text),true,text);
  for(const text of ['Hi, stop calling me.','Hi, I am busy.','Hi, why are you calling?','Who are you?','What is virtual?',''])assert.equal(isInitialGreetingReply(history,text),false,text);
  assert.equal(isInitialGreetingReply([assistant('Do you have time?')],'Yes.'),false);
  assert.equal(isInitialGreetingReply([...history,user('Hi.'),assistant('Do you have time?')],'Hello.'),false);
});

test('definitions and identity questions stay short, truthful and do not repeat a name',()=>{
  const history=[assistant('Hi, this is Max from Shahvex.')];
  for(const question of ['What is virtual?','But uh what did you said? Virtual what?']){
    const reply=directConversationReply(history,question).text;
    assert.match(reply,/AI assistant/);assert.doesNotMatch(reply,/Max|Shahvex/);
  }
  for(const question of ['By the way, are you a live person?','Virtual calling assistant is a type of AI, right?','Are you human?'])assert.equal(directConversationReply(history,question).text,"I'm an AI calling assistant.");
  assert.equal(directConversationReply(history,'What is Shahvex?').text,"That's the company I'm calling on behalf of.");
  assert.equal(directConversationReply(history,'What is another company?'),undefined);
  assert.match(directConversationReply(history,'How much time is this going to take?').text,/can't confirm/);
});

test('one short time request is allowed, but explicit refusals and offered time are not treated as soft objections',()=>{
  assert.deepEqual(directConversationReply([],"I don't have time."),{text:briefTimeOffer,timeOffer:true});
  assert.equal(directConversationReply([assistant(briefTimeOffer)],'No.',true).text,"Understood. I'll let you go. Thank you.");
  assert.equal(directConversationReply([],"I'm busy",true).timeOffer,undefined);
  for(const text of ["I'm busy, don't call me again.","No thanks, I'm busy.","I only have five minutes.","I don't have any time right now. I only have around five minutes."]){assert.equal(directConversationReply([],text),undefined);}
});

test('short yes is tied to availability, without inventing later screening answers',()=>{
  const context=conversationProgress([assistant('A benefit review may be available. Do you have a quick minute?')],'Yes, I have.');
  const data=JSON.parse(context.split('\n')[1]);
  assert.equal(data.pendingQuestion,'Do you have a quick minute?');
  assert.equal(data.latestCustomerReply,'Yes, I have.');
  assert.deepEqual(data.recentQuestionResponses,[]);
  assert.match(context,/latest reply is YES/);
});

test('no answers only the pending question; unclear, compound and negative-polarity questions are not auto-confirmed',()=>{
  assert.match(conversationProgress([assistant('Do you receive that benefit?')],'No.'),/latest reply is NO/);
  for(const [q,a] of [['What is your age?','Yes'],['Do you have coverage? Are you interested?','Yes'],['Would you mind continuing?','Yes'],['Do you have coverage? [interrupted]','Yes'],['Do you have time?','Yes, but I am busy'],['Do you have time?','What do you mean?']]){
    assert.doesNotMatch(conversationProgress([assistant(q)],a),/latest reply is YES/);
  }
});

test('prior question responses remain evidence for moving beyond completed steps',()=>{
  const result=conversationProgress([assistant('Do you have time?'),user('Yes.'),assistant('Do you receive a benefit?'),user('No.'),assistant('Do you have coverage?')],'Yes.');
  const data=JSON.parse(result.split('\n')[1]);
  assert.equal(data.pendingQuestion,'Do you have coverage?');
  assert.deepEqual(data.recentQuestionResponses,[{question:'Do you have time?',response:'Yes.'},{question:'Do you receive a benefit?',response:'No.'}]);
});

test('repeat-last-question handling excludes identity requests, normal answers and interrupted turns',()=>{
  const history=[assistant('A long introductory explanation. Do you have a quick minute?')];
  assert.equal(questionToRepeat(history,'Uh yes I am. What you say, lastly?'),'Do you have a quick minute?');
  assert.equal(questionToRepeat(history,'Can you repeat that?'),'Do you have a quick minute?');
  for(const text of ['Yes, I have.','Repeat your name.','What company are you from?'])assert.equal(questionToRepeat(history,text),'');
  assert.equal(questionToRepeat([assistant('Do you have time? [interrupted]')],'Say that again?'),'');
});

test('real tester sends progress in the first system message and uses only the last question for a brief repeat',async()=>{
  const original=global.fetch,prompts=[];
  global.fetch=async(url,init)=>{
    if(String(url).includes('11434')){
      const messages=JSON.parse(init.body).messages;prompts.push(messages);
      return new Response(JSON.stringify({message:{content:prompts.length===1?'Do you receive a benefit?':'Does your plan include it?'},done:true})+'\n');
    }
    return new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
  };
  const secret='progress-test-secret-'.repeat(3),{dispatch,sessionStore}=createTesterService({secret,testHooks:true});let id;
  const call=(action,body)=>dispatch(new Request('http://local/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'progress-tests','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)}));
  try{
    const config={name:'Max',voice:'voice',first:'ai',goal:'Review options',task:'Ask about current benefits',instructions:'',script:'After permission ask about the existing benefit.',knowledge:'',style:'Natural'};
    id=(await(await call('start',{agentId:'a',config})).json()).id;
    sessionStore.get(id).messages.push(assistant('Hi, this is Max from Shahvex.'),user('Okay.'),assistant('I have a benefit review to discuss. Do you have a quick minute?'));
    for(const text of ['Yes, I have.','What did you say?']){
      const events=(await(await call('turn',{text})).text()).trim().split('\n').map(JSON.parse);
      assert.ok(!events.some(e=>e.type==='error'));
      assert.ok(events.some(e=>e.type==='pcm'));
    }
    assert.equal(prompts[0].filter(m=>m.role==='system').length,1);
    assert.match(prompts[0][0].content,/Current conversation progress/);
    assert.match(prompts[0][0].content,/latest reply is YES/);
    assert.equal(prompts[0].at(-1).content,'Yes, I have.');
    assert.equal(prompts[1].length,2);
    assert.deepEqual(JSON.parse(prompts[1][1].content),{lastQuestion:'Do you receive a benefit?'});
    assert.match(prompts[1][0].content,/fewer words and different wording/);
    assert.equal(sessionStore.get(id).messages.filter(m=>m.role==='user').length,3);
  }finally{if(id)await call('stop',{});global.fetch=original;}
});
