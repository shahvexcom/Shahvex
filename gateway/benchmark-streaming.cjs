'use strict';
// Opt-in, headless resident-engine probe. No real microphone/browser latency claim.
const {createServices,loadContract}=require('./services.cjs');const {Gateway}=require('./core.cjs');
async function idle(){
  const token=process.env.SHAHVEX_GATEWAY_TOKEN;if(!token)throw Error('Private existing credential required');
  const r=await fetch('http://127.0.0.1:8787/health',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok){await r.body?.cancel();throw Error('Authenticated idle check failed');}
  const h=await r.json();if(h.ready!==true||h.activeSessions!==0||h.queue?.active!==0||h.queue?.pending!==0)throw Error('Gateway must be ready and idle');
}
const probeState={phase:'initialization',mode:null};
async function main(){
  const contract=loadContract();if(contract.ollamaStreaming!==true)throw Error('Existing contract must enable streaming; it will not be modified');
  const services=createServices(contract),voice=services.voices[0];if(!voice)throw Error('Existing verified voice required');
  for(const mode of ['buffered','incremental']){
    probeState.mode=mode;probeState.phase='authenticated-idle-before';await idle();const events=[];let audioBytes=0,firstPcm=null;
    const g=new Gateway({...services,stt:async()=> 'Identify yourself and ask for consent to this local test.',
      llm:mode==='buffered'?(messages,signal,timing)=>services.llm(messages,signal,timing):services.llm,
    });
    const id=g.create('isolated-benchmark',{agentName:'Jennifer',campaignId:'synthetic-local-probe',direction:'inbound',voiceId:voice.id,
      script:'For this synthetic test only, reply in exactly two short sentences. Identify yourself as an automated assistant, then ask for consent to continue. Do not add filler.'});
    const start=performance.now();
    try{
      const result=await g.turn('isolated-benchmark',id,Buffer.alloc(640),16000,chunk=>{firstPcm??=performance.now()-start;audioBytes+=chunk.length;},event=>{events.push(event);probeState.phase=event.stage;probeState.elapsedMs=Math.round(event.elapsedMs);if(event.characters!==undefined)probeState.phraseCharacters=event.characters;});
      const stamp=name=>events.find(e=>e.stage===name)?.elapsedMs;
      const duration=(a,b)=>Number.isFinite(stamp(a))&&Number.isFinite(stamp(b))?Math.round(stamp(b)-stamp(a)):null;
      console.log(JSON.stringify({mode,stt:'stubbed; excluded',browserPlayback:'not measured',engineTurnToFirstPcmMs:Math.round(firstPcm),
        llmFirstTokenMs:duration('llm-start','llm-first-token'),llmFirstTextChunkMs:duration('llm-start','llm-first-text-chunk'),
        llmTotalMs:duration('llm-start','llm-complete'),ttsFirstPcmMs:duration('tts-start','tts-first-audio'),
        ttsStartedBeforeLlmComplete:stamp('tts-start')<stamp('llm-complete'),
        totalTurnMs:Math.round(performance.now()-start),replyCharacters:result.reply.length,
        phraseCharacters:events.filter(e=>e.stage==='tts-segment-start').map(e=>e.characters),audioSeconds:audioBytes/32000}));
    }finally{g.close('isolated-benchmark',id);}
    probeState.phase='authenticated-idle-after';await idle();
  }
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({failed:true,...probeState,errorType:error.name,engineStage:error.engineStage??null,httpStatus:error.httpStatus??null,causeCode:error.cause?.code??null}));process.exitCode=1;});
