const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../gateway/inspect-performance.cjs');
const lines=events=>events.map(e=>JSON.stringify({message:'[Shahvex voice timing] '+JSON.stringify(e)})).join('\n');
test('latest incomplete recording is measured without inventing its stop or acoustic latency',()=>{
  const result=inspect(lines([
    {stage:'recording-start',relayId:'old',atMs:100},
    {stage:'recording-stop',relayId:'old',atMs:200},
    {stage:'recording-start',relayId:'new',atMs:50},
    {stage:'speech-end',relayId:'new',turnId:'turn',atMs:1000,vadDelayMs:400},
    {stage:'first-playback-scheduled',relayId:'new',turnId:'turn',atMs:5000,sinceSpeechEndMs:4000,estimatedOutputAtMs:5080},
  ]));
  assert.equal(result.relayId,'new');assert.equal(result.recordingStopObserved,false);
  assert.equal(result.recordingSpanSeconds,null);assert.equal(result.turns[0].endpointArrivalToPlaybackScheduledMs,4000);
  assert.equal(result.turns[0].acousticSpeechEndToAudibleMs,null);
});
test('completed recording excludes later session events',()=>{
  const result=inspect(lines([
    {stage:'recording-start',relayId:'one',atMs:0},
    {stage:'recording-stop',relayId:'one',atMs:1000},
    {stage:'speech-end',relayId:'one',turnId:'outside',atMs:1200},
  ]));
  assert.equal(result.recordingStopObserved,true);assert.equal(result.recordingSpanSeconds,1);
  assert.deepEqual(result.turns,[]);
});
