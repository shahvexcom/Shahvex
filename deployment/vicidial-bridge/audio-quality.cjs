'use strict';
// Stateful anti-alias filtering before 24 kHz -> 8 kHz decimation.
// The Blackman-windowed FIR keeps the telephone voice band and rejects aliases.
const TAPS=97,CUTOFF=3400/24000;
const coefficients=Float64Array.from({length:TAPS},(_,i)=>{
 const x=i-(TAPS-1)/2;
 const sinc=x===0?2*CUTOFF:Math.sin(2*Math.PI*CUTOFF*x)/(Math.PI*x);
 return sinc*(0.42-0.5*Math.cos(2*Math.PI*i/(TAPS-1))+0.08*Math.cos(4*Math.PI*i/(TAPS-1)));
});
const gain=coefficients.reduce((a,b)=>a+b,0);for(let i=0;i<TAPS;i++)coefficients[i]/=gain;
function createTelephoneDownsampler(){
 const history=new Float64Array(TAPS);let at=0,phase=0,carry=Buffer.alloc(0);
 return {push(chunk){
  const data=carry.length?Buffer.concat([carry,chunk]):chunk,usable=data.length-data.length%2;
  carry=usable<data.length?Buffer.from(data.subarray(usable)):Buffer.alloc(0);
  const out=Buffer.alloc(Math.floor((phase+usable/2)/3)*2);let written=0;
  for(let i=0;i<usable;i+=2){history[at]=data.readInt16LE(i);at=(at+1)%TAPS;if(++phase!==3)continue;phase=0;
   let sum=0,j=at-1;if(j<0)j=TAPS-1;
   for(let k=0;k<TAPS;k++){sum+=coefficients[k]*history[j];if(--j<0)j=TAPS-1;}
   out.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(sum))),written);written+=2;
  }
  return out;
 }};
}
module.exports={createTelephoneDownsampler};
