'use strict';
const fs=require('node:fs');
async function run(port,label,index){
  const began=performance.now();let first=null,audioEnd=0,totalGap=0;const events=[];
  for(const text of ['I completely understand your concern.','Let me explain the appointment process, and our staff will confirm a time that suits you.']){
    const response=await fetch(`http://127.0.0.1:${port}/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,voice_id:'female_02'}),signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('TTS join check failed');let phraseFirst=null,phraseGap=0;
    for await(const chunk of response.body){
      const now=(performance.now()-began)/1000;if(first===null)first=now;
      if(phraseFirst===null){phraseFirst=now;if(audioEnd>0)phraseGap=Math.max(0,now-audioEnd);}
      const gap=audioEnd>0?Math.max(0,now-audioEnd):0;totalGap+=gap;
      audioEnd=Math.max(audioEnd,now)+chunk.length/48000;
    }
    events.push({text,firstAudioSeconds:phraseFirst,precedingGapSeconds:phraseGap});
  }
  return{mode:label,run:index,firstAudioMs:Math.round(first*1000),joinGapMs:Math.round(events[1].precedingGapSeconds*1000),totalUnderflowMs:Math.round(totalGap*1000),events};
}
async function main(){
  if(process.env.SHAHVEX_LOCAL_JOIN_COMPARE!=='1')throw Error('Local comparison opt-in required');
  const results=[];for(let i=0;i<2;i++)for(const [port,label]of [[8767,'baseline'],[8776,'candidate']]){const r=await run(port,label,i+1);results.push(r);console.log(JSON.stringify(r));}
  fs.writeFileSync('.data/pc-ai/native-tts-compare/join-results.json',JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
