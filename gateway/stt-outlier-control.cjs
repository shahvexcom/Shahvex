'use strict';
// NO network or inference. Demonstrates ambiguity of aggregate STT timing.
const {createServices}=require('./services.cjs');
async function control(name,busyResponses,acceptedMs){
  let attempts=0;const began=performance.now();
  const services=createServices({stt:{protocol:'pcm16-json-text',url:'http://127.0.0.1:8788/transcribe'}},async()=>{
    attempts++;if(attempts<=busyResponses)return new Response('{}',{status:429});
    await new Promise(resolve=>setTimeout(resolve,acceptedMs));return Response.json({text:'synthetic control'});
  });
  await services.stt(Buffer.alloc(21120),new AbortController().signal);
  return {synthetic:true,network:false,inference:false,name,attempts,busyResponses,acceptedDelayMs:acceptedMs,totalMs:Math.round(performance.now()-began)};
}
if(require.main===module)(async()=>{
  console.log(JSON.stringify(await control('one slow accepted request',0,5200)));
  console.log(JSON.stringify(await control('22 busy admissions then normal accepted request',22,800)));
})().catch(()=>{process.exitCode=1});
module.exports={control};
