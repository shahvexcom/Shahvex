'use strict';
// Separate review entry point. Never imported by the production server.
const {adapter}=require('./provider-benchmark.cjs');
function reviewServices(services,env=process.env,fetcher=fetch){
  if(env.SHAHVEX_GROQ_VOICE_REVIEW!=='1')return services;
  if(env.NODE_ENV==='production'||env.VERCEL||env.RAILWAY_PROJECT_ID||env.RAILWAY_ENVIRONMENT||env.RAILWAY_ENVIRONMENT_ID)throw Error('Groq voice review requires an isolated local development process');
  const stream=adapter('groq',{key:env.GROQ_API_KEY,model:'openai/gpt-oss-20b',maxCompletionTokens:256,fetcher});
  return {...services,async llm(messages,signal,timing=()=>{},onDelta=()=>{}){
    let first=true;
    try{
      const output=await stream(messages,signal,delta=>{signal.throwIfAborted();if(first){first=false;timing('llm-first-token');}onDelta(delta);});
      signal.throwIfAborted();
      if(output.usage.queue_time!==undefined)timing('groq-queue',{milliseconds:output.usage.queue_time*1000});
      timing('groq-headers',{milliseconds:output.diagnostic.headersMs});
      timing('groq-complete',{completionTokens:output.usage.completion_tokens??null,reasoningTokens:output.usage.reasoning_tokens??null,queueMs:output.usage.queue_time===undefined?null:output.usage.queue_time*1000,headersMs:output.diagnostic.headersMs});
      return output.text;
    }catch(e){
      const d=e.benchmarkDiagnostic;
      timing('groq-error',{httpStatus:d?.httpStatus??null,phase:d?.phase??null,networkCode:d?.networkCode??null,finishReason:d?.finishReason??null});
      throw Error(signal.aborted?'Cancelled':'Temporary Groq stream failed; response not completed');
    }
  }};
}
function launch(env=process.env){
  if(env.SHAHVEX_GROQ_VOICE_REVIEW!=='1')throw Error('Review feature is OFF; no listener started');
  if(env.SHAHVEX_AGENT_INTELLIGENCE==='1')throw Error('Agent Intelligence must remain OFF');
  if(!env.SHAHVEX_ENGINE_CONTRACT)throw Error('Existing private engine contract required');
  const settings={...env};
  if(!settings.GROQ_API_KEY&&settings.SHAHVEX_GROQ_KEY_FILE)settings.GROQ_API_KEY=require('node:util').parseEnv(require('node:fs').readFileSync(settings.SHAHVEX_GROQ_KEY_FILE,'utf8')).GROQ_API_KEY;
  // This file is staged alongside a byte-identical copy of the physical baseline.
  const {createServices,loadContract}=require('./services.cjs');
  const {createServer}=require('./server.cjs');
  const telemetry=require('./telemetry.cjs').createTelemetry(env.SHAHVEX_TIMING_LOG);
  const services=reviewServices(createServices(loadContract(env)),settings);
  const server=createServer({token:env.SHAHVEX_GATEWAY_TOKEN,services,intelligence:null,maxSessions:1,endpointSilenceMs:Number(env.SHAHVEX_ENDPOINT_SILENCE_MS||400),logger:telemetry.log});
  let observing=false,stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;clearInterval(watch);server.closeAllConnections();server.close(()=>telemetry.close());};
  const watch=setInterval(()=>{
    if(observing||stopping)return;observing=true;
    require('node:child_process').execFile('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{windowsHide:true,timeout:1000},(error,stdout)=>{
      observing=false;const reading=(stdout||'').trim(),used=/^\d+$/.test(reading)?Number(reading):NaN;
      if(error||!Number.isFinite(used)||used>=7164){telemetry.log({stage:'review-resource-stop',category:error?'monitor-failed':'gpu-pressure'});stop();}
    });
  },1000);watch.unref();
  server.listen(8789,'127.0.0.1',()=>telemetry.log({stage:'review-listening',provider:'groq',port:8789,pid:process.pid}));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
  return server;
}
if(require.main===module){try{launch();}catch{console.error('Isolated Groq review refused startup; check local review configuration');process.exitCode=1;}}
module.exports={reviewServices,launch};
