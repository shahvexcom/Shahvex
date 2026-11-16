'use strict';
const acknowledgment=text=>/^(?:yes|yeah|yep|sure|okay|ok|alright|all right|go ahead|please do)[.! ,?]*$/i.test(String(text).trim());
function interruptionKind(text){
 const value=String(text||'').trim().toLowerCase();
 if(!value)return 'ignore';
 const words=value.replace(/\bmm[ -]?hmm\b/g,'mhm').replace(/\buh[ -]?huh\b/g,'uhhuh').replace(/\bof course\b/g,'ofcourse').replace(/\bi see\b/g,'isee').replace(/\ball right\b/g,'alright').split(/[\s,.!?-]+/).filter(Boolean);
 const fillers=new Set(['uh','um','erm','hmm','hm','mm','mhm','uhhuh','ah']);
 const acknowledgments=new Set(['okay','ok','yeah','yep','yes','right','sure','alright','ofcourse','isee','absolutely','certainly']);
 if(words.length&&words.every(w=>fillers.has(w)||acknowledgments.has(w)))return words.some(w=>acknowledgments.has(w))?'acknowledgment':'filler';
 return 'interrupt';
}
const key=s=>s.toLowerCase().replace(/^(?:Coming back to (?:your|the) question:|Before we finish,)\s*/i,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
function mainQuestions(script){
 let source=String(script||'');
 const task=source.search(/(?:^|\n)\s*\d*\.?\s*Tasks\s*\n/i);if(task>=0)source=source.slice(task);
 source=source.split(/(?:^|\n)\s*\d*\.?\s*(?:Knowledge|FAQs?|Restrictions)\s*\n/i)[0];
 const out=[];
 for(const line of source.split('\n')){
  if(/^\s*(?:if (?:yes|no|both|unsure|they|customer)|FAQ|Q:|customer asks|if asked)/i.test(line))continue;
  for(const match of line.matchAll(/\b(?:are you|do you|does your|have you|is your|what (?:is|are)|how (?:old|many|much)|may I know|can you|would you|which\b)[^?\n]*\?/gi)){
   const q=match[0].trim();
   if(q.length>500||/^(?:are you today|are you doing|are you feeling)\b/i.test(q)||/\b(?:good time|okay time|time to talk|minute|moment|how are you|connect|transfer|permission|continue reviewing)\b/i.test(q))continue;
   if(!out.some(x=>key(x)===key(q)))out.push(q);
  }
 }
 return out;
}
// Audio checks precede progression so a greeting cannot consume a script step.
function audioCheckReply(text,history){
 const spoken=history.filter(t=>t.role==='assistant');
 if(!spoken.length)return;
 const check="Can you hear me clearly?";
 if(spoken.length===1&&/^(?:hello|hi)\b.*\bthis is\b/i.test(spoken[0].content)&&/How are you today\?$/.test(spoken[0].content)&&/^(?:hello|hi|hey)[?!., ]*$/i.test(String(text).trim()))return;
 if(/^(?:(?:hello|hi|hey)[?!., ]*)+(?:(?:are you (?:still )?there|can you hear me)[?!., ]*)?$|^(?:are you (?:still )?there|can you hear me)[?!., ]*$/i.test(String(text).trim()))return check;
 if(spoken.at(-1).content!==check)return;
 if(/^(?:yes|yeah|yep|sure|okay|ok|I can hear you|yes I can hear you)[.! ,]*$/i.test(String(text).trim())){
  const previous=spoken.findLast(t=>t.content!==check);
  return previous?.content.replace(/\s*\[interrupted[^\]]*\]/gi,'').trim()||"Thank you. Is now a good time for a brief call?";
 }
 if(/^(?:no|nope|not really|I can(?:not|'t) hear you)[.! ,]*$/i.test(String(text).trim()))return "I'm sorry the audio isn't clear. Can you hear me now?";
}
// Only use verified spoken purpose text; arbitrary goals need the grounded model.
function scriptPurpose(config){
 const script=String(config.script||'');
 if(/\b(?:verbatim|exact (?:opening|wording)|mandatory disclosure|read exactly)\b/i.test(script+' '+(config.instructions||'')))return;
 const explicit=script.match(/\bI(?:'m| am) calling\b[^.!?\n]{4,240}[.!]/i)?.[0];
 if(explicit)return explicit;
 const goal=String(config.goal||'').trim();
 if(/^(?:review|discuss|check|confirm|schedule)\b/i.test(goal)&&goal.length<180&&!/[\n.!?]/.test(goal.replace(/[.!]+$/,'')))return `I'm calling to ${goal[0].toLowerCase()+goal.slice(1).replace(/[.!]+$/,'')}.`;
}
function openingCourtesyReply(text,history,config={}){
 const spoken=history.filter(t=>t.role==='assistant');
 if(spoken.length!==1||! /How are you today\?$/.test(spoken[0].content))return;
 const value=String(text).trim();
 // Complex questions, distress, refusals and time objections need a tailored answer.
 if(!/^(?:(?:hello|hi|hey)[,.! ]*)?(?:(?:I(?:'m| am) |doing |very )?(?:fine|good|great|well|okay|ok|not bad)(?: today)?[,.! ]*)?(?:(?:and |but )?(?:how are you(?: today| doing)?|how about you|what about you)[?!., ]*)?$|^(?:yes|yeah|okay|ok)[.! ]*$/i.test(value)||!value)return;
 const purpose=scriptPurpose(config);if(!purpose)return;
 const reciprocal=/\b(?:how are you|how about you|what about you)\b/i.test(value);
 return `${reciprocal?"I'm doing well, thank you for asking. ":''}${purpose} Is now a good time for a brief call?`;
}
function acknowledgmentReply(config,text,history,memory){
 if(!acknowledgment(text))return;
 const questions=mainQuestions(config.script);if(!questions.length)return;
 const spoken=history.filter(t=>t.role==='assistant');if(!spoken.length)return;
 const asked=spoken.filter(t=>!t.content.includes('[interrupted]')).flatMap(t=>t.content.match(/[^.!?\n]+\?/g)||[]).map(key);
 if(spoken.length===1&&/How are you today\?$/.test(spoken[0].content))return;
 const permission=/\b(?:may|can|could) I ask\b|\b(?:okay|good) time\b/i.test(spoken.at(-1).content);
 const hasBranches=/\bif\s+(?:yes|no|both|unsure|the customer|customer|they)\b/i.test(config.script);
 // Branching decisions stay with the grounded model; the initial permission
 // acknowledgment can still go directly to the first main question.
 if(hasBranches&&!permission)return;
 const next=questions.find(q=>!asked.includes(key(q)));
 if(next){
  const quoted=config.script.match(/["“](I(?:'m| am) calling[^.!?\n"”]{4,180}[.!?])/i)?.[1];
  const goal=String(config.goal||'').trim();
  const purpose=spoken.length===1?(quoted||(/^(?:review|discuss|check|confirm|schedule)\b/i.test(goal)&&goal.length<180?`I'm calling to ${goal[0].toLowerCase()+goal.slice(1).replace(/[.!?]+$/,'')}.`:'')):'';
  return `${/^(?:hello|hi)/i.test(text)?"Yes, I'm here.":'Thank you.'} ${purpose?purpose+' ':''}${next}`;
 }
 const missing=questions.find(q=>!memory.completed.some(a=>key(a.question)===key(q))&&asked.filter(x=>x===key(q)).length<2);
 if(missing)return `Before we finish, ${missing[0].toLowerCase()+missing.slice(1)}`;
}
const asksToWait=text=>! /\b(?:why|who|where|what|how|are you|do you)\b/i.test(String(text||''))&&/^(?:(?:please|just|okay|ok|um|uh|yeah|yes|yep)[, ]+)*(?:(?:wait|hold on|hang on)(?:\b[^?]*)|(?:give me|just|one|a) (?:a |one )?(?:sec(?:ond)?|moment|minute)\b[^?]*)[.! ]*$/i.test(String(text||'').trim());
module.exports={scriptPurpose,audioCheckReply,openingCourtesyReply,asksToWait,interruptionKind,acknowledgmentReply,mainQuestions,key};
