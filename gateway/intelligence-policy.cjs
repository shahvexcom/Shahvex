'use strict';
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const hash=text=>createHash('sha256').update(text).digest('hex');
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const text=(x,max=1000)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
function assertTruthfulLiteral(value){
  const normalized=value.normalize('NFKC').replace(/\u2019/g,"'");
  if(/\bI(?:'m| am) (?:a )?(?:human|real person|human employee)\b|\bI(?:'m| am) not (?:an? )?(?:ai|bot|robot|automated)\b/i.test(normalized))throw Error('False identity literal is forbidden');
  if(/\b(?:your|the) (?:appointment|booking|payment) (?:is|has been) (?:confirmed|booked|scheduled|processed)|\b(?:I|we) (?:have |successfully )?(?:booked|charged|scheduled|processed your payment)\b/i.test(normalized))throw Error('Action confirmation requires an integration receipt');
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function compilePolicy(input){
  if(!input||input.version!==1||input.approved!==true||!text(input.owner,200)||!text(input.campaignId,200)||!text(input.voiceId,200)||!id(input.approvalId)||!/^([a-f0-9]{64})$/.test(input.scriptSha256||''))throw Error('Invalid intelligence policy binding');
  const allowed=new Set(['version','approved','owner','campaignId','voiceId','approvalId','scriptSha256','allowOptionalSpeech','allowGeneralKnowledge','defaultStyle','objective','personality','facts','questions','required','stopResponse']);
  if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('Unsupported intelligence policy field');
  if(!['neutral','warm','reassuring','professional','serious'].includes(input.defaultStyle||'neutral'))throw Error('Invalid intelligence style');
  const p={version:1,approved:true,owner:input.owner,campaignId:input.campaignId,voiceId:input.voiceId,approvalId:input.approvalId,scriptSha256:input.scriptSha256,
    allowOptionalSpeech:input.allowOptionalSpeech===true,allowGeneralKnowledge:input.allowGeneralKnowledge===true,defaultStyle:input.defaultStyle||'neutral',
    objective:input.objective||'',personality:input.personality||'',stopResponse:input.stopResponse||'',facts:{},questions:{},required:[]};
  for(const key of ['objective','personality'])if(typeof p[key]!=='string'||p[key].length>2000)throw Error('Invalid intelligence context');
  if(p.stopResponse){if(!text(p.stopResponse))throw Error('Invalid stop response');assertTruthfulLiteral(p.stopResponse);}
  for(const key of ['facts','questions']){
    if(input[key]!==undefined&&(!input[key]||typeof input[key]!=='object'||Array.isArray(input[key])))throw Error('Trusted text map required');
    const entries=Object.entries(input[key]||{});if(entries.length>32)throw Error('Intelligence policy exceeds limit');
    for(const [name,value]of entries){if(!id(name)||!text(value))throw Error('Invalid trusted intelligence text');assertTruthfulLiteral(value);p[key][name]=value;}
  }
  if(input.required!==undefined&&!Array.isArray(input.required)||input.required?.length>32)throw Error('Invalid required statement list');
  const used=new Set();
  for(const r of input.required||[]){
    if(!r||!id(r.id)||used.has(r.id)||!text(r.text)||!['session-start','each-turn','customer-mentions'].includes(r.when)||!['prefix','suffix'].includes(r.position))throw Error('Invalid required statement');
    if(Object.keys(r).some(k=>!['id','text','when','position','match'].includes(k))||r.when==='customer-mentions'&&!text(r.match,80)||r.when!=='customer-mentions'&&r.match!==undefined)throw Error('Invalid conditional statement');
    assertTruthfulLiteral(r.text);
    used.add(r.id);p.required.push({id:r.id,text:r.text,when:r.when,position:r.position,...(r.match?{match:r.match}:{})});
  }
  if(JSON.stringify(p).length>16000)throw Error('Intelligence context exceeds limit');
  return freeze(p);
}
function policyProvider(env=process.env){
  if(env.SHAHVEX_AGENT_INTELLIGENCE!=='1'||env.NODE_ENV==='production'||env.VERCEL||env.RAILWAY_ENVIRONMENT||env.RAILWAY_ENVIRONMENT_ID||env.RAILWAY_PROJECT_ID)return null;
  const file=env.SHAHVEX_AGENT_INTELLIGENCE_POLICIES;
  if(!text(file,1024)||/^[a-z]+:\/\//i.test(file)||/^\\\\|^\/\//.test(file))throw Error('Local intelligence policy file required');
  return ()=>{
    if(fs.statSync(file).size>524288)throw Error('Intelligence registry exceeds limit');
    let data;try{data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{throw Error('Invalid intelligence registry JSON');}
    if(!Array.isArray(data)||data.length>64)throw Error('Invalid intelligence registry');
    return data.map(compilePolicy);
  };
}
module.exports={hash,freeze,compilePolicy,policyProvider,assertTruthfulLiteral};
