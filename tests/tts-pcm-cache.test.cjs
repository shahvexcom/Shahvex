const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPcmCache}=require('../gateway/tts-pcm-cache.cjs');
test('cache preserves exact audio bytes and isolates voices, emotion and words',()=>{
 const c=createPcmCache(),key=c.key({text:'Hello.',voice:'lissa',emotion:'neutral'}),pcm=Buffer.from([1,2,3,4]);c.put(key,pcm);pcm[0]=9;assert.deepEqual(c.get(key),Buffer.from([1,2,3,4]));
 for(const change of [{voice:'emma'},{emotion:'laugh'},{text:'Hello!'}])assert.equal(c.get(c.key({text:'Hello.',voice:'lissa',emotion:'neutral',...change})),undefined);
});
test('cache expires audio and evicts under a fixed memory budget',()=>{
 let now=0;const c=createPcmCache({maxBytes:6,maxEntryBytes:4,ttlMs:10,now:()=>now});c.put('a',Buffer.alloc(4));c.put('b',Buffer.alloc(4));assert.equal(c.get('a'),undefined);assert.ok(c.get('b'));now=10;assert.equal(c.get('b'),undefined);c.put('oversize',Buffer.alloc(5));assert.equal(c.get('oversize'),undefined);
});
