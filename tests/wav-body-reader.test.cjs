const {test}=require('node:test'),assert=require('node:assert/strict');
const {readWavBody}=require('../gateway/experimental/wav-body-reader.cjs');
test('candidate reads ordered chunks exactly and releases the lock',async()=>{
  const r=new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('ab'));c.enqueue(Buffer.from('cd'));c.close();}}),{headers:{'content-length':'4'}});
  assert.equal((await readWavBody(r)).toString(),'abcd');assert.equal(r.body.locked,false);
});
test('candidate rejects both length mismatch directions, size overflow and malformed length',async()=>{
  for(const len of ['2','6','nonsense','99999999'])await assert.rejects(readWavBody(new Response('abcd',{headers:{'content-length':len}})));
  await assert.rejects(readWavBody(new Response('abcd'),3),/limit/);
});
test('body errors never return partial audio and release the reader',async()=>{
  const r=new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('partial'));},pull(c){c.error(Error('synthetic disconnect'));}}));
  await assert.rejects(readWavBody(r),/disconnect/);assert.equal(r.body.locked,false);
});
test('non-success status retains HTTP error classification',async()=>{
  await assert.rejects(readWavBody(new Response('{}',{status:429})),e=>e.httpStatus===429);
});
