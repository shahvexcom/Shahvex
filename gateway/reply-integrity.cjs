'use strict';
const canonical=text=>String(text||'').toLowerCase().replace(/\b(?:mm[ -]?hmm|got it|thank you|thanks|okay|ok)\b[,.! ]*/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const sentences=text=>String(text||'').match(/[^.!?\n]+[.!?]?/g)||[];
/** Inspect complete units before they enter audio or durable conversation memory. */
function createReplayGuard(messages,customer=''){
 const old=new Set(messages.filter(m=>m.role==='assistant').flatMap(m=>sentences(m.content)).map(canonical).filter(Boolean));
 const users=new Set(messages.filter(m=>m.role==='user').flatMap(m=>sentences(m.content)).map(canonical).filter(Boolean));
 const seen=new Set();let replay=false,blocked=0;
 const oldWords=[...old].filter(s=>s.split(' ').length>=8).map(s=>new Set(s.split(' ')));
 const requested=/\b(?:repeat|say (?:that|it) again|recap|summari[sz]e|what (?:did|have) (?:I|you|we) (?:say|said|tell|told)|why are you calling|what is (?:your name|the company)|what (?:is this|are you calling) about|explain|what .*mean)\b/i.test(customer);
 return {
  allow(text){
   const units=sentences(text).map(canonical).filter(Boolean);
   const value=canonical(text);if(!value)return true;
   const duplicate=seen.has(value)&&value.split(' ').length>=4;
   const words=new Set(value.split(' '));
   const similar=words.size>=8&&oldWords.some(previous=>{const shared=[...words].filter(w=>previous.has(w)).length;return shared/Math.max(words.size,previous.size)>=0.8;});
   const repeatedPurpose=/\bI(?:'m| am) calling\b/i.test(text)&&messages.some(m=>m.role==='assistant'&&/\bI(?:'m| am) calling\b/i.test(m.content));
   const historical=!requested&&(units.some(unit=>old.has(unit)&&unit.split(' ').length>=2)||similar||repeatedPurpose);
   const copiedCustomer=!requested&&units.some(unit=>users.has(unit)&&(replay||unit.split(' ').length>=2));
   if(duplicate||historical||copiedCustomer){replay=true;blocked++;return false;}
   seen.add(value);return true;
  },
  get blocked(){return blocked;}
 };
}
const questionKey=text=>canonical(String(text).match(/\b(?:are you|do you|does your|have you|is your|what (?:is|are)|how (?:old|many|much)|may I know|can you|would you|which\b)[^?\n]*\?/i)?.[0]||text).replace(/\b(?:currently|please)\b/g,'').replace(/\s+/g,' ').trim();
/** Keep explicit Yes/No branches attached to their preceding question. Unknown is not N/A. */
function scriptQuestionProgress(script,memory,{includeBranchQuestions=false}={}){
 const entries=[];let anchor=null,condition=null;
 for(const line of String(script||'').split('\n')){
  if(/^\s*(?:knowledge|FAQs?|restrictions)\s*:?\s*$/i.test(line))break;
  const branch=line.match(/^\s*if (?:the )?(?:customer |they )?says?\s+(yes|no)\b|^\s*if\s+(yes|no)\b/i);
  if(branch)condition=anchor?{question:anchor,answer:(branch[1]||branch[2]).toLowerCase()}:null;
  if(/^\s*(?:whatever|regardless|in (?:either|both) case|always|next step)/i.test(line))condition=null;
  for(const match of line.matchAll(/\b(?:are you|do you|does your|have you|is your|what (?:is|are)|how (?:old|many|much)|may I know|can you|would you|which\b)[^?\n]*\?/gi)){
   const question=match[0];if(/^(?:are you today|are you doing|are you feeling)\b/i.test(question))continue;if(/\b(?:how are you|good time|time to talk|connect|transfer|can you hear|are you (?:still )?there)\b/i.test(question))continue;
   if(!entries.some(e=>questionKey(e.question)===questionKey(question)))entries.push({question,condition});
   if(!condition)anchor=question;
  }
 }
 return entries.map(entry=>{
  const answer=memory.completed.find(a=>questionKey(a.question)===questionKey(entry.question));
  let applicability='required';
  if(entry.condition){
   const parent=memory.completed.find(a=>questionKey(a.question)===questionKey(entry.condition.question));
   const yesNo=parent?.response.trim().match(/^(yes|yeah|yep|yup|okay|ok|sure|hmm|hm|mm|mhm|mm-hmm|no|nope)\b/i)?.[1];
   applicability=!yesNo?'unresolved':(!/^(no|nope)$/i.test(yesNo)?'yes':'no')===entry.condition.answer?'required':'not_applicable';
  }
  return {...entry,applicability:includeBranchQuestions?'required':applicability,status:answer?'answered':'pending'};
 });
}
function supportsSimpleScriptFlow(script){
 return !/\b(?:verbatim|exact wording|mandatory disclosure|read exactly|optional|end (?:the )?call|hang up|terminate|disqualif\w*|not eligible|otherwise|unless|only if|else|if (?!customer says? (?:yes|no)\b|(?:yes|no)\b))\b/i.test(script);
}
function nextScriptQuestion(script,memory,customer){
 if(!customer||/[?]|\b(?:why|what|how|who|wait|hold on|tell me|let me|don't|do not)\b/i.test(customer))return;
 if(!supportsSimpleScriptFlow(script))return;
 const answer=memory.latestAnswer===undefined?memory.completed.at(-1):memory.latestAnswer;
 if(answer?.response!==customer)return;
 const progress=scriptQuestionProgress(script,memory);
 const next=progress.find(q=>q.status==='pending'&&q.applicability!=='not_applicable');
 if(next?.applicability==='required')return next.question;
}
function customerFloorReply(text,history=[]){
 const value=String(text||'').trim();
 const previous=history.at(-1);
 if(/^are you serious[.!? ]*$/i.test(value)&&history.some(m=>m.role==='assistant'&&/refund|rebate/i.test(m.content)))return "I can't confirm that you're owed a refund. A licensed specialist would need to verify your plan first.";
 if(previous?.role==='user'&&customerFloorReply(previous.content)&&/^(?:it is good|it['’]s good|okay|ok|yes|yeah)[.! ]*$/i.test(value))return 'Of course. What would you like to ask?';
 if(/^are you serious[.!? ]*$/i.test(value))return "I'm sorry, I missed your point. What would you like me to explain?";
 if(/^(?:(?:so|really|please|just|okay|ok|I(?:'m| am) saying)[, ]+)*(?:(?:just )?tell me (?:one|a) thing|let me ask(?: you)?(?: (?:one|a) (?:thing|question))?|can I ask(?: you)?(?: (?:one|a) (?:thing|question))?)[.!? ]*$/i.test(value))return 'Of course. What would you like to ask?';
 if(/^(?:you (?:don't|do not) understand (?:me|English)|(?:do|don't) you understand (?:me|English))[.!? ]*$/i.test(value))return "I can understand English, but I missed your point. What would you like to ask?";
}
module.exports={questionKey,createReplayGuard,scriptQuestionProgress,nextScriptQuestion,customerFloorReply,supportsSimpleScriptFlow};

