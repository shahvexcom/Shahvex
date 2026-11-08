const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
const {Gateway}=require('../gateway/core.cjs');const {sessionScript}=require('../gateway/test-script.cjs');
test('assigned/custom scripts are isolated per session and persist across turns; empty STT skips LLM',async()=>{
  const assigned='Disclose automation; obtain consent before proceeding.';
  const custom=sessionScript(assigned,'Be warm and brief.');assert.ok(custom.includes(assigned));assert.ok(custom.includes('Be warm and brief.'));
  assert.equal(sessionScript(assigned),assigned);assert.throws(()=>sessionScript(assigned,123));assert.throws(()=>sessionScript(assigned,'x'.repeat(16001)));
  let speech='',models=0;const messages=[];const g=new Gateway({maxSessions:2,voices:[{id:'fixture',verified:true}],stt:async()=>speech,llm:async m=>{models++;messages.push(m);return 'Response';},tts:async()=>Buffer.alloc(640)});
  const config={campaignId:'fixture',voiceId:'fixture',script:assigned,direction:'inbound'};
  const a=g.create('a',config),b=g.create('b',{...config,script:custom});
  assert.equal((await g.turn('a',a,Buffer.alloc(640))).skipped,true);assert.equal(models,0);
  speech='First';await g.turn('b',b,Buffer.alloc(640));speech='Follow up';await g.turn('b',b,Buffer.alloc(640));
  assert.ok(messages.every(m=>m[0].content.endsWith(custom)));assert.equal(messages[1][1].content,'First');assert.equal(g.owned('a',a).history.length,0);assert.equal(g.owned('a',a).config.script,assigned);
  g.stt=async()=>{throw new DOMException('fixture timeout','TimeoutError');};await assert.rejects(g.turn('b',b,Buffer.alloc(640)));assert.equal(g.sessions.size,2);
  g.stt=async()=> 'Recovered';await g.turn('b',b,Buffer.alloc(640));assert.equal(g.owned('b',b).history.at(-2).content,'Recovered');g.close('a',a);g.close('b',b);
});
function recorder(){const code=ts.transpileModule(fs.readFileSync('lib/browser-conversation-recorder.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};new Function('module','exports',code)(mod,mod.exports);return mod.exports.ConversationRecorder;}
test('recording exports ordered mixed-stream blobs locally and discards on close',()=>{
  const prior=global.MediaRecorder;let native;
  global.MediaRecorder=class{static isTypeSupported(t){return t==='audio/webm;codecs=opus';}state='inactive';constructor(stream){assert.equal(stream.kind,'actual-web-audio-mix');native=this;}start(){this.state='recording';}stop(){this.state='inactive';this.onstop();}};
  try{const Recorder=recorder();const r=new Recorder();let result;const fail=m=>{throw Error(m);};r.start({kind:'actual-web-audio-mix'},b=>{result=b;},fail);native.ondataavailable({data:new Blob(['first-timed-chunk'])});native.ondataavailable({data:new Blob(['second-timed-chunk'])});r.stop();assert.ok(result.size>0);assert.equal(result.type,'audio/webm;codecs=opus');
    const second=new Recorder();let emitted=false;second.start({kind:'actual-web-audio-mix'},()=>{emitted=true;},fail);second.discard();assert.equal(emitted,false);
  }finally{global.MediaRecorder=prior;}
});
test('recording export errors surface explicitly rather than producing a fake download',()=>{
  const prior=global.MediaRecorder;let native;
  global.MediaRecorder=class{static isTypeSupported(){return true;}state='inactive';constructor(){native=this;}start(){this.state='recording';}stop(){this.state='inactive';this.onstop();}};
  try{const Recorder=recorder();let errors=[],emitted=false;const r=new Recorder();r.start({},()=>{emitted=true;},m=>errors.push(m));r.stop();assert.equal(emitted,false);assert.match(errors[0],/No recorded audio/);
    const broken=new Recorder();errors=[];broken.start({},()=>{emitted=true;},m=>errors.push(m));native.onerror();assert.equal(emitted,false);assert.match(errors[0],/recording failed/);
  }finally{global.MediaRecorder=prior;}
});
