const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file){const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name==='./agent-test-audio'?load('lib/agent-test-audio.ts'):require(name),mod,mod.exports);return mod.exports;}
const {BrowserSpeechCapture}=load('lib/browser-speech-capture.ts');
const speech=()=>new Int16Array(320).fill(2000),silence=()=>new Int16Array(320);
test('early draft keeps the original finalization guard and does not reset speech capture',()=>{
 const c=new BrowserSpeechCapture(true);for(let i=0;i<20;i++)c.feed(speech(),false);
 let draft;for(let i=0;i<5;i++){const e=c.feed(silence(),false);assert.equal(e.recording,undefined);draft=e.draft||draft;}
 assert.ok(draft);for(let i=0;i<19;i++)assert.equal(c.feed(silence(),false).recording,undefined);
 const final=c.feed(silence(),false).recording;assert.ok(final);assert.ok(final.blob.size>draft.blob.size);
});
test('resumed speech invalidates the draft and preserves the complete utterance',()=>{
 const c=new BrowserSpeechCapture(true);for(let i=0;i<20;i++)c.feed(speech(),false);for(let i=0;i<15;i++)c.feed(silence(),false);
 assert.equal(c.feed(speech(),false).draftInvalidated,true);for(let i=0;i<15;i++)c.feed(speech(),false);
 let final;for(let i=0;i<25;i++)final=c.feed(silence(),false).recording||final;
 assert.ok(final);assert.equal(final.voicedMs,36*20);
});
test('production/default capture never produces speculative requests',()=>{
 const c=new BrowserSpeechCapture();for(let i=0;i<20;i++)c.feed(speech(),false);for(let i=0;i<25;i++)assert.equal(c.feed(silence(),false).draft,undefined);
});
