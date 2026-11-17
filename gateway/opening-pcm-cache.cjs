'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createPcmCache}=require('./tts-pcm-cache.cjs');
// Only deterministic introductions use this persistent cache. No customer audio.
const memory=createPcmCache({ttlMs:24*60*60*1000});
const revision=String(process.env.SHAHVEX_OPENING_CACHE_REVISION||'v1').replace(/[^a-zA-Z0-9_-]/g,'');
const directory=path.resolve(process.cwd(),'.data/opening-pcm-'+revision);
const valid=key=>/^[a-f0-9]{64}$/.test(key);
module.exports={
 maxEntryBytes:memory.maxEntryBytes,key:memory.key,
 get(key){
  const cached=memory.get(key);if(cached)return cached;
  if(!valid(key))return;
  try{const file=path.join(directory,key+'.pcm'),stat=fs.statSync(file);if(stat.size>memory.maxEntryBytes)return;const pcm=fs.readFileSync(file);memory.put(key,pcm);return pcm;}catch{return;}
 },
 put(key,pcm){
  memory.put(key,pcm);if(!valid(key)||!pcm.length||pcm.length>memory.maxEntryBytes)return;
  try{fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,key+'.pcm'),tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,pcm,{mode:0o600});fs.renameSync(tmp,file);}catch{/* Audio still streams if disk caching is unavailable. */}
 }
};
