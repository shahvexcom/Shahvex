'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function createCapacityControl({root,fetchImpl=fetch}){
 const directory=path.resolve(root,'../../private-native'),envFile=path.join(root,'.data/pc-ai/.env.pc-ai');
 const files=['vicidial-campaign.json','vicidial-manual.json'].map(n=>path.join(directory,n));
 const readConfigs=()=>files.map(file=>({file,raw:fs.readFileSync(file,'utf8'),config:JSON.parse(fs.readFileSync(file,'utf8'))}));
 const atomic=(file,text)=>{const tmp=file+'.capacity-'+crypto.randomUUID();try{fs.writeFileSync(tmp,text,{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}};
 async function bridge(config,limit){
  if(!Number.isInteger(config.controlPort)||config.controlPort<1||config.controlPort>65535||typeof config.secret!=='string'||config.secret.length<32)throw Error('Invalid protected bridge configuration');
  const route=limit===undefined?'/health':'/capacity',method=limit===undefined?'GET':'POST',body=limit===undefined?'':JSON.stringify({limit}),stamp=String(Date.now());
  const signature=crypto.createHmac('sha256',config.secret).update(stamp+'\n'+method+'\n'+route+'\n').update(body).digest('hex');
  const r=await fetchImpl('http://127.0.0.1:'+config.controlPort+route,{method,headers:{'content-type':'application/json','x-shahvex-timestamp':stamp,'x-shahvex-signature':signature},...(body?{body}:{}),signal:AbortSignal.timeout(5000)});
  if(!r.ok){const error=Error('Bridge rejected capacity management');error.status=r.status===409?409:503;throw error;}return r.json();
 }
 const summarize=(limit,states)=>({limit,min:1,max:300,consistent:states.every(s=>s.maxCalls===limit),bridges:states.map((s,i)=>({name:i===0?'Campaign calls':'Test calls',limit:s.maxCalls,activeCalls:s.activeCalls,startingCalls:s.startingCalls}))});
 return {async read(limit){return summarize(limit,await Promise.all(readConfigs().map(c=>bridge(c.config))));},async set(limit,previous){
  if(!Number.isInteger(limit)||limit<1||limit>300)throw Error('Invalid capacity');
  const entries=readConfigs(),oldEnv=fs.readFileSync(envFile,'utf8'),states=await Promise.all(entries.map(c=>bridge(c.config)));
  if(states.some(s=>Math.max(s.audioConnections||0,(s.activeCalls||0)+(s.startingCalls||0))>limit)){const error=Error('Active calls exceed requested capacity');error.status=409;error.publicMessage='Finish active calls before lowering the limit below current usage';throw error;}
  const applied=[];
  try{
   for(let i=0;i<entries.length;i++){await bridge(entries[i].config,limit);applied.push(i);}
   for(const {file,config}of entries)atomic(file,JSON.stringify({...config,maxCalls:limit},null,2)+'\n');
   const nextEnv=/^SHAHVEX_PC_AI_MAX_SESSIONS=.*$/m.test(oldEnv)?oldEnv.replace(/^SHAHVEX_PC_AI_MAX_SESSIONS=.*$/m,'SHAHVEX_PC_AI_MAX_SESSIONS='+limit):oldEnv+'\nSHAHVEX_PC_AI_MAX_SESSIONS='+limit+'\n';atomic(envFile,nextEnv);
   const after=await Promise.all(entries.map(c=>bridge(c.config)));if(after.some(s=>s.maxCalls!==limit))throw Error('Capacity readback mismatch');return summarize(limit,after);
  }catch(error){let restored=true;for(const i of applied.reverse())try{await bridge(entries[i].config,states[i].maxCalls);}catch{restored=false;}try{for(const c of entries)atomic(c.file,c.raw);atomic(envFile,oldEnv);}catch{restored=false;}error.publicMessage=restored?'Capacity update failed; the previous limit was restored':'Capacity update was only partly restored; refresh status before trying again';throw error;}
 }};
}
module.exports={createCapacityControl};
