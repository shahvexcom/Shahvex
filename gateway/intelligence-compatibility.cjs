'use strict';
// Isolated evaluation only: no HTTP listener, credentials, native STT or TTS.
const {Gateway}=require('./core.cjs');
const {createIntelligence}=require('./agent-intelligence.cjs');
const {hash}=require('./intelligence-policy.cjs');
function scenarios(){return [
  {name:'Orin',domain:'garden',fact:'The demonstration garden is in East district.',question:'Which plant are you asking about?',turns:[
    'Where is the demonstration garden?', 'Why do leaves wilt?', 'I mean my basil plant. What should I check first?', 'I worry that watering will make it worse.', 'Can you guarantee a recovery date?']},
  {name:'Vela',domain:'library',fact:'The demonstration library guide explains catalog searches.',question:'Which search topic should we explore?',turns:[
    'What does your guide explain?', 'How do subject keywords help?', 'My topic is local history. Can you clarify how to narrow it?', 'That sounds difficult. What is the next step?', 'What is the membership fee?']}
].map((s,index)=>{
  const owner=`synthetic-owner-${index}`,disclosure='This is an automated demonstration assistant.';
  const script=`Name: ${s.name}. Help with ${s.domain} questions. ${disclosure} ${s.fact} ${s.question} No booking, payment or external action is available. Unknown business information must be described as unknown. Optional concise helpful wording and relevant general explanations are permitted. Never invent business facts.`;
  const config={agentName:s.name,campaignId:`synthetic-${s.domain}`,voiceId:`mock-voice-${index}`,direction:'inbound',script};
  const policy={version:1,approved:true,owner,campaignId:config.campaignId,voiceId:config.voiceId,approvalId:'synthetic_review',scriptSha256:hash(script),allowOptionalSpeech:true,allowGeneralKnowledge:true,defaultStyle:'neutral',objective:`Explain ${s.domain} concepts and clarify the customer topic.`,facts:{guide:s.fact},questions:{topic:s.question},required:[{id:'intro',text:disclosure,when:'session-start',position:'prefix'}]};
  return {...s,owner,config,policy,disclosure};
});}
function assertIdle(status){
  if(status?.authenticated!==true||status.ready!==true||status.activeSessions!==0||status.queue?.active!==0||status.queue?.pending!==0||status.activeRelays!==0||status.startingRelays!==0)throw Error('Production activity/health prerequisite not satisfied');
}
async function evaluate({llm,beforeRequest,live=false,limit=20,variants=['baseline','candidate']}){
  if(typeof beforeRequest!=='function')throw Error('Explicit pre-request safety guard required');
  const cases=scenarios(),rows=[];let calls=0;
  // Interleave unrelated agents inside each variant, retaining separate sessions.
  for(const variant of variants){
    const g=new Gateway({maxSessions:2,voices:cases.map(s=>({id:s.config.voiceId,verified:true})),intelligence:variant==='candidate'?createIntelligence({policies:()=>cases.map(s=>s.policy)}):null,
      stt:async()=>current.customer,tts:async()=>Buffer.alloc(640),llm:async(messages,signal,timing,onDelta)=>{
        if(++calls>limit)throw Error('Evaluation request bound reached');
        await beforeRequest({variant,agent:current.agent,turn:current.turn,signal});
        modelStart=performance.now();
        const output=await llm(messages,signal,(stage,...rest)=>{if(stage==='llm-first-token')firstToken??=performance.now();timing(stage,...rest);},delta=>{
          raw+=delta;onDelta(delta);
          if(meaningful===null){
            if(variant==='baseline'&&/[.!?](?:\s|$)/.test(raw)&&raw.trim().length>=20)meaningful=performance.now();
            if(variant==='candidate')for(const line of raw.split('\n').slice(0,-1)){
              try{const unit=JSON.parse(line);if(['speech','general','fact','question'].includes(unit.kind))meaningful=performance.now();}catch{}
            }
          }
        });
        // JSONL permits a final record without a trailing newline. The production
        // parser validates this at EOF; include it in the observation as well.
        if(variant==='candidate'&&meaningful===null){try{const unit=JSON.parse(raw.trim().split('\n').at(-1));if(['speech','general','fact','question'].includes(unit.kind))meaningful=performance.now();}catch{}}
        return output;
      }});
    const ids=cases.map(s=>g.create(s.owner,s.config));let current,modelStart,firstToken,meaningful,raw;
    try{
      for(let turn=0;turn<5;turn++)for(let i=0;i<cases.length;i++){
        const s=cases[i];current={agent:s.name,turn:turn+1,customer:s.turns[turn]};modelStart=null;firstToken=null;meaningful=null;raw='';const events=[];let reply='',error=null;
        try{reply=(await g.turn(s.owner,ids[i],Buffer.alloc(640),16000,undefined,event=>events.push(event))).reply;}
        catch(e){error=e.message;}
        const start=events.find(e=>e.stage==='llm-start')?.elapsedMs;
        const chunk=events.find(e=>e.stage===(variant==='candidate'?'intelligence-first-text-chunk':'llm-first-text-chunk'));
        const finished=events.find(e=>e.stage==='llm-complete');
        rows.push({variant,...current,raw,reply,error,modelStarted:modelStart!==null,firstTokenMs:firstToken===null?null:firstToken-modelStart,firstMeaningfulTextMs:meaningful===null?null:meaningful-modelStart,
          firstSegmentReadyMs:chunk&&start!==undefined?chunk.elapsedMs-start:null,
          completeMs:finished&&start!==undefined?finished.elapsedMs-start:null,
          mandatoryPresent:turn!==0||reply.includes(s.disclosure),historyMessages:g.owned(s.owner,ids[i]).history.length});
        // A compatibility/protocol failure is evidence, not a retry opportunity.
        if(error)return {live,calls,rows,stopped:true,reason:'First failed turn; no retry',audio:'mock PCM only'};
      }
    }finally{ids.forEach((id,i)=>g.close(cases[i].owner,id));}
  }
  return {live,calls,rows,stopped:false,audio:'mock PCM only'};
}
module.exports={scenarios,assertIdle,evaluate};
