'use strict';
// Local-only comparison: one captured real Ollama stream, replayed identically
// through sentence vs phrase segmentation with real CosyVoice inference.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('lib/agent-test-stream.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('require','module','exports',code)(require,mod,mod.exports);
const folder=path.resolve('.data/pc-ai/phrase-compare');
function wav(pcm){const b=Buffer.alloc(44+pcm.length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length,40);pcm.copy(b,44);return b;}
async function main(){
  if(process.env.SHAHVEX_LOCAL_PHRASE_COMPARE!=='1')throw Error('Explicit local comparison opt-in required');
  fs.mkdirSync(folder,{recursive:true});
  const voice='male_02';
  const warm=await fetch('http://127.0.0.1:8767/synthesize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Ready for the local comparison.',voice_id:voice}),signal:AbortSignal.timeout(60000)});assert.ok(warm.ok);await warm.arrayBuffer();
  const expected='The consultation fee for your first clinic visit is 2,000 PKR, and our staff will confirm your appointment after checking the available times.';
  const start=performance.now(),captured=[];let pending='',text='';
  const llm=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'qwen3:4b-instruct',think:false,stream:true,options:{temperature:0},messages:[{role:'system',content:'Repeat the supplied sentence exactly. No preamble, no changes.'},{role:'user',content:expected}]}),signal:AbortSignal.timeout(60000)});assert.ok(llm.ok);
  const decoder=new TextDecoder();
  function capture(line){if(!line.trim())return;const d=JSON.parse(line);text+=d.message?.content||'';captured.push({at:performance.now()-start,line:line+'\n'});}
  for await(const chunk of llm.body){pending+=decoder.decode(chunk,{stream:true});let at;while((at=pending.indexOf('\n'))>=0){capture(pending.slice(0,at));pending=pending.slice(at+1);}}
  capture(pending+decoder.decode());assert.equal(text,expected);
  const results=[];
  for(const [trial,phrases] of [false,true,false,true].entries()){
    const began=performance.now(),pcm=[],timings=[],inputs=[];let full='';
    await mod.exports.streamAgentReply({phraseStreaming:phrases,messages:[],voice,signal:AbortSignal.timeout(120000),onText:value=>{full=value;},timing:async(stage,details)=>{timings.push({stage,ms:Math.round(performance.now()-began),...details});},send:async e=>{if(e.type==='pcm')pcm.push({ms:performance.now()-began,bytes:Buffer.from(e.data,'base64')});},engine:async(port,p,init)=>{
      if(port===11434)return new Response(new ReadableStream({async start(c){const replay=performance.now();for(const item of captured){await new Promise(r=>setTimeout(r,Math.max(0,item.at-(performance.now()-replay))));c.enqueue(Buffer.from(item.line));}c.close();}}));
      inputs.push(JSON.parse(init.body).text);return fetch(`http://127.0.0.1:${port}${p}`,init);
    }});
    assert.equal(full,expected);assert.ok(pcm.length);
    let offset=0;const frames=[];for(const part of pcm){const wanted=Math.round((part.ms-pcm[0].ms)*48/2)*2;if(wanted>offset){frames.push(Buffer.alloc(wanted-offset));offset=wanted;}frames.push(part.bytes);offset+=part.bytes.length;}
    const name=`${trial+1}-${phrases?'phrases':'sentences'}.wav`;fs.writeFileSync(path.join(folder,name),wav(Buffer.concat(frames)));
    const result={mode:phrases?'phrases':'sentences',file:name,firstPcmMs:Math.round(pcm[0].ms),firstTtsMs:timings.find(t=>t.stage==='tts-request-started').ms,ttsInputs:inputs};results.push(result);console.log(JSON.stringify(result));
  }
  fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({method:'Identical captured real Ollama token timing replay; real warm TTS; includes measured inter-phrase gaps in WAV',results},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
