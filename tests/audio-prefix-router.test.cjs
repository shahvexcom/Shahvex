const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),crypto=require('node:crypto');
const {createPrefixRouter}=require('../../../tools/audio-prefix-router.cjs');
const {packet}=require('../deployment/vicidial-bridge/server.cjs');
test('router preserves fragmented UUID and trailing PCM bytes and selects only configured prefixes',async()=>{
 const seen=[];const backend=name=>net.createServer(s=>s.on('data',b=>{seen.push({name,b});s.write(name)}));const manual=backend('manual'),production=backend('production');
 await Promise.all([manual,production].map(s=>new Promise(r=>s.listen(0,'127.0.0.1',r))));
 const router=createPrefixRouter({host:'127.0.0.1',port:0,manualPort:manual.address().port,productionPort:production.address().port});const sockets=[];
 try{await router.listen();for(const [prefix,expected]of [['3531','production'],['3532','production'],['3533','production'],['3534','production'],['3540','production'],['3541','production'],['3548','production'],['3550','production'],['aaaa','manual']]){const uuid=prefix+crypto.randomUUID().slice(4),data=Buffer.concat([packet(1,Buffer.from(uuid.replaceAll('-',''),'hex')),packet(0x10,Buffer.alloc(320,42))]);const s=net.connect(router.server.address().port,'127.0.0.1');sockets.push(s);await new Promise(r=>s.once('connect',r));const received=new Promise(r=>s.once('data',r));s.write(data.subarray(0,5));await new Promise(r=>setTimeout(r,5));s.write(data.subarray(5));assert.equal((await received).toString(),expected);const entries=seen.filter(x=>x.name===expected);assert.deepEqual(entries.at(-1).b,data);s.destroy();}}finally{sockets.forEach(s=>s.destroy());router.close();manual.close();production.close();}
});
