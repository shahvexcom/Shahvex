'use strict';
// Review-only isolated benchmark. Imported nowhere in the production Gateway.
const {createHash}=require('node:crypto');
const {PhraseStream}=require('./phrase-stream.cjs');
const GROQ_MODEL='llama-3.1-8b-instant';
const LIMIT=7164;
function adapter(provider,{key,fetcher=fetch,model=GROQ_MODEL,timeoutMs=60000,maxCompletionTokens=120}={}){
  if(!['ollama','groq'].includes(provider))throw Error('Unsupported benchmark provider');
  if(!Number.isInteger(maxCompletionTokens)||maxCompletionTokens<32||maxCompletionTokens>512)throw Error('Invalid bounded completion allowance');
  if(provider==='groq'&&(typeof key!=='string'||!key.trim()||/[\r\n]/.test(key)))throw Error('Private Groq key required');
  return async(messages,signal,onDelta=()=>{})=>{
    const controller=new AbortController(),deadline=AbortSignal.timeout(timeoutMs),combined=AbortSignal.any([signal,controller.signal,deadline]);
    const body=provider==='ollama'?{model:'shahvex-natural',messages,stream:true}:{model,messages,stream:true,temperature:0.65,top_p:0.9,max_completion_tokens:maxCompletionTokens,stream_options:{include_usage:true},...(model.startsWith('openai/gpt-oss-')?{reasoning_effort:'low'}:{})};
    const endpoint=provider==='ollama'?'http://127.0.0.1:11434/api/chat':'https://api.groq.com/openai/v1/chat/completions';
    let response,reader,finished=false,text='',bytes=0,pending='',event=[],terminal=null,usage={},phase='before-headers',headersMs=null,reasoningCharacters=0,groqErrorCode=null;
    const began=performance.now();
    const codes=new Set(['invalid_api_key','invalid_request_error','model_not_found','model_decommissioned','rate_limit_exceeded','insufficient_quota','context_length_exceeded']);
    const rememberError=error=>{groqErrorCode=codes.has(error?.code)?error.code:'unrecognized-or-absent';};
    const content=delta=>{if(typeof delta!=='string')throw Error('Invalid content');text+=delta;if(text.length>16000)throw Error('Output bound exceeded');if(delta)onDelta(delta);};
    const consume=data=>{
      phase='parsing';
      if(finished)throw Error('Data after completion');
      if(provider==='groq'&&data==='[DONE]'){finished=true;return;}
      const unit=JSON.parse(data);if(unit.error){rememberError(unit.error);throw Error('Provider stream error');}
      if(provider==='ollama'){content(unit.message?.content??'');if(unit.done){finished=true;terminal=Object.fromEntries(['load_duration','prompt_eval_duration','prompt_eval_count','eval_duration','eval_count','total_duration','prompt_eval_cached_count','done_reason'].filter(k=>unit[k]!==undefined).map(k=>[k,unit[k]]));}}
      else {
        for(const source of [unit.usage,unit.x_groq?.usage])if(source)for(const k of ['prompt_tokens','completion_tokens','total_tokens','prompt_time','completion_time','queue_time','total_time'])if(Number.isFinite(source[k]))usage[k]=source[k];
        for(const source of [unit.usage,unit.x_groq?.usage])if(Number.isFinite(source?.completion_tokens_details?.reasoning_tokens))usage.reasoning_tokens=source.completion_tokens_details.reasoning_tokens;
        if(!Array.isArray(unit.choices))throw Error('Invalid choices');
        if(unit.choices.length){const choice=unit.choices[0];if(choice.index!==0||choice.delta?.tool_calls)throw Error('Unexpected completion');if(typeof choice.delta?.reasoning==='string')reasoningCharacters+=choice.delta.reasoning.length;content(choice.delta?.content??'');if(choice.finish_reason)terminal={finish_reason:['stop','length','tool_calls','content_filter','function_call'].includes(choice.finish_reason)?choice.finish_reason:'unknown'};}
      }
    };
    const line=value=>{
      if(provider==='ollama'){if(value.trim())consume(value);return;}
      if(value===''){if(event.length){consume(event.join('\n'));event=[];}return;}
      if(value.startsWith('data:'))event.push(value.slice(5).replace(/^ /,''));
    };
    try{
      response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(provider==='groq'?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(body),redirect:'error',signal:combined});
      headersMs=performance.now()-began;phase='headers';
      if(!response.ok){reader=response.body?.getReader();let bodyBytes=0,errorBody='';const decoder=new TextDecoder();if(reader)while(true){const c=await reader.read();if(c.done)break;bodyBytes+=c.value.length;if(bodyBytes>16384)break;errorBody+=decoder.decode(c.value,{stream:true});}try{rememberError(JSON.parse(errorBody).error);}catch{}throw Error(`Provider HTTP ${response.status}`);}
      const type=response.headers.get('content-type')||'';
      if(provider==='groq'?!type.includes('text/event-stream'):!type.includes('application/x-ndjson')&&!type.includes('application/json'))throw Error('Invalid stream content type');
      reader=response.body.getReader();const decoder=new TextDecoder();
      while(true){phase='stream-body';combined.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>128000)throw Error('Response bound exceeded');pending+=decoder.decode(chunk.value,{stream:true});let n;while((n=pending.indexOf('\n'))>=0){line(pending.slice(0,n).replace(/\r$/,''));pending=pending.slice(n+1);}}
      pending+=decoder.decode();if(pending)line(pending.replace(/\r$/,''));if(provider==='groq'&&event.length)line('');
      phase='completion-validation';combined.throwIfAborted();if(!finished||!text.trim()||provider==='groq'&&!terminal)throw Error('Incomplete provider stream');
      if(provider==='groq'&&terminal?.finish_reason!=='stop'||terminal?.done_reason==='length')throw Error('Response did not complete normally');
      return {text,terminal,bytes,...(provider==='groq'?{usage}:{} ),diagnostic:{httpStatus:response.status,headersMs,finishReason:terminal?.finish_reason||terminal?.done_reason||null,doneMarker:finished,reasoningCharacters,deadlineMs:timeoutMs}};
    }catch(e){
      const knownNetwork=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EACCES','EPERM','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID']);
      const chain=[e,e.cause,...(e.cause?.errors||[])];const networkCode=chain.map(x=>x?.code).find(c=>knownNetwork.has(c))||null;
      const error=Error(combined.aborted?'Benchmark cancelled or timed out':/^Provider HTTP \d+$/.test(e.message)?e.message:'Provider stream failed integrity/compatibility validation');
      error.benchmarkDiagnostic={httpStatus:response?.status??null,phase,groqErrorCode,networkCode,timeoutStage:deadline.aborted?phase:networkCode?.includes('TIMEOUT')?phase:null,clientDeadlineExpired:deadline.aborted,callerCancelled:signal.aborted,deadlineMs:timeoutMs,headersMs,receivedBytes:bytes,contentCharacters:text.length,reasoningCharacters,finishReason:terminal?.finish_reason||terminal?.done_reason||null,doneMarker:finished};throw error;
    }
    finally{controller.abort();try{if(reader){await reader.cancel();reader.releaseLock();}else await response?.body?.cancel();}catch{}}
  };
}
function cases(){
  const system='You are a synthetic automated library assistant. Keep optional replies concise and helpful. Never claim to be human or invent company facts, prices or completed actions. When asked about fees say exactly: "Fees are not provided in this demonstration." The demonstration guide covers catalog searches. Ask for clarification when details are missing.';
  return [
    ['fact','What does the demonstration guide cover?',[]],
    ['general','How can I narrow a catalog search?',[]],
    ['followup','Could you clarify what you mean by that?',[{role:'user',content:'I am researching local history.'},{role:'assistant',content:'You can narrow the search by place and period.'}]],
    ['objection','That sounds confusing. What should I try first?',[]],
    ['missing','What are your membership fees?',[]]
  ].map(([id,input,history])=>({id,messages:[{role:'system',content:system},...history,{role:'user',content:input}],required:id==='missing'?'Fees are not provided in this demonstration.':null}));
}
function plan(seed=20261103){let state=seed>>>0;const rows=cases().flatMap(c=>['ollama','groq'].map(provider=>({provider,...c})));for(let i=rows.length-1;i>0;i--){state=(1664525*state+1013904223)>>>0;const j=state%(i+1);[rows[i],rows[j]]=[rows[j],rows[i]];}return rows;}
function gate(s,provider,{admission=false}={}){
  if(!s||s.authenticated!==true||s.ready!==true||s.maintenance!==true||s.activeSessions!==0||s.queue?.active!==0||s.queue?.pending!==0||s.activeRelays!==0||s.startingRelays!==0||s.noCompetingTests!==true||!Number.isFinite(s.ageMs)||s.ageMs<0||s.ageMs>3000)throw Error('Fresh authenticated quiet window unavailable');
  if(!Number.isFinite(s.gpuUsedMiB)||s.gpuUsedMiB<0||s.gpuUsedMiB>=LIMIT)throw Error('GPU safety ceiling');
  if(admission&&provider==='ollama'&&s.gpuUsedMiB>3687)throw Error('Ollama admission blocked');
  if(admission&&provider==='groq'&&(s.gpuUsedMiB+256>LIMIT||s.ollamaResident!==false))throw Error('Cloud baseline requires headroom and natural Ollama expiry');
}
async function run({approved=false,providers,snapshot,seed=20261103,monitorMs=250,variants=['ollama','groq'],caseIds=null}){
  if(!approved||typeof snapshot!=='function')throw Error('Separate phase-2 approval and trusted observer required');
  if(!Array.isArray(variants)||!variants.length||new Set(variants).size!==variants.length||variants.some(v=>!['ollama','groq'].includes(v)))throw Error('Invalid provider selection');
  if(caseIds!==null&&(!Array.isArray(caseIds)||!caseIds.length||caseIds.some(id=>!cases().some(c=>c.id===id))))throw Error('Invalid case selection');
  if(!Number.isFinite(monitorMs)||monitorMs<100||monitorMs>1000)throw Error('Invalid monitoring interval');
  const observe=async()=>{let timeout;try{return await Promise.race([snapshot(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Activity/resource observer timed out')),1000);})]);}finally{clearTimeout(timeout);}};
  const rows=[];
  for(const item of plan(seed).filter(item=>variants.includes(item.provider)&&(caseIds===null||caseIds.includes(item.id)))){
    let before;try{before=await observe();gate(before,item.provider,{admission:true});}catch(e){rows.push({id:item.id,provider:item.provider,status:'blocked',reason:e.message});break;}
    const stop=new AbortController();let monitorError=null,checking=false,monitorTask=null;const samples=[before];
    const timer=setInterval(()=>{if(checking)return;checking=true;monitorTask=(async()=>{try{const s=await observe();samples.push(s);gate(s,item.provider);}catch(e){monitorError=e.message;stop.abort();}finally{checking=false;}})();},monitorMs);
    const started=performance.now();let firstToken=null,firstLexical=null,firstPhrase=null,result,error=null,responseEnd=null,providerDiagnostic=null;
    const phrases=new PhraseStream(stop.signal,()=>{firstPhrase??=performance.now()-started;});
    try{result=await providers[item.provider](item.messages,stop.signal,delta=>{firstToken??=performance.now()-started;if(/[\p{L}\p{N}]/u.test(delta))firstLexical??=performance.now()-started;phrases.push(delta);});phrases.finish(result.text);if(stop.signal.aborted)throw Error('Activity/resource cancellation');}
    catch(e){error=monitorError||(/^Provider HTTP \d{3}$/.test(e?.message||'')?e.message:'Provider failure; no retry');providerDiagnostic=e.benchmarkDiagnostic||null;}
    finally{responseEnd=performance.now();clearInterval(timer);await monitorTask;phrases.dispose();}
    if(monitorError)error=monitorError;
    rows.push({id:item.id,provider:item.provider,status:error?'failed':'complete',error,providerDiagnostic,requestHash:createHash('sha256').update(JSON.stringify(item.messages)).digest('hex'),firstTokenMs:firstToken,firstLexicalMs:firstLexical,firstPhraseMs:firstPhrase,totalMs:responseEnd-started,observerCleanupMs:performance.now()-responseEnd,peakSampledMiB:Math.max(...samples.map(s=>s.gpuUsedMiB)),samples,result,mandatoryPresent:result&&item.required?result.text.includes(item.required):null});
    if(error)break;
  }
  return {phase:2,seed,rows,nativeAudio:false};
}
module.exports={adapter,cases,plan,gate,run,GROQ_MODEL};
