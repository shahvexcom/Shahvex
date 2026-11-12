'use strict';
// Isolated, opt-in AudioSocket diagnostics. No website DB or Native dialer API.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createBridge,signature}=require('./server.cjs');
const json=(value,status=200)=>Response.json(value,{status});

function testerTransport(config,fetchImpl=fetch){
  const base=new URL(config.url);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if((base.protocol!=='https:'&&!(base.protocol==='http:'&&loopback))||base.username||base.password||base.pathname!=='/'||base.search||base.hash||typeof config.secret!=='string'||config.secret.length<32||Boolean(config.cfClientId)!==Boolean(config.cfClientSecret))throw Error('Configure a secure tester origin and its server credentials');
  return async(action,init,owner)=>{
    if(!['start','turn','interrupt','stop'].includes(action))throw Error('Unsupported manual tester operation');
    const incoming=new Headers(init.headers),headers=new Headers({'x-shahvex-ai-key':config.secret,'x-shahvex-owner':owner});
    for(const name of ['content-type','x-shahvex-session','x-shahvex-turn'])if(incoming.has(name))headers.set(name,incoming.get(name));
    if(config.cfClientId){headers.set('CF-Access-Client-Id',config.cfClientId);headers.set('CF-Access-Client-Secret',config.cfClientSecret);}
    return fetchImpl(new URL(`/tester/${action}`,base),{...init,headers,redirect:'error',signal:AbortSignal.any([init.signal||new AbortController().signal,AbortSignal.timeout(120000)])});
  };
}

