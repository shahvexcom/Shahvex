'use strict';
// REVIEW CANDIDATE ONLY: not imported by production Gateway services.
async function readWavBody(response,max=4000000,onChunk=()=>{}){
  if(!response.ok){await response.body?.cancel();const error=Error(`Engine HTTP ${response.status}`);error.httpStatus=response.status;throw error;}
  const raw=response.headers.get('content-length');
  const expected=raw===null?null:Number(raw);
  if(expected!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(expected)||expected>max)){
    await response.body?.cancel();throw Error('Invalid or oversized WAV Content-Length');
  }
  if(!response.body?.getReader)throw Error('Expected fetch ReadableStream body');
  const reader=response.body.getReader();const parts=[];let received=0,finished=false;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      received+=value.byteLength;if(received>max)throw Error('Engine response exceeds limit');
      parts.push(Buffer.from(value));onChunk(value);
    }
    if(expected!==null&&expected!==received)throw Error('WAV Content-Length mismatch');
    finished=true;return Buffer.concat(parts);
  }finally{
    if(!finished){try{await reader.cancel();}catch{}}
    reader.releaseLock();
  }
}
module.exports={readWavBody};
