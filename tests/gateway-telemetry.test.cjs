const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTelemetry}=require('../gateway/telemetry.cjs');
test('optional timing log excludes tokens/audio/text and refuses to overwrite existing files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shahvex-metadata-')),file=path.join(dir,'timing.jsonl');
  try{
    const sink=createTelemetry(file,()=>{});sink.log({stage:'stt-start',turnId:'fixture',elapsedMs:123,characters:48,segmentIndex:0,token:'private',audio:'private',text:'private',headers:{authorization:'private'}});sink.close();
    const data=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(data.stage,'stt-start');assert.equal(data.elapsedMs,123);assert.equal(data.characters,48);assert.equal(data.segmentIndex,0);assert.ok(!JSON.stringify(data).includes('private'));
    assert.throws(()=>createTelemetry(file,()=>{}),e=>e.code==='EEXIST');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
