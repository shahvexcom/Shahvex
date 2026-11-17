const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('prepared intro survives a process cache reload and is scoped by voice and wording',()=>{
 const revision='test-'+process.pid;process.env.SHAHVEX_OPENING_CACHE_REVISION=revision;
 const modulePath=require.resolve('../gateway/opening-pcm-cache.cjs');delete require.cache[modulePath];
 const cache=require(modulePath),key=cache.key({voice:'test',text:'Hello, this is Lauren.',emotion:'neutral'}),pcm=Buffer.from([1,0,2,0]);
 try{cache.put(key,pcm);delete require.cache[modulePath];const reloaded=require(modulePath);assert.deepEqual(reloaded.get(key),pcm);assert.notEqual(key,reloaded.key({voice:'other',text:'Hello, this is Lauren.',emotion:'neutral'}));assert.equal(reloaded.get('../invalid'),undefined);}finally{fs.rmSync(path.resolve(__dirname,'../.data/opening-pcm-'+revision),{recursive:true,force:true});delete process.env.SHAHVEX_OPENING_CACHE_REVISION;delete require.cache[modulePath];}
});
