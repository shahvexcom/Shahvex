const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTelephoneDownsampler}=require('../deployment/vicidial-bridge/audio-quality.cjs');
function tone(hz,seconds=0.5){const out=Buffer.alloc(Math.round(24000*seconds)*2);for(let i=0;i<out.length/2;i++)out.writeInt16LE(Math.round(10000*Math.sin(2*Math.PI*hz*i/24000)),2*i);return out;}
function rms(data){let total=0,n=0;for(let i=800;i<data.length;i+=2){total+=data.readInt16LE(i)**2;n++;}return Math.sqrt(total/n);}
test('telephone resampling preserves voice-band gain and strongly rejects aliasing above Nyquist',()=>{
 const reference=10000/Math.sqrt(2),pass=rms(createTelephoneDownsampler().push(tone(1000))),edge=rms(createTelephoneDownsampler().push(tone(3000))),stop=rms(createTelephoneDownsampler().push(tone(6000)));
 assert.ok(pass/reference>0.95&&pass/reference<1.05);assert.ok(edge/reference>0.8);assert.ok(stop/reference<0.0032,'6 kHz must be suppressed by at least 50 dB before 8 kHz conversion');
});
test('streaming resampling is identical across odd byte boundaries without dropping or duplicating samples',()=>{
 const input=tone(1700),expected=createTelephoneDownsampler().push(input),stream=createTelephoneDownsampler(),parts=[];let at=0,i=0;const sizes=[1,31,1920,3,257];while(at<input.length){const n=Math.min(sizes[i++%sizes.length],input.length-at);parts.push(stream.push(input.subarray(at,at+n)));at+=n;}assert.deepEqual(Buffer.concat(parts),expected);assert.equal(expected.length,Math.floor(input.length/6)*2);
});
