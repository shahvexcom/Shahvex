'use strict';
const fs=require('node:fs');const {report}=require('./timing-report.cjs');
function inspect(text){
  const events=[];
  for(const line of text.split(/\r?\n/)){
    try{const entry=JSON.parse(line),prefix='[Shahvex voice timing] ';if(typeof entry.message==='string'&&entry.message.startsWith(prefix))events.push(JSON.parse(entry.message.slice(prefix.length)));}catch{}
  }
  const completed=events.filter(e=>e.stage==='recording-stop').at(-1);
  const lastStart=events.filter(e=>e.stage==='recording-start'&&e.relayId).at(-1);
  // performance.now() resets on reload; log order, not cross-page clock values,
  // determines whether the newest recording has a stop event.
  const missingStop=Boolean(lastStart&&(!completed||events.lastIndexOf(lastStart)>events.lastIndexOf(completed)));
  const stop=missingStop?events.filter(e=>e.relayId===lastStart.relayId).at(-1):completed;
  if(!stop)throw Error('No recorded browser timing session found');
  const session=events.filter(e=>e.relayId===stop.relayId);
  const start=session.filter(e=>e.stage==='recording-start'&&e.atMs<=stop.atMs).at(-1);if(!start)throw Error('Recording start missing');
  const selected=session.filter(e=>e.atMs>=start.atMs&&e.atMs<=stop.atMs);
  return{relayId:stop.relayId,recordingStopObserved:!missingStop,recordingSpanSeconds:missingStop?null:(stop.atMs-start.atMs)/1000,observedSpanSeconds:(stop.atMs-start.atMs)/1000,turns:report(selected),errors:selected.filter(e=>e.stage==='engine-error').map(e=>({turnId:e.turnId,code:e.code,httpStatus:e.httpStatus,recordingOffsetSeconds:(e.atMs-start.atMs)/1000})),alignment:selected.filter(e=>e.stage==='speech-end').map(end=>{
    const play=selected.find(e=>e.turnId===end.turnId&&e.stage==='first-playback-scheduled');
    return{turnId:end.turnId,lastMicSpeechEstimateSeconds:(end.atMs-start.atMs-end.vadDelayMs)/1000,endpointArrivalSeconds:(end.atMs-start.atMs)/1000,deviceOutputEstimateSeconds:play?.estimatedOutputAtMs?(play.estimatedOutputAtMs-start.atMs)/1000:null};
  })};
}
if(require.main===module){try{console.log(JSON.stringify(inspect(fs.readFileSync(process.argv[2]||'.next/dev/logs/next-development.log','utf8')),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={inspect};