function manualCallbacks({agent,request,callLimitSeconds=120}){
  if(!agent||typeof agent.name!=='string'||!agent.name.trim()||typeof agent.voice!=='string'||!agent.voice||typeof agent.script!=='string'||!agent.script.trim()||agent.script.length>16000||!['ai','customer'].includes(agent.first))throw Error('Configure the manual test name, approved voice, script and first speaker');
  if(!Number.isInteger(callLimitSeconds)||callLimitSeconds<10||callLimitSeconds>300)throw Error('Manual call duration must be 10-300 seconds');
  const calls=new Map();let starting=false;
  const stop=async c=>{if(!c?.sessionId)return;try{const r=await request('stop',{method:'POST',headers:{'content-type':'application/json','x-shahvex-session':c.sessionId},body:'{}'},c.owner);await r.body?.cancel();}catch{/* Shared tester leases also expire abandoned diagnostic sessions. */}};
  async function dispatch(_url,init){
    const v=JSON.parse(Buffer.from(init.body).toString());
    if(v.action==='maintenance'||v.action==='recording'||v.action==='retry-sync'||v.action==='recover')return json({saved:true,testOnly:true});
    if(v.action==='connected'){
      if(v.agentUser!=='manual-test'||!/^manual-[a-f0-9]{32}$/.test(v.externalCallId))return json({error:'Manual namespace required'},409);
      const prior=[...calls.values()].find(c=>c.externalCallId===v.externalCallId);if(prior)return json({callId:prior.id,first:agent.first,maxCallDurationSeconds:callLimitSeconds,testOnly:true});
      if(starting||calls.size)return json({error:'Only one manual test call is allowed'},429);
      starting=true;const id=crypto.randomUUID(),owner=`manual-audio-${id}`;
      try{
        const config={name:agent.name,voice:agent.voice,first:agent.first,style:agent.style||'Professional',script:agent.script,goal:'',task:'',instructions:'',knowledge:''};
        const response=await request('start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentId:'manual-audio-test',config,deriveFromScript:true})},owner);
        if(!response.ok){await response.body?.cancel();return json({error:'Shared tester could not start; verify voice, script, access credentials and capacity'},503);}
        const body=await response.json();if(typeof body.id!=='string'||!/^[\w-]{1,80}$/.test(body.id))return json({error:'Invalid tester session response'},503);
        if(body.derivedFromScript!==true){await stop({sessionId:body.id,owner});return json({error:'Update/restart the shared tester service to support manual script setup'},503);}
        const c={id,owner,sessionId:body.id,externalCallId:v.externalCallId,expires:Date.now()+callLimitSeconds*1000};calls.set(id,c);
        if(init.signal?.aborted){calls.delete(id);await stop(c);return json({error:'Manual call disconnected during startup'},409);}
        return json({callId:id,first:agent.first,maxCallDurationSeconds:callLimitSeconds,testOnly:true});
      }finally{starting=false;}
    }
    const c=calls.get(v.callId);
    if(!c)return v.action==='ended'?json({saved:true,testOnly:true}):json({error:'Manual session not found'},404);
    if(c.externalCallId!==v.externalCallId)return json({error:'Manual session mismatch'},409);
    if(v.action==='media-ready')return json({saved:true,testOnly:true});
    if(v.action==='ended'||v.action==='hangup'){calls.delete(c.id);await stop(c);return json({ended:true,testOnly:true});}
    if(v.action==='interrupt')return request('interrupt',{method:'POST',headers:{'content-type':'application/json','x-shahvex-session':c.sessionId},body:'{}',signal:init.signal},c.owner);
    if(v.action==='turn'){
      if(Date.now()>c.expires)return new Response('{"type":"end_call"}\n',{headers:{'content-type':'application/x-ndjson'}});
      const body=v.audio?Buffer.from(v.audio,'base64'):JSON.stringify({text:v.text||'',opening:v.opening===true,...(v.silenceStep?{silenceStep:v.silenceStep}:{})});
      return request('turn',{method:'POST',headers:{'content-type':v.audio?'audio/wav':'application/json','x-shahvex-session':c.sessionId,'x-shahvex-turn':v.eventId},body,signal:init.signal},c.owner);
    }
    return json({error:'Lead updates and transfers are disabled in manual tests'},409);
  }
  return {dispatch,async close(){const active=[...calls.values()];calls.clear();await Promise.allSettled(active.map(stop));}};
}

function createManualBridge(config,{request,fetchImpl=fetch,logger=console.error}={}){
  if(config.enabled!==true||typeof config.secret!=='string'||config.secret.length<32)throw Error('Enable the isolated manual configuration and set its separate shared secret');
  const connectionId=crypto.randomUUID(),callbacks=manualCallbacks({agent:config.agent,request:request||testerTransport(config.tester,fetchImpl),callLimitSeconds:config.callLimitSeconds||120});
  const spoolDir=path.join(config.stateDirectory||'/var/lib/shahvex-vicidial','manual-test');
  const bridge=createBridge({siteUrl:'https://manual-test.invalid/',connectionId,secret:config.secret,spoolDir,fetchImpl:callbacks.dispatch,logger,maxCalls:1,testOnly:true,allowUnregisteredManualAudio:config.allowUnregisteredAudio===true});
  let windowTimer;
  return {bridge,async listen(){
    const controlPort=config.controlPort??8792,audioPort=config.audioPort??9020;
    if(!Number.isInteger(controlPort)||controlPort<0||controlPort>65535||!Number.isInteger(audioPort)||audioPort<0||audioPort>65535||controlPort===8790||audioPort===9019)throw Error('Use separate manual test ports, not production 8790/9019');
    const bind=(server,port,host)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
    try{
      await bind(bridge.control,controlPort,'127.0.0.1');await bind(bridge.audio,audioPort,config.audioHost||'127.0.0.1');
      const body=Buffer.from(JSON.stringify({connectionId,remoteUser:'manual-test'})),stamp=String(Date.now());
      const response=await fetchImpl(`http://127.0.0.1:${bridge.control.address().port}/prepare`,{method:'POST',headers:{'x-shahvex-timestamp':stamp,'x-shahvex-signature':signature(config.secret,stamp,'POST','/prepare',body)},body});
      if(!response.ok)throw Error('Manual test preparation failed');await response.body?.cancel();
      const seconds=config.testWindowSeconds??600;if(!Number.isInteger(seconds)||seconds<30||seconds>900)throw Error('Manual test window must be 30-900 seconds');
      windowTimer=setTimeout(()=>{logger('Manual audio test window closed');void this.close();},seconds*1000);windowTimer.unref();
    }catch(error){await this.close();throw error;}
  },async close(){clearTimeout(windowTimer);bridge.close();await callbacks.close();}};
}

if(require.main===module){
  (async()=>{const config=JSON.parse(fs.readFileSync(process.argv[2]||'/etc/shahvex-vicidial-manual.json','utf8')),manual=createManualBridge(config);await manual.listen();console.log('Isolated manual AudioSocket test ready; no VICIdial campaign calls are enabled.');process.once('SIGTERM',()=>void manual.close());process.once('SIGINT',()=>void manual.close());})().catch(()=>{console.error('Manual test could not start. Verify protected config, tester access and available ports.');process.exitCode=1;});
}
module.exports={createManualBridge,manualCallbacks,testerTransport};
