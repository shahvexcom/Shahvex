'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createTesterService} = require('../gateway/tester-service.cjs');
const {scriptQuestionProgress} = require('../gateway/reply-integrity.cjs');
const {questionParts, suppliedParts} = require('../gateway/question-memory.cjs');

const address = 'What is your address and ZIP code?';
const coverage = 'Do you have Medicare Part A, Part B, or Medicaid?';
const next = 'What is your full name?';
const three = 'What are your address, ZIP code, and email address?';

test('question checklist excludes reference material and respects prohibitions and branch order', () => {
 const start = 'Do you have a plan?';
 const script = `Tasks:
 ${start}
 If no: ${coverage}
 If yes: What is your age?
 Regardless:
 ${address}
 Restrictions:
 Do not ask about age.
 FAQ:
 ${next}
 Examples:
 Are you receiving a rebate?`;
 const checklist = response => scriptQuestionProgress(script,{completed:response?[{question:start,response}]:[]});
 assert.deepEqual(checklist().map(item=>item.question),[start,coverage,address]);
 assert.deepEqual(checklist('No.').map(item=>item.applicability),['required','required','required']);
 assert.deepEqual(checklist('Yes.').map(item=>item.applicability),['required','not_applicable','required']);
 assert.equal(checklist()[1].applicability,'unresolved');
 assert.deepEqual(questionParts(coverage),[]);
 assert.deepEqual(questionParts('Do you like research and development?'),[]);
 assert.equal(suppliedParts(questionParts(address),'Okay').size,0);
});

test('playback-tracked sessions keep script and independently supplied parts isolated', async () => {
 const secret = 'planning-fixture-'.repeat(4);
 const service = createTesterService({secret,testHooks:true,maxSessions:8});
 const original = global.fetch;
 global.fetch = async url => String(url).includes('11434')
  ? new Response(JSON.stringify({message:{content:'The review uses the details you provide. '+coverage},done:true})+'\n')
  : new Response(new Uint8Array(4800).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});
 const ids = [];
 const owners = new Map();
 const call = (action,id,body) => service.dispatch(new Request('http://fixture/tester/'+action,{
  method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'planning-'+(id ? owners.get(id) : body.agentId),'x-shahvex-session':id||'none','x-shahvex-turn':randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)
 }));
 async function turn(id,body,ack=true) {
  const result = await call('turn',id,body);
  assert.equal(result.status,200);
  const events = (await result.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(events.filter(event=>event.type==='error'),[]);
  const turnId = events.find(event=>event.type==='done')?.turnId;
  if (ack && events.some(event=>event.type==='pcm')) await call('playback-complete',id,{completedTurnId:turnId});
  return {text:events.filter(event=>event.type==='delta').map(event=>event.text).join(''),turnId};
 }
 async function start(script) {
  const agentId = randomUUID();
  const result = await call('start',null,{agentId,requirePlaybackAck:true,config:{
   name:'Lauren',first:'ai',voice:'planning-fixture',script:'Hi, this is Lauren from Wellness Team. I am calling to review your account.\n'+script,goal:'Review your account',task:'Follow the assigned script',instructions:'',knowledge:'',style:'Natural'
  }});
  const {id}=await result.json();
  assert.ok(id);
  ids.push(id);
  owners.set(id,agentId);
  await turn(id,{opening:true});
  await turn(id,{text:'Okay'});
  return id;
 }
 try {
  const [first,second] = await Promise.all([start(address+'\n'+next),start(three+'\n'+coverage)]);
  const [firstAsk,secondAsk] = await Promise.all([turn(first,{text:'Yes'},false),turn(second,{text:'Yes'})]);
  assert.equal(firstAsk.text,address);
  assert.equal(secondAsk.text,three);
  const zipRequest = await turn(first,{text:'12 Main Street'},false);
  assert.equal(zipRequest.text,'And your ZIP code?');
  const firstSession = service.sessionStore.get(first);
  assert.equal(firstSession.questionLedger.values().next().value.status,'pending');
  await call('interrupt',first,{});
  await call('playback-complete',first,{completedTurnId:zipRequest.turnId});
  await call('playback-complete',first,{completedTurnId:firstAsk.turnId});
  assert.equal((await turn(second,{text:'85001, sam@example.com'})).text,'And your address?');
  assert.match((await turn(first,{text:'I can hear you now.'})).text,/And your ZIP code\?/);
  assert.match((await turn(first,{text:'Who are you?'})).text,/Lauren.*And your ZIP code\?/s);
  assert.match((await turn(first,{text:'Why do you need that?'})).text,/And your ZIP code\?/);
  assert.equal((await turn(second,{text:'34 Elm Road'})).text,coverage);
  assert.doesNotMatch((await turn(second,{text:'Medicaid.'})).text,/Part A|Part B|Medicaid/);
  assert.equal((await turn(first,{text:'85002'})).text,next);
  assert.doesNotMatch((await turn(first,{text:'Avery Lee'})).text,/Medicare|Medicaid|full name|ZIP code/i);

  const zipFirst=await start(address+'\n'+next);
  await turn(zipFirst,{text:'Yes'});
  assert.equal((await turn(zipFirst,{text:'85001'})).text,'And your address?');
  assert.equal((await turn(zipFirst,{text:'12 Main Street'})).text,next);

  const together=await start(address+'\n'+next);
  await turn(together,{text:'Yes'});
  assert.equal((await turn(together,{text:'12 Main Street, 85001'})).text,next);
  assert.equal(service.sessionStore.get(together).questionLedger.values().next().value.response,'12 Main Street, 85001');
  assert.doesNotMatch((await turn(together,{text:'What does that mean?'})).text,/Medicare|Medicaid|ZIP code/);

  const branched=await start('Do you have a plan?\nIf no: '+coverage+'\nIf yes: What is your age?\nRegardless:\n'+address+'\nRestrictions:\nNever ask about age.');
  await turn(branched,{text:'Yes'});
  assert.equal((await turn(branched,{text:'Yes'})).text,address);
  const alternate=await start('Do you have a plan?\nIf no: '+coverage+'\nRegardless:\n'+address);
  await turn(alternate,{text:'Yes'});
  assert.equal((await turn(alternate,{text:'No'})).text,coverage);
  assert.equal((await turn(alternate,{text:'I have Part B'})).text,address);
 } finally {
  await Promise.all(ids.map(id=>call('stop',id,{})));
  global.fetch=original;
 }
});
