'use strict';
// Synthetic ephemeral fixture only. Never points at an AI service.
const http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {decodeWav}=require('../gateway/wav.cjs');
const blocked=new Set([3000,8765,8787,8788,11434]);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function once(port,client,mode,size,id){
  if(!Number.isInteger(port)||port<1024||blocked.has(port))throw Error('Forbidden fixture port');
  const row={id,client,mode,size,receivedBytes:0,events:[],deadlineTriggered:false},chunks=[];
  const start=performance.now();let socket,response;
  const event=(kind)=>{row.events.push({kind,ms:performance.now()-start});if(row.events.length>12)row.events.splice(1,1);};
  const snapshot=()=>socket?{bytesRead:socket.bytesRead,bytesWritten:socket.bytesWritten,paused:socket.isPaused(),
    readableLength:socket.readableLength,destroyed:socket.destroyed,responseComplete:response?.complete??null,
    responseReadableLength:response?.readableLength??null}:null;
  function data(c){if(!row.receivedBytes)event('first-body');row.receivedBytes+=c.length;
    if(row.receivedBytes>2100000)throw Error('Body bound');chunks.push(Buffer.from(c));row.lastBodyMs=performance.now()-start;row.lastChunkBytes=c.length;}
  function headers(status,get){row.status=status;row.declaredBytes=Number(get('content-length'));row.headersMs=performance.now()-start;row.connection=get('connection');}
  const controller=new AbortController();
  const timer=setTimeout(()=>{row.deadlineTriggered=true;row.atDeadline=snapshot();controller.abort();},mode==='cancel'?30:2000);
  try{
    if(client==='fetch'){
      const r=await fetch(`http://127.0.0.1:${port}/${mode}/${size}`,{method:'POST',body:'{}',headers:{'Content-Type':'application/json','X-Diagnostic-Id':id},redirect:'error',signal:controller.signal});
      headers(r.status,k=>r.headers.get(k));for await(const c of r.body)data(c);
    }else if(client==='http')await new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:`/${mode}/${size}`,method:'POST',agent:false,signal:controller.signal,
        headers:{'Content-Type':'application/json','Content-Length':2,'X-Diagnostic-Id':id}},r=>{
        response=r;headers(r.statusCode,k=>r.headers[k]);r.on('data',c=>{try{data(c);}catch(e){req.destroy(e);}});
        r.on('aborted',()=>event('response-aborted'));r.on('error',reject);r.on('end',()=>{event('response-end');resolve();});
      });req.on('socket',s=>{socket=s;s.on('close',error=>{row.socketCloseHadError=error;event('socket-close');});});req.on('error',reject);req.end('{}');
    });
    else await new Promise((resolve,reject)=>{
      socket=net.connect({host:'127.0.0.1',port,signal:controller.signal});let prefix=Buffer.alloc(0),ready=false;
      socket.on('connect',()=>socket.write(`POST /${mode}/${size} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\nX-Diagnostic-Id: ${id}\r\n\r\n{}`));
      socket.on('data',c=>{try{
        if(ready){data(c);return;}prefix=Buffer.concat([prefix,c]);const at=prefix.indexOf('\r\n\r\n');
        if(at<0){if(prefix.length>8192)throw Error('Header bound');return;}
        const h=prefix.subarray(0,at).toString('ascii');row.headerBytes=at+4;
        headers(Number(h.split(' ')[1]),key=>new RegExp(`^${key}:\\s*(.+)$`,'mi').exec(h)?.[1]?.trim());
        ready=true;data(prefix.subarray(at+4));prefix=Buffer.alloc(0);
      }catch(e){socket.destroy(e);}});
      socket.on('end',()=>{event('socket-end');resolve();});socket.on('error',reject);
      socket.on('close',error=>{row.socketCloseHadError=error;event('socket-close');});
    });
    row.bodyEnded=true;
  }catch(e){row.errorType=e.name;row.errorCode=e.cause?.code??e.code??null;event('client-error');}
  finally{clearTimeout(timer);row.totalMs=performance.now()-start;row.socket=snapshot();}
  const body=Buffer.concat(chunks);row.bodySha256=sha(body);row.riffPrefix=body.subarray(0,4).toString('ascii');
  row.riffDeclaredBytes=body.length>=8?body.readUInt32LE(4)+8:null;row.missingBytes=row.declaredBytes-row.receivedBytes;
  try{decodeWav(body);row.wavValid=row.riffDeclaredBytes===body.length;}catch{row.wavValid=false;}
  row.complete=Boolean(row.bodyEnded&&row.status===200&&row.receivedBytes===row.declaredBytes&&row.wavValid);
  return row;
}
async function main(){
  const port=Number(process.argv[2]);
  for(let repeat=1;repeat<=5;repeat++)for(const size of [65324,2000044])for(const client of ['fetch','http','raw'])
    console.log(JSON.stringify(await once(port,client,'normal',size,`${client}-normal-${size}-${repeat}`)));
  for(const mode of ['drop44','overdeclare44','delayed','cancel'])for(const client of ['fetch','http','raw'])
    console.log(JSON.stringify(await once(port,client,mode,65324,`${client}-${mode}`)));
}
if(require.main===module)main().catch(e=>{console.error(e.name);process.exitCode=1;});
module.exports={once};
