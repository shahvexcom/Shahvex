const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTesterService}=require('../gateway/tester-service.cjs');
test('actual tester answers the expression question directly and asks TTS to laugh',async()=>{
 const oldFetch=global.fetch,oldFlag=process.env.SHAHVEX_LISSA_EMOTIONS;process.env.SHAHVEX_LISSA_EMOTIONS='1';const requests=[];
 global.fetch=async(url,init)=>{assert.match(String(url),/127\.0\.0\.1:8767\/stream$/);requests.push(JSON.parse(init.body));return new Response(new Uint8Array(1920).fill(12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}})};
 const key='local-expression-test-'.repeat(3),{dispatch}=createTesterService({secret:key});let id;
 const call=(action,body)=>dispatch(new Request('http://localhost/tester/'+action,{method:'POST',headers:{'x-shahvex-ai-key':key,'x-shahvex-owner':'expression-review','x-shahvex-session':id||'none','content-type':'application/json'},body:JSON.stringify(body)}));
 try{
  const started=await call('start',{agentId:'expression',config:{name:'Lissa',voice:'lissa',first:'customer',goal:'',task:'',instructions:'',script:'',knowledge:'',style:'Natural'}});id=(await started.json()).id;
  for(const [question,answer]of [['Do you have expressions?','Yes, I do have expressions.'],['teray pass expression hay?','Yes, I do have expressions.'],['Can you laugh for me?','Yes, I can.'],['smile kr k dikhao','Yes, I can.']]){
   const r=await call('turn',{text:question});assert.equal(r.status,200);const events=(await r.text()).trim().split('\n').map(l=>JSON.parse(l));assert.equal(events.filter(e=>e.type==='delta').map(e=>e.text).join(''),answer);assert.equal(requests.at(-1).emotion,'laugh');assert.equal(requests.at(-1).text,answer);
  }
 }finally{if(id)await call('stop',{});global.fetch=oldFetch;if(oldFlag===undefined)delete process.env.SHAHVEX_LISSA_EMOTIONS;else process.env.SHAHVEX_LISSA_EMOTIONS=oldFlag;}
});
