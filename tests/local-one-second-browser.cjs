'use strict';
// Full local microphone -> STT -> LLM -> experimental TTS -> AudioWorklet check.
// Only localhost; uses synthetic microphone input and no website/DB accounts.
process.env.SHAHVEX_LOCAL_FAST_TTS='kokoro';process.env.SHAHVEX_PHRASE_STREAM='1';delete process.env.SHAHVEX_PC_AI_URL;
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),ts=require('typescript');
const {Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {chromium}=require('playwright');
const {createTesterService}=require('../gateway/tester-service.cjs');
const {decodeWav,resample}=require('../gateway/wav.cjs');
const overlap=process.env.SHAHVEX_LOCAL_OVERLAP==='1';
const productionDraft=process.env.SHAHVEX_PRODUCTION_DRAFT==='1';
const secret=crypto.randomBytes(32).toString('hex'),{dispatch:localDispatch,sessionStore}=createTesterService({secret,maxSessions:2,testHooks:true});
const publicTunnel=process.env.SHAHVEX_PUBLIC_TUNNEL_BENCH==='1';
let tunnelHeaders;
if(publicTunnel){
 require('@next/env').loadEnvConfig(process.cwd());
 const privateEnv=fs.readFileSync('.data/pc-ai/.env.pc-ai','utf8');
 const key=privateEnv.split(/\r?\n/).find(x=>x.startsWith('SHAHVEX_PC_AI_SECRET='))?.split('=').slice(1).join('=');
 if(!key||!process.env.SHAHVEX_CF_CLIENT_ID||!process.env.SHAHVEX_CF_CLIENT_SECRET)throw Error('Public verification credentials missing');
 tunnelHeaders={'x-shahvex-ai-key':key,'CF-Access-Client-Id':process.env.SHAHVEX_CF_CLIENT_ID,'CF-Access-Client-Secret':process.env.SHAHVEX_CF_CLIENT_SECRET};
}
async function dispatch(request){
 if(!publicTunnel)return localDispatch(request);
 const headers=new Headers(request.headers);for(const [key,value]of Object.entries(tunnelHeaders))headers.set(key,value);
 headers.set('x-shahvex-owner','approved-fast-voice-release-check');
 return fetch('https://ai.shahvex.com'+new URL(request.url).pathname,{method:request.method,headers,body:await request.arrayBuffer(),signal:AbortSignal.any([request.signal,AbortSignal.timeout(45000)])});
}
const resumption=process.env.SHAHVEX_LOCAL_RESUMPTION==='1',continuous=process.env.SHAHVEX_LOCAL_CONTINUOUS==='1';
const folder=path.resolve('.data/pc-ai/'+(publicTunnel?'public-tunnel-browser':productionDraft?'production-draft-browser':'one-second-browser')+(overlap?'-overlap':'')+(resumption?'-resumption':'')+(continuous?'-continuous':''));fs.mkdirSync(folder,{recursive:true});
const drafts=new Map();
let session='',voice='af_heart',base='';
const config=()=>({name:'Local Assistant',voice,first:'customer',goal:'Answer clinic questions',task:'Provide only the requested information',instructions:'Answer in exactly one short factual sentence. No greeting, no filler, no follow-up question.',script:'Consultation costs 2,000 PKR. The clinic is open Monday through Friday, 9 AM to 5 PM. Staff must confirm all appointment requests; you cannot confirm a booking.',knowledge:'',style:'Professional'});
async function call(action,body,type='application/json',draft=false,signal,targetSession){
  return dispatch(new Request(`http://127.0.0.1/tester/${action}`,{method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':draft?'one-second-browser-draft':'one-second-browser','x-shahvex-session':targetSession||session||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':type},body:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body),signal}));
}
const baselineHtml=`<!doctype html><button id="start">Start local fixture</button><script type="module">
import {BrowserSpeechCapture} from '/modules/browser-speech-capture.js';
import {BrowserPCMPlayer} from '/modules/browser-pcm-player.js';
window.debug={phase:'loaded',frames:0,maxRms:0};document.querySelector('button').onclick=async()=>{try{window.debug.phase='starting';
 const ctx=new AudioContext({sampleRate:16000});await ctx.resume();
 await ctx.audioWorklet.addModule('/shahvex-playback-worklet.js');
 await ctx.audioWorklet.addModule('/shahvex-microphone-worklet.js');
 const capture=new BrowserSpeechCapture();let sent=false,endAt=0;
 const player=new BrowserPCMPlayer(ctx,e=>{if(e.type==='started'&&!window.result)window.result={speechEndToPlaybackMs:Math.round(performance.now()-endAt),heard:window.heard,reply:window.reply};if(e.type==='playback-error')window.failure='Playback error';});
 const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
 window.debug.phase='microphone-ready';const source=ctx.createMediaStreamSource(stream),worklet=new AudioWorkletNode(ctx,'shahvex-microphone'),silent=ctx.createGain();silent.gain.value=0;source.connect(worklet);worklet.connect(silent);silent.connect(ctx.destination);
 worklet.port.onmessage=async({data})=>{if(sent)return;const result=capture.feed(new Int16Array(data),false);window.debug.frames++;window.debug.maxRms=Math.max(window.debug.maxRms,result.rms);if(!result.recording)return;sent=true;endAt=result.recording.speechEndedAtMs;stream.getTracks().forEach(t=>t.stop());
 try{const r=await fetch('/turn',{method:'POST',headers:{'content-type':'audio/wav'},body:result.recording.blob});if(!r.ok)throw Error('Turn HTTP '+r.status);const reader=r.body.getReader(),decoder=new TextDecoder();let pending='';
 while(true){const part=await reader.read();if(part.done)break;pending+=decoder.decode(part.value,{stream:true});let at;while((at=pending.indexOf('\\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line)continue;const e=JSON.parse(line);if(e.type==='error')throw Error(e.error);if(e.type==='user')window.heard=e.text;if(e.type==='delta')window.reply=(window.reply||'')+e.text;if(e.type==='pcm')await player.push(e.data,0,new AbortController().signal);if(e.type==='done'){player.end(0);window.completed=true;}}}
 }catch(e){window.failure=e.message;}
 };
}catch(e){window.failure=e.message;}};
</script>`;
const overlapHtml=`<!doctype html><button id="start">Start local fixture</button><script type="module">
import {BrowserSpeechCapture} from '/modules/browser-speech-capture.js';import {BrowserPCMPlayer} from '/modules/browser-pcm-player.js';
window.debug={drafts:0,cancelled:0};document.querySelector('button').onclick=async()=>{try{
 const ctx=new AudioContext({sampleRate:16000});await ctx.resume();await ctx.audioWorklet.addModule('/shahvex-playback-worklet.js');await ctx.audioWorklet.addModule('/shahvex-microphone-worklet.js');
 const capture=new BrowserSpeechCapture(true);let sent=false,endAt=0,current=null;
 const player=new BrowserPCMPlayer(ctx,e=>{if(e.type==='started'&&!window.result){if(!sent){window.failure='Draft audio played before endpoint';return;}window.result={speechEndToPlaybackMs:Math.round(performance.now()-endAt),drafts:window.debug.drafts,cancelled:window.debug.cancelled};}if(e.type==='playback-error')window.failure='Playback error';});
 async function apply(e){if(e.type==='error')throw Error(e.error);if(e.type==='user')window.heard=e.text;if(e.type==='delta')window.reply=(window.reply||'')+e.text;if(e.type==='pcm')await player.push(e.data,0,new AbortController().signal);if(e.type==='done'){player.end(0);window.completed=true;}}
 async function drain(d){if(d.draining||!d.committed||d.cancelled)return;d.draining=true;try{while(d.queue.length&&!d.cancelled)await apply(d.queue.shift());}finally{d.draining=false;}}
 async function readDraft(d,blob){try{const r=await fetch('/draft?token='+d.token,{method:'POST',signal:d.control.signal,headers:{'content-type':'audio/wav'},body:blob});if(!r.ok)throw Error('Draft HTTP '+r.status);const reader=r.body.getReader(),decoder=new TextDecoder();let pending='';while(true){const p=await reader.read();if(p.done)break;pending+=decoder.decode(p.value,{stream:true});let at;while((at=pending.indexOf('\\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(line){d.queue.push(JSON.parse(line));await drain(d);}}}}catch(e){if(!d.cancelled)window.failure=e.message;}}
 const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});const source=ctx.createMediaStreamSource(stream),node=new AudioWorkletNode(ctx,'shahvex-microphone'),silent=ctx.createGain();silent.gain.value=0;source.connect(node);node.connect(silent);silent.connect(ctx.destination);
 node.port.onmessage=async({data})=>{if(sent)return;const event=capture.feed(new Int16Array(data),false);
 if(event.draftInvalidated&&current&&!current.committed){current.cancelled=true;current.control.abort();void fetch('/cancel?token='+current.token,{method:'POST'});current=null;window.debug.cancelled++;}
 if(event.draft&&!current){current={token:crypto.randomUUID(),control:new AbortController(),queue:[],committed:false,cancelled:false,draining:false};window.debug.drafts++;void readDraft(current,event.draft.blob);}
 if(event.recording){sent=true;endAt=event.recording.speechEndedAtMs;stream.getTracks().forEach(t=>t.stop());try{if(!current)throw Error('Missing draft');const r=await fetch('/commit?token='+current.token,{method:'POST'});if(!r.ok)throw Error('Commit failed');current.committed=true;await drain(current);}catch(e){window.failure=e.message;}}
 };
}catch(e){window.failure=e.message;}};
</script>`;
const html=overlap?overlapHtml:baselineHtml;
function mergeDraft(tx){if(tx.committed&&tx.after&&session===tx.base&&sessionStore.has(session)){const base=sessionStore.get(session);base.messages=tx.after.map(x=>({...x}));base.lastSeen=Date.now();base.expires=Date.now()+1800000;}}
const server=http.createServer(async(req,res)=>{try{
 if(req.method==='GET'&&req.url==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
 if(req.method==='GET'&&req.url.startsWith('/modules/')){const name=req.url.slice('/modules/'.length).replace(/\.js$/,'');if(!['browser-speech-capture','browser-pcm-player','agent-test-audio'].includes(name)){res.writeHead(404).end();return;}res.setHeader('content-type','application/javascript');res.end(ts.transpileModule(fs.readFileSync(`lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);return;}
 if(['/shahvex-playback-worklet.js','/shahvex-microphone-worklet.js'].includes(req.url)){res.setHeader('content-type','application/javascript');res.end(fs.readFileSync('public'+req.url));return;}
 if(overlap&&req.method==='POST'&&req.headers.origin===base){
  const u=new URL(req.url,base),token=u.searchParams.get('token');
  if(['/draft','/commit','/cancel'].includes(u.pathname)){
   if(!token||!/^[a-f0-9-]{36}$/.test(token)){res.writeHead(400).end();return;}
   if(productionDraft){
    const parts=[];for await(const p of req)parts.push(p);
    const action=u.pathname.slice(1),headers={'x-shahvex-ai-key':secret,'x-shahvex-owner':'one-second-browser','x-shahvex-session':session,'x-shahvex-turn':token,'content-type':action==='draft'?'audio/wav':'application/json'};
    const control=new AbortController();res.once('close',()=>{if(!res.writableFinished)control.abort();});
    const r=await dispatch(new Request('http://127.0.0.1/tester/'+action,{method:'POST',headers,body:Buffer.concat(parts),signal:control.signal}));res.writeHead(r.status,Object.fromEntries(r.headers));await pipeline(Readable.fromWeb(r.body),res);return;
   }
   if(u.pathname==='/draft'){
    const parts=[];let size=0;for await(const p of req){size+=p.length;if(size>2000000)throw Error('Body limit');parts.push(p);}
    const started=await call('start',{agentId:'draft-local',config:config()},'application/json',true);if(!started.ok)throw Error('Draft start failed');const id=(await started.json()).id;
    const tx={id,base:session,committed:false,after:null,abort:new AbortController()};drafts.set(token,tx);sessionStore.get(id).messages=sessionStore.get(session).messages.map(x=>({...x}));res.once('close',()=>{if(!res.writableFinished)tx.abort.abort();});
    const r=await call('turn',Buffer.concat(parts),'audio/wav',true,tx.abort.signal,id);res.writeHead(r.status,Object.fromEntries(r.headers));try{await pipeline(Readable.fromWeb(r.body),res);}finally{tx.after=sessionStore.get(id)?.messages;mergeDraft(tx);}return;
   }
   const tx=drafts.get(token);if(!tx||tx.base!==session){res.writeHead(409).end();return;}
   if(u.pathname==='/commit'){tx.committed=true;mergeDraft(tx);res.writeHead(200).end();return;}
   tx.abort.abort();await call('interrupt',{},'application/json',true,undefined,tx.id);await call('stop',{},'application/json',true,undefined,tx.id);drafts.delete(token);res.writeHead(200).end();return;
  }
 }
 if(req.method==='POST'&&req.url==='/turn'&&req.headers.origin===base){const parts=[];let size=0;for await(const p of req){size+=p.length;if(size>2000000)throw Error('Body limit');parts.push(p);}const r=await call('turn',Buffer.concat(parts),'audio/wav');res.writeHead(r.status,Object.fromEntries(r.headers));await pipeline(Readable.fromWeb(r.body),res);return;}
 res.writeHead(404).end();
}catch{if(!res.headersSent)res.writeHead(503);res.end();}});
function makeWav(pcm){const b=Buffer.alloc(44+pcm.length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length,40);pcm.copy(b,44);return b;}
async function main(){
 if(process.env.SHAHVEX_LOCAL_BROWSER_LATENCY!=='1')throw Error('Explicit local browser opt-in required');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
 const results=[];
 try{
  // Warm model/context before the explicitly warm acceptance trials.
  session=(await(await call('start',{agentId:'local',config:config()})).json()).id;await(await call('turn',{text:'State your purpose briefly.'})).text();await call('stop',{});session='';
  const questions=continuous?['My name is Ali. I want Thursday at three PM.','What day and time did I request?','Actually change it to Friday at four PM.','Summarize my request.']:resumption?['What are the clinic opening hours?']:['What is the consultation fee?','What are the opening hours?','Is my appointment confirmed?'];
  for(const currentVoice of (publicTunnel?['af_heart']:['af_heart','am_michael']))for(const question of questions)for(let repeat=0;repeat<(continuous?1:2);repeat++){
   const roundStarted=Date.now();voice=currentVoice;
   const synth=await fetch('http://127.0.0.1:8778/synthesize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:question,voice_id:'am_michael'})});if(!synth.ok)throw Error('Input fixture generation failed');
   const decoded=decodeWav(Buffer.from(await synth.arrayBuffer()));let pcm=resample(decoded.audio,decoded.sampleRate,16000);
   if(resumption){const pieces=[];for(const part of ['What are the clinic','opening hours?']){const r=await fetch('http://127.0.0.1:8778/synthesize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:part,voice_id:'am_michael'})});const d=decodeWav(Buffer.from(await r.arrayBuffer()));const a=resample(d.audio,d.sampleRate,16000);let first=0,last=a.length;const rms=(at)=>{let sum=0;for(let i=at;i<at+640;i+=2)sum+=a.readInt16LE(i)**2;return Math.sqrt(sum/320);};while(first+640<last&&rms(first)<500)first+=640;while(last-640>first&&rms(last-640)<500)last-=640;pieces.push(a.subarray(first,last));}pcm=Buffer.concat([pieces[0],Buffer.alloc(9600),pieces[1]]);}
   const file=path.join(folder,'microphone.wav');fs.writeFileSync(file,makeWav(Buffer.concat([pcm,Buffer.alloc(32000)])));
   if(!publicTunnel&&session&&sessionStore.get(session)?.config.voice!==voice){await call('stop',{});session='';}
   if(!session)session=(await(await call('start',{agentId:'local',config:config()})).json()).id;
   const priorUsers=publicTunnel?0:sessionStore.get(session).messages.filter(m=>m.role==='user').length;
   const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+file,'--autoplay-policy=no-user-gesture-required']});
   try{const page=await browser.newPage({permissions:['microphone']});page.on('pageerror',e=>console.log('BROWSER ERROR '+e.message));await page.goto(base);await page.click('#start');try{await page.waitForFunction(()=>window.failure||(window.result&&window.completed),{},{timeout:30000});}catch(e){console.log('BROWSER DIAGNOSTIC '+JSON.stringify(await page.evaluate(()=>({debug:window.debug,failure:window.failure,result:window.result,heard:window.heard}))));throw e;}const value=await page.evaluate(()=>({result:window.result,failure:window.failure,reply:window.reply,heard:window.heard}));if(value.failure)throw Error(value.failure);const row={voice,question,repeat:repeat+1,...value.result,reply:value.reply,heard:value.heard};if(overlap&&!publicTunnel){for(let attempt=0;attempt<20&&sessionStore.get(session)?.messages.filter(m=>m.role==='user').length!==priorUsers+1;attempt++)await new Promise(r=>setTimeout(r,10));const users=sessionStore.get(session).messages.filter(m=>m.role==='user');if(users.length!==priorUsers+1||users.at(-1).content!==row.heard)throw Error('Draft history isolation failed');if(row.speechEndToPlaybackMs<500)throw Error('Endpoint guard bypassed');if(resumption&&row.cancelled<1)throw Error('Resumption did not invalidate draft');row.historyIsolationPassed=true;row.committedUserTurns=users.length;if(continuous&&question==='What day and time did I request?'&&!/Thursday/i.test(row.reply))throw Error('Follow-up memory failed');if(continuous&&question==='Summarize my request.'&&(!/Friday/i.test(row.reply)||/Thursday/i.test(row.reply)))throw Error('Correction memory failed');}results.push(row);console.log('RESULT '+JSON.stringify(row));fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({method:publicTunnel?'Warm Chrome synthetic microphone through authenticated public Cloudflare PC tunnel, original 500ms endpoint, real STT/LLM/TTS, AudioWorklet playback. Vercel application hop excluded.':'Warm local Chrome synthetic microphone, original 500ms endpoint, real STT/LLM/TTS, actual AudioWorklet playback. No Cloudflare round-trip.',overlap,resumption,continuous,publicTunnel,results},null,2));}
   finally{await browser.close();for(const tx of drafts.values()){tx.abort.abort();await call('stop',{},'application/json',true,undefined,tx.id);}drafts.clear();if(!continuous){await call('stop',{});session='';}}
   if(continuous)await new Promise(r=>setTimeout(r,Math.max(0,24000-(Date.now()-roundStarted))));
  }
  const passed=results.every(r=>r.speechEndToPlaybackMs<=1000);console.log(JSON.stringify({oneSecondTargetPassed:passed,maxMs:Math.max(...results.map(r=>r.speechEndToPlaybackMs)),trials:results.length}));
 }finally{if(session)await call('stop',{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
