'use strict';
// Metadata-only client; no retries, no playback, never saves response audio/text.
const http=require('node:http'),{createHash}=require('node:crypto');
const diagnostics=require('node:diagnostics_channel');
async function probe(url,{client='fetch',body,timeoutMs=60000,abortAfterMs,id='diagnostic'}={}){
  const target=new URL(url);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password)throw Error('Loopback only');
  const start=performance.now();const row={id,client,requestUnixMs:Date.now(),requestBytes:body?.length||0,receivedBytes:0,headersMs:null,declaredBytes:null,abortObserved:false};
  let prefix=Buffer.alloc(0),socketClosed,socketRef;
  const closePromise=new Promise(resolve=>{socketClosed=resolve;});const subscriptions=[];
  function subscribe(name,fn){diagnostics.subscribe(name,fn);subscriptions.push([name,fn]);}
  if(client==='fetch')subscribe('undici:client:connected',({socket})=>{
    if(socket.remotePort!==Number(target.port||80))return;
    socketRef=socket;
    row.socketTimeoutMs=socket.timeout??null;
    socket.once('close',hadError=>{row.socketCloseObserved=true;row.socketClosedMs=performance.now()-start;row.socketHadError=hadError;row.socketBytesRead=socket.bytesRead;row.socketBytesWritten=socket.bytesWritten;socketClosed();});
    socket.once('error',error=>{row.socketErrorCode=error.code||null;});
  });
  if(client==='fetch')subscribe('undici:request:error',({request,error})=>{if(request.path===target.pathname){row.undiciErrorCode=error.code||null;}});
  const hash=createHash('sha256');const controller=new AbortController();const timer=setTimeout(()=>{row.abortObserved=true;if(socketRef)row.socketAtDeadline={paused:socketRef.isPaused(),readableLength:socketRef.readableLength,bytesRead:socketRef.bytesRead,destroyed:socketRef.destroyed};controller.abort();},timeoutMs);
  const cancelTimer=abortAfterMs===undefined?null:setTimeout(()=>{row.abortObserved=true;row.intentionalCancel=true;controller.abort();},abortAfterMs);
  const headers={'X-Shahvex-Diagnostic-Id':id,...(body?{'Content-Type':'application/json','Content-Length':String(body.length)}:{})};
  function recordHeaders(status,get,metadata={}){Object.assign(row,metadata);row.status=status;row.headersMs=performance.now()-start;row.declaredBytes=get('content-length')===null?null:Number(get('content-length'));row.connection=get('connection');row.transferEncoding=get('transfer-encoding');row.contentEncoding=get('content-encoding');row.server=get('server');row.responseHeaders={};for(const key of ['content-length','content-type','connection','cache-control','date','server','transfer-encoding','content-encoding','x-shahvex-request-id','x-shahvex-tts-revision']){const value=get(key);if(value!==null)row.responseHeaders[key]=value;}}
  function chunk(c){row.receivedBytes+=c.length;hash.update(c);if(prefix.length<44)prefix=Buffer.concat([prefix,Buffer.from(c).subarray(0,44-prefix.length)]);if(row.receivedBytes>4000000){row.abortObserved=true;controller.abort();throw Error('Diagnostic body limit exceeded');}}
  try{
    if(client.startsWith('fetch')){
      const response=await fetch(target,{method:body?'POST':'GET',headers,body,redirect:'error',signal:controller.signal});
      recordHeaders(response.status,k=>response.headers.get(k));
      if(client==='fetch-buffer')chunk(new Uint8Array(await response.arrayBuffer()));
      else if(client==='fetch-candidate')await require('./experimental/wav-body-reader.cjs').readWavBody(response,4000000,chunk);
      else if(client==='fetch-gateway'){row.partialProgressUnavailable=true;chunk(await require('./services.cjs').limited(response));}
      else if(client==='fetch-reader'){const reader=response.body.getReader();try{while(true){const result=await reader.read();if(result.done)break;chunk(result.value);}}finally{reader.releaseLock();}}
      else for await(const c of response.body)chunk(c);
    }else if(client==='http-candidate'||client==='http-window'){
      await require('./experimental/http-wav-candidate.cjs').readNativeWav(target,{body,headers,signal:controller.signal,onHeaders:recordHeaders,onChunk:chunk,...(client==='http-window'?{receiveHighWaterMark:4000000}:{})});row.responseComplete=true;
    }else{
      await new Promise((resolve,reject)=>{
        const request=http.request(target,{method:body?'POST':'GET',headers,agent:false,signal:controller.signal},response=>{
          recordHeaders(response.statusCode,k=>response.headers[k]??null);row.httpVersion=response.httpVersion;
          response.on('data',c=>{try{chunk(c);}catch(e){request.destroy(e);}});
          response.on('aborted',()=>{row.responseAborted=true;});response.on('error',reject);
          response.on('end',()=>{row.responseComplete=response.complete;resolve();});
        });request.on('error',reject);request.end(body);
      });
    }
    row.bodyEnded=true;row.integrity=row.declaredBytes===null||row.receivedBytes===row.declaredBytes;
  }catch(error){row.integrity=false;row.errorType=error.name;row.errorCode=error.cause?.code||error.code||null;if(client==='fetch-gateway')row.receivedBytes=null;}
  finally{
    clearTimeout(timer);if(cancelTimer!==null)clearTimeout(cancelTimer);row.totalMs=performance.now()-start;row.bodyTransferMs=row.headersMs===null?null:row.totalMs-row.headersMs;row.bodySHA256=hash.digest('hex');row.missingBytes=row.declaredBytes===null||row.receivedBytes===null?null:row.declaredBytes-row.receivedBytes;
    if(prefix.length>=12&&prefix.toString('ascii',0,4)==='RIFF'&&prefix.toString('ascii',8,12)==='WAVE')row.wavRiffDeclaredBytes=prefix.readUInt32LE(4)+8;
    if(row.wavRiffDeclaredBytes!==undefined)row.wavLengthIntegrity=row.wavRiffDeclaredBytes===row.receivedBytes;
    if(client==='fetch')await Promise.race([closePromise,new Promise(resolve=>setTimeout(resolve,100))]);
    for(const [name,fn]of subscriptions)diagnostics.unsubscribe(name,fn);
  }
  return row;
}
if(require.main===module)probe(process.argv[2]||'http://127.0.0.1:8765/health',{client:process.argv[3]||'fetch'}).then(r=>console.log(JSON.stringify(r)));
module.exports={probe};
