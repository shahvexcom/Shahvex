'use strict';
const {spawn}=require('node:child_process');const {Readable}=require('node:stream');const {pipeline}=require('node:stream/promises');
/** Small pitch-preserving tempo adjustment; no model, speaker or sample-rate change. */
function speechTempo(response,tempo=1.1,signal){
 if(tempo===1||!response.ok||!response.body)return response;
 if(!Number.isFinite(tempo)||tempo<1||tempo>1.2)throw Error('Unsupported speech tempo');
 if(response.headers.get('x-audio-format')!=='pcm_s16le'||response.headers.get('x-sample-rate')!=='24000'||response.headers.get('x-channels')!=='1')return response;
 const child=spawn('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-probesize','32','-analyzeduration','0','-f','s16le','-ar','24000','-ac','1','-blocksize','1920','-i','pipe:0','-af',`atempo=${tempo}`,'-f','s16le','-ar','24000','-ac','1','-flush_packets','1','pipe:1'],{stdio:['pipe','pipe','ignore']});
 const input=Readable.fromWeb(response.body);let closed=false,controller;
 const cleanup=()=>signal?.removeEventListener('abort',abort);
 const fail=error=>{if(closed)return;closed=true;cleanup();input.destroy();child.kill();try{controller?.error(error);}catch{}};
 const abort=()=>fail(signal.reason||Error('Speech cancelled'));
 const body=new ReadableStream({start(c){controller=c;child.stdout.on('data',data=>{if(!closed)c.enqueue(new Uint8Array(data));});child.once('error',()=>fail(Error('Speech tempo processor unavailable')));child.once('close',code=>{if(closed)return;if(code!==0){fail(Error('Speech tempo processing failed'));return;}closed=true;cleanup();c.close();});void pipeline(input,child.stdin).catch(error=>{if(!closed)fail(error);});if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});},cancel(){if(closed)return;closed=true;cleanup();input.destroy();child.kill();}});
 const headers=new Headers(response.headers);headers.delete('content-length');headers.set('x-speech-tempo',String(tempo));return new Response(body,{status:response.status,headers});
}
module.exports={speechTempo};
