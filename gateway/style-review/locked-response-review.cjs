'use strict';
// Offline review proof only. Not imported by production; caller must supply trusted policy/state.
const {createHash}=require('node:crypto');
const hash=text=>createHash('sha256').update(text).digest('hex');
function prepareLockedChoice({enabled=false,localAuthorized=false,agentId,campaignId,script,policy,state}={}){
  if(enabled!==true||localAuthorized!==true)return null;
  if(typeof script!=='string'||!policy||policy.approved!==true||policy.agentId!==agentId||policy.campaignId!==campaignId||policy.scriptSha256!==hash(script))return null;
  if(!Array.isArray(policy.regions)||policy.regions.length>128||!Array.isArray(policy.responses)||policy.responses.length>32)throw Error('Bounded reviewed policy required');
  const regions=new Map();let position=0;
  for(const r of policy.regions){
    if(!r.id||regions.has(r.id)||r.start!==position||!Number.isInteger(r.end)||r.end<=r.start||r.end>script.length)throw Error('Regions must partition the exact script');
    if(!['verbatim','fact','instruction','conditional','optional'].includes(r.kind))return null; // unclassified means disabled
    if(r.kind==='optional'&&(!Array.isArray(r.choices)||!r.choices.length||r.choices.length>8||r.choices.some(x=>typeof x!=='string'||x.length>1000)))throw Error('Explicit optional alternatives required');
    regions.set(r.id,{...structuredClone(r),text:script.slice(r.start,r.end)});position=r.end;
  }
  if(position!==script.length)return null;
  const responses=new Map();
  for(const r of policy.responses){
    if(typeof r.id!=='string'||!/^[a-z0-9_-]{1,48}$/.test(r.id)||responses.has(r.id)||!Array.isArray(r.states)||!r.states.includes(state))continue;
    if(!Array.isArray(r.parts)||!r.parts.length||r.parts.length>128||!Array.isArray(r.requiredInOrder))throw Error('Reviewed response plan required');
    const used=[],pieces=[];
    for(const part of r.parts){
      const region=regions.get(part.region);if(!region)throw Error('Unknown response region');
      if(['instruction','conditional'].includes(region.kind))throw Error('Do not speak script control instructions');
      if(region.kind==='optional'){
        if(!Number.isInteger(part.choice)||typeof region.choices[part.choice]!=='string')throw Error('Unapproved optional choice');
        pieces.push(region.choices[part.choice]);
      }else{if(part.choice!==undefined)throw Error('Locked text cannot be varied');pieces.push(region.text);}
      used.push(region.id);
    }
    let previous=-1;
    for(const required of r.requiredInOrder){const region=regions.get(required);if(!region||!['verbatim','fact'].includes(region.kind))throw Error('Invalid required region');const at=used.indexOf(required,previous+1);if(at<0)throw Error('Missing/reordered required region');previous=at;}
    const text=pieces.join('');if(!text.trim()||text.length>16000)throw Error('Invalid approved response');responses.set(r.id,text);
  }
  if(!responses.size)return null;
  // Snapshot closes mutation-after-approval holes. No generated words reach the renderer.
  return Object.freeze({ids:Object.freeze([...responses.keys()]),render(decision){
    if(typeof decision!=='string'||decision.length>256)throw Error('Bounded response decision required');
    let parsed;try{parsed=JSON.parse(decision);}catch{throw Error('Invalid response decision');}
    if(!parsed||Object.keys(parsed).length!==1||typeof parsed.responseId!=='string'||!responses.has(parsed.responseId))throw Error('Unapproved response decision');
    return responses.get(parsed.responseId);
  }});
}
module.exports={prepareLockedChoice,hash};
