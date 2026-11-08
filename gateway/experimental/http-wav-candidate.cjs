'use strict';
// UNWIRED REVIEW CANDIDATE. Flowing-mode HTTP for bounded full native WAVs only.
const http=require('node:http');
function readNativeWav(url,{body,headers={},signal,max=4000000,receiveHighWaterMark,onHeaders=()=>{},onChunk=()=>{}}={}){
  const target=new URL(url);
  if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password||target.hash)throw Error('Loopback engine URL required');
  if(!signal)throw Error('Existing bounded request signal required');
  if(receiveHighWaterMark!==undefined&&(!Number.isInteger(receiveHighWaterMark)||receiveHighWaterMark<1||receiveHighWaterMark>max))throw Error('Receive window must stay within body bound');
  const payload=body===undefined?undefined:Buffer.from(body);
  const requestHeaders={...headers};if(payload)requestHeaders['Content-Length']=String(payload.length);
  return new Promise((resolve,reject)=>{
    let settled=false,received=0,expected=null,response;const parts=[];
    const finish=(error)=>{
      if(settled)return;settled=true;
      if(error){request.destroy();reject(signal?.aborted?signal.reason:error);}
      else resolve({body:Buffer.concat(parts),headers:response.headers,httpVersion:response.httpVersion});
    };
    const request=http.request(target,{method:payload?'POST':'GET',headers:requestHeaders,agent:false,signal,highWaterMark:receiveHighWaterMark},incoming=>{
      response=incoming;try{onHeaders(incoming.statusCode,k=>incoming.headers[k]??null,{responseHighWaterMark:incoming.readableHighWaterMark,socketHighWaterMark:incoming.socket.readableHighWaterMark});}catch(error){finish(error);return;}
      if(incoming.statusCode<200||incoming.statusCode>=300){const error=Error('Native WAV HTTP error');error.httpStatus=incoming.statusCode;finish(error);return;}
      const raw=incoming.headers['content-length'];
      if(raw!==undefined){expected=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(expected)||expected>max){finish(Error('Invalid or oversized Content-Length'));return;}}
      incoming.on('data',chunk=>{
        received+=chunk.length;
        if(received>max||(expected!==null&&received>expected)){finish(Error('Native WAV exceeds declared or bounded size'));return;}
        parts.push(Buffer.from(chunk));try{onChunk(chunk);}catch(error){finish(error);}
      });
      incoming.on('aborted',()=>finish(Error('Native WAV response aborted')));
      incoming.on('error',finish);
      incoming.on('end',()=>{if(!incoming.complete||(expected!==null&&expected!==received))finish(Error('Native WAV incomplete'));else finish();});
      incoming.on('close',()=>{if(!settled)finish(Error('Native WAV closed before completion'));});
    });
    request.on('error',finish);request.end(payload);
  });
}
module.exports={readNativeWav};
