const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('prepared intro survives a process cache reload and is scoped by voice and wording',()=>{
 const revision='test-'+process.pid;process.env.SHAHVEX_OPENING_CACHE_REVISION=revision;
 const modulePath=require.resolve('../gateway/opening-pcm-cache.cjs');delete require.cache[modulePath];
 const cache=require(modulePath),key=cache.key({voice:'test',text:'Hello, this is Lauren.',emotion:'neutral'}),pcm=Buffer.from([1,0,2,0]);
 try{cache.put(key,pcm);delete require.cache[modulePath];const reloaded=require(modulePath);assert.deepEqual(reloaded.get(key),pcm);assert.notEqual(key,reloaded.key({voice:'other',text:'Hello, this is Lauren.',emotion:'neutral'}));assert.equal(reloaded.get('../invalid'),undefined);}finally{fs.rmSync(path.resolve(__dirname,'../.data/opening-pcm-'+revision),{recursive:true,force:true});delete process.env.SHAHVEX_OPENING_CACHE_REVISION;delete require.cache[modulePath];}
});

test('campaign preparation caches the opening so the live turn issues no synthesis request', async () => {
 const {createTesterService}=require('../gateway/tester-service.cjs');
 const original=global.fetch, secret='opening-cache-campaign-fixture-'.repeat(3);
 const service=createTesterService({secret,testHooks:true});
 const config={name:'Alex',voice:'opening-fixture-'+crypto.randomUUID(),first:'ai',goal:'',task:'',script:'This is Alex from Test Team.',instructions:'',knowledge:'',style:'Natural'};
 let synthesis=0, id;
 global.fetch=async()=>{synthesis++;return new Response(Buffer.alloc(4800,12),{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}});};
 const dispatch=(action,body)=>service.dispatch(new Request('http://fixture/tester/'+action,{
  method:'POST',headers:{'x-shahvex-ai-key':secret,'x-shahvex-owner':'vici-opening-fixture','x-shahvex-session':id||'none','x-shahvex-turn':crypto.randomUUID(),'content-type':'application/json'},body:JSON.stringify(body),
 }));
 try{
  assert.deepEqual(await(await dispatch('prepare-opening',config)).json(),{cached:true});
  const prepared=synthesis;assert.ok(prepared>0);
  id=(await(await dispatch('start',{agentId:'opening-agent',config,requirePlaybackAck:true})).json()).id;
  assert.ok(id);
  const events=(await(await dispatch('turn',{opening:true})).text()).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(event=>event.type==='pcm'));
  assert.equal(synthesis,prepared);
  await dispatch('interrupt',{});
  const rephrased=(await(await dispatch('turn',{text:'Hello'})).text()).trim().split('\n').map(JSON.parse);
  assert.ok(rephrased.some(event=>event.type==='pcm'));
  assert.match(rephrased.filter(event=>event.type==='delta').map(event=>event.text).join(''),/^Hi, this is Alex/);
  assert.equal(synthesis,prepared);
 }finally{if(id)await dispatch('stop',{});global.fetch=original;}
});
