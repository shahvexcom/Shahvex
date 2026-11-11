'use strict';
const fs=require('fs'),ts=require('typescript'),assert=require('assert/strict'),{chromium}=require('playwright');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
(async()=>{if(process.env.SHAHVEX_BROWSER_BARGE_TEST!=='1')throw Error('Explicit browser opt-in required');const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});try{const page=await browser.newPage();await page.goto(process.env.SHAHVEX_BARGE_SITE||'http://127.0.0.1:3000');const result=await page.evaluate(async({playerCode,captureCode,audioCode,worklet,publicWorklet})=>{
 const moduleUrl=code=>'data:text/javascript;base64,'+btoa(code);
 const {BrowserPCMPlayer}=await import(moduleUrl(playerCode)),{BrowserSpeechCapture}=await import(moduleUrl(captureCode.replace('./agent-test-audio',moduleUrl(audioCode))));
 const ctx=new AudioContext({sampleRate:16000});await ctx.resume();await ctx.audioWorklet.addModule(publicWorklet?'/shahvex-playback-worklet.js?v=2':moduleUrl(worklet));
 await ctx.audioWorklet.addModule(moduleUrl("class Monitor extends AudioWorkletProcessor{process(i,o){let p=0;for(const x of i[0]?.[0]||[])p+=x*x;this.port.postMessage({time:currentTime,power:p});return true;}}registerProcessor('barge-monitor',Monitor)"));
 const monitor=new AudioWorkletNode(ctx,'barge-monitor'),sink=ctx.createGain();sink.gain.value=0;monitor.connect(sink);sink.connect(ctx.destination);const levels=[];monitor.port.onmessage=({data})=>levels.push(data);
 const player=new BrowserPCMPlayer(ctx,()=>{});player.connectRecording(monitor);player.clear(0);
 const pcm=new Int16Array(960);for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.sin(i*2*Math.PI*440/24000)*12000);let binary='';for(const byte of new Uint8Array(pcm.buffer))binary+=String.fromCharCode(byte);const frame=btoa(binary),signal=new AbortController().signal;
 for(let i=0;i<20;i++)await player.push(frame,0,signal);
 await new Promise(r=>setTimeout(r,120));if(!levels.some(x=>x.power>.001))throw Error('No rendered starting audio');
 const capture=new BrowserSpeechCapture(),onset=ctx.currentTime;let detected=false,cancelPending=true,clearAt=0;
 for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,20));if(capture.feed(new Int16Array(320).fill(2000),true).started){detected=true;clearAt=ctx.currentTime;player.clear(1);setTimeout(()=>{cancelPending=false;},700);}}
 if(!detected)throw Error('Barge-in was not detected within ten frames');await new Promise(r=>setTimeout(r,110));
 const after=levels.filter(x=>x.time>clearAt+.025);if(!after.length||after.some(x=>x.power>.000001))throw Error('Audio continued after local interruption');if(!cancelPending)throw Error('Test did not isolate slow server cancellation');
 await player.push(frame,0,signal);await new Promise(r=>setTimeout(r,30));if(levels.filter(x=>x.time>clearAt+.025).some(x=>x.power>.000001))throw Error('Stale epoch resumed audio');
 const resumeAt=ctx.currentTime;for(let i=0;i<4;i++)await player.push(frame,1,signal);player.end(1);await new Promise(r=>setTimeout(r,120));if(!levels.some(x=>x.time>resumeAt&&x.power>.001))throw Error('Next epoch audio did not resume');
 const result={syntheticSpeechToClearMs:Math.round((clearAt-onset)*1000),silentWithinMs:25,serverCancellationStillPending:cancelPending,staleAudioRejected:true,nextAudioResumed:true};player.dispose();await ctx.close();return result;
 },{publicWorklet:Boolean(process.env.SHAHVEX_BARGE_SITE),playerCode:compile('lib/browser-pcm-player.ts'),captureCode:compile('lib/browser-speech-capture.ts'),audioCode:compile('lib/agent-test-audio.ts'),worklet:fs.readFileSync('public/shahvex-playback-worklet.js','utf8')});console.log(JSON.stringify(result));assert.ok(result.syntheticSpeechToClearMs<=300);}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
