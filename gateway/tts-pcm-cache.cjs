'use strict';
const crypto=require('node:crypto');
function createPcmCache({maxBytes=32*1024*1024,maxEntryBytes=2*1024*1024,ttlMs=600000,now=Date.now}={}){
 const entries=new Map();let bytes=0;
 const remove=key=>{const e=entries.get(key);if(e){bytes-=e.pcm.length;entries.delete(key);}};
 return {
  maxEntryBytes,
  key:({text,voice,emotion})=>crypto.createHash('sha256').update(JSON.stringify([voice,emotion,text])).digest('hex'),
  get(key){const e=entries.get(key);if(!e)return;if(e.until<=now()){remove(key);return;}entries.delete(key);entries.set(key,e);return e.pcm;},
  put(key,pcm){if(!pcm.length||pcm.length>maxEntryBytes||pcm.length>maxBytes)return;remove(key);while(bytes+pcm.length>maxBytes&&entries.size)remove(entries.keys().next().value);entries.set(key,{pcm:Buffer.from(pcm),until:now()+ttlMs});bytes+=pcm.length;},
  clear(){entries.clear();bytes=0;},
 };
}
const shared=createPcmCache();module.exports={createPcmCache,shared};
