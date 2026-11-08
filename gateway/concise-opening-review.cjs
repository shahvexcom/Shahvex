'use strict';
// Opt-in review wrapper only; production services/server import nothing here.
const {createHash}=require('node:crypto');
const MARKER='\nASSIGNED SCRIPT:\n';
const hash=text=>createHash('sha256').update(text).digest('hex');
const hint='\nOPTIONAL OPENING REVIEW: The assigned script below remains authoritative. Preserve every mandatory word, disclosure, business fact, condition and task instruction. Unclassified wording is locked. Only where the approved script explicitly permits optional wording, begin with a short, complete, substantive answer; usually aim for a natural first sentence of about 40 to 80 characters where that is sufficient. Avoid optional lead-ins such as repeating the introduction, praising the question or announcing that you can answer. Do not emit filler just to start audio. Do not add laughter, sound-effect tags or stage directions. Keep any required opening first even if long; never shorten mandatory text or omit necessary explanation. Prefer one or two conversational sentences only when the required response permits. Do not change facts, invent missing information or claim to be human.\n';
function wrapConciseOpening(llm,{enabled=false,approvedScripts=[]}={}){
  if(typeof llm!=='function')throw Error('Existing LLM function required');
  if(!enabled)return llm;
  if(!Array.isArray(approvedScripts)||approvedScripts.length>64)throw Error('Bounded approved-script list required');
  const approved=new Set();
  for(const policy of approvedScripts){
    if(!policy||Object.keys(policy).some(k=>!['scriptSha256','allowOptionalPhrasing','approvalReference'].includes(k))||!/^[a-f0-9]{64}$/.test(policy.scriptSha256)||policy.allowOptionalPhrasing!==true||typeof policy.approvalReference!=='string'||!policy.approvalReference.trim()||policy.approvalReference.length>160)throw Error('Explicit optional-language approval required');
    if(approved.has(policy.scriptSha256))throw Error('Duplicate script approval');approved.add(policy.scriptSha256);
  }
  return async(messages,signal,timing,onDelta)=>{
    signal.throwIfAborted();
    const system=messages?.[0];
    if(system?.role!=='system'||typeof system.content!=='string')return llm(messages,signal,timing,onDelta);
    const marker=system.content.indexOf(MARKER);
    if(marker<0||!approved.has(hash(system.content.slice(marker+MARKER.length))))return llm(messages,signal,timing,onDelta);
    // Insert before the existing marker so the entire authoritative script remains
    // an exact suffix. No output rewrite, truncation, second call or audio filtering.
    const request=[{...system,content:system.content.slice(0,marker)+hint+system.content.slice(marker)},...messages.slice(1)];
    timing?.('concise-opening-review');
    return llm(request,signal,timing,onDelta);
  };
}
function reviewServices(services,env=process.env){
  if(env.SHAHVEX_CONCISE_OPENING_REVIEW!=='1')return services;
  if(env.NODE_ENV==='production'||env.VERCEL||env.RAILWAY_PROJECT_ID||env.RAILWAY_ENVIRONMENT||env.RAILWAY_ENVIRONMENT_ID)throw Error('Local isolated review only');
  if(env.SHAHVEX_AGENT_INTELLIGENCE==='1')throw Error('Agent Intelligence must stay OFF');
  const file=env.SHAHVEX_CONCISE_OPENING_APPROVALS;
  if(typeof file!=='string'||!file||/^[a-z]+:\/\/|^\\\\/i.test(file))throw Error('Private local approval file required');
  const fs=require('node:fs');if(fs.statSync(file).size>32768)throw Error('Approval file exceeds bound');
  let policies;try{policies=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{throw Error('Invalid local approval registry');}
  return {...services,llm:wrapConciseOpening(services.llm,{enabled:true,approvedScripts:policies})};
}
module.exports={wrapConciseOpening,reviewServices,hash};
