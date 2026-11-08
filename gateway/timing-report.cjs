'use strict';
// Input is the exported browser metadata array, never audio or transcripts.
function report(events) {
  if (!Array.isArray(events) || events.length > 2000) throw Error('Expected bounded browser timing array');
  const turns = new Map();
  for (const event of events) {
    if (!event || typeof event.turnId !== 'string') continue;
    const key = `${event.relayId || ''}:${event.turnId}`;
    if (!turns.has(key)) turns.set(key, { turnId: event.turnId });
    const turn = turns.get(key); turn[event.stage] = event;
    if(event.stage?.startsWith('tts-segment-'))(turn.segmentEvents??=[]).push(event);
  }
  const delta = (turn, start, end) => {
    const a = turn[start]?.gatewayElapsedMs, b = turn[end]?.gatewayElapsedMs;
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round(b - a) : null;
  };
  return [...turns.values()].map(t => ({turnId:t.turnId,
    vadEndpointMs: t['speech-end']?.vadDelayMs ?? null,
    sttMs: delta(t,'stt-start','stt-complete'),
    llmFirstTokenMs: delta(t,'llm-start','llm-first-token'),
    llmFirstTextChunkMs: delta(t,'llm-start','llm-first-text-chunk'),
    firstTextChunkToTtsMs: delta(t,'llm-first-text-chunk','tts-start'),
    ttsStartedBeforeLlmComplete: Number.isFinite(t['tts-start']?.gatewayElapsedMs)&&Number.isFinite(t['llm-complete']?.gatewayElapsedMs)?t['tts-start'].gatewayElapsedMs<t['llm-complete'].gatewayElapsedMs:null,
    llmTotalMs: delta(t,'llm-start','llm-complete'),
    ttsFirstPcmMs: delta(t,'tts-start','tts-first-audio'),
    segments:(t.segmentEvents||[]).filter(e=>e.stage==='tts-segment-start').map(e=>{
      const first=t.segmentEvents.find(x=>x.segmentIndex===e.segmentIndex&&x.stage==='tts-segment-first-audio');
      const complete=t.segmentEvents.find(x=>x.segmentIndex===e.segmentIndex&&x.stage==='tts-segment-complete');
      return{segmentIndex:e.segmentIndex,characters:e.characters,ttsFirstPcmMs:first?Math.round(first.gatewayElapsedMs-e.gatewayElapsedMs):null,segmentElapsedMs:complete?Math.round(complete.gatewayElapsedMs-e.gatewayElapsedMs):null};
    }),
    endpointArrivalToPlaybackScheduledMs:t['first-playback-scheduled']?.sinceSpeechEndMs ?? null,
    acousticSpeechEndToAudibleMs:null,
  }));
}
if(require.main===module){try{const data=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));process.stdout.write(JSON.stringify(report(data),null,2)+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
module.exports={report};
