'use strict';
// Evidence preservation and blank scorecards only. No audio generation or service access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluate}=require('./concise-evaluation.cjs');
const source=path.resolve(__dirname,'../../dist/Jennifer-Concise-AB-v1');
const target=path.resolve(__dirname,'../../dist/Jennifer-Final-Evaluation-v1');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const quote=s=>'"'+String(s??'').replaceAll('"','""')+'"';
const csv=rows=>rows.map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n';
function collect(root,relative=''){
  return fs.readdirSync(path.join(root,relative),{withFileTypes:true}).flatMap(e=>{
    const name=path.join(relative,e.name);if(e.isSymbolicLink())throw Error('Unexpected evidence symlink');
    return e.isDirectory()?collect(root,name):[{relative:name,bytes:fs.statSync(path.join(root,name)).size,sha256:sha(fs.readFileSync(path.join(root,name)))}];
  });
}
const evidence=collect(source);
const key=JSON.parse(fs.readFileSync(path.join(source,'private-key','completed-answer-key.json'),'utf8'));
if(key.generated.length!==30)throw Error('Missing reply evidence');
for(const r of key.generated){
  if(sha(fs.readFileSync(path.join(source,r.labeled)))!==r.sha256||sha(fs.readFileSync(path.join(source,r.blind)))!==r.sha256)throw Error('Audio evidence changed');
}
const requests=fs.readFileSync(path.join(source,'metrics','native-requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
if(requests.length!==66||requests.some(r=>!r.completed||r.status!==200||r.receivedBytes!==r.declaredBytes))throw Error('Native integrity evidence inconsistent');
const contexts=evaluate().rows;
fs.mkdirSync(target);
const score=[['listener_id','sample_number','blind_id','customer_context','naturalness_1_5','warmth_appropriateness_1_5','jennifer_voice_consistency_1_5','pronunciation_1_5','conversational_flow_1_5','mispronunciation_or_repeat_notes','other_notes']];
key.generated.forEach((r,i)=>{
  const context=contexts.find(c=>r.trial.startsWith(c.scenario+'-'));
  score.push(['',i+1,r.blindId,context.customer,'','','','','','','']);
});
fs.writeFileSync(path.join(target,'blind-scorecard.csv'),csv(score),{flag:'wx'});
const choices=[['listener_id','pair_number','clip_A','clip_B','preference_A_B_Tie','reason']];
let n=0;
for(const c of contexts)for(let repeat=1;repeat<=3;repeat++){
  const a=key.generated.find(r=>r.trial===`${c.scenario}-baseline-r${repeat}`),b=key.generated.find(r=>r.trial===`${c.scenario}-proposed-r${repeat}`);
  const swap=crypto.createHash('sha256').update(c.scenario+repeat).digest()[0]%2;
  choices.push(['',++n,swap?b.blindId:a.blindId,swap?a.blindId:b.blindId,'','']);
}
fs.writeFileSync(path.join(target,'blind-pair-preferences.csv'),csv(choices),{flag:'wx'});
fs.writeFileSync(path.join(target,'evidence-manifest.json'),JSON.stringify({source,verifiedReplies:30,verifiedBlindCopies:30,verifiedNativeRequests:66,files:evidence},null,2)+'\n',{flag:'wx'});
if(JSON.stringify(collect(source))!==JSON.stringify(evidence))throw Error('Evidence changed during review preparation');
console.log(JSON.stringify({scorecardDirectory:target,scoredSamples:30,blindPairs:15,preservedEvidenceFiles:evidence.length,originalEvidenceChanged:false,liveRequests:0}));
