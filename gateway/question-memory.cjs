'use strict';
const key=s=>s.toLowerCase().replace(/^(?:(?:thank you|thanks|great|perfect|okay|ok|so|and|before we finish|coming back to (?:your|the) question)[,:.! ]+)+/g,'').replace(/\b(?:please|currently)\b/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
const check=s=>/^(?:Are you still there\?|Can you hear me(?: clearly)?\?|Mm-hmm[.!]?)$/i.test(s.trim());
const courtesy=s=>/\bhow are you|how (?:is|was) your day|can you hear|are you (?:still )?there|(?:is )?my voice clear|audio.*(?:clear|pause)|repeat (?:it|that)|say (?:it|that) again|what you.d like to know|what would you like (?:to ask|me to explain)\b/i.test(s);
const kind=q=>/\b(?:age|how old|years old|between \d+ and \d+)\b/i.test(q)?'age':/\b(?:your|full|first|last) name\b/i.test(q)?'name':/\b(?:what|which) (?:state|city|country)\b|\bwhere do you (?:live|reside)\b/i.test(q)?'place':/\b(?:which|what) day|morning or afternoon|preferred time|what time\b/i.test(q)?'schedule':/\b(?:may|can|could) I ask|good time|time to talk\b/i.test(q)?'permission':'other';
function usable(question,text){
 const qkind=kind(question),t=text.replace(/[’]/g,"'").trim();
 if(/\b(?:rather not|prefer not|don't want to|do not want to|not sharing|not saying|that's private|I refuse)\b/i.test(t))return false;
 if(!t||/\?|^(?:what|where|why|who|when|how|are you|do you|can you|could you|hello|hi|hey)\b|\b(?:say again|repeat|didn't catch|don't know|not sure)\b/i.test(t))return false;
 if(/^(?:I(?:'m| am) (?:still )?here|I(?:'m| am) (?:fine|good|well|great|okay|ok|doing well)|my day|thank(?:s| you))/i.test(t))return false;
 if(/^(?:okay|ok|sure|absolutely)[.! ]*$/i.test(t))return qkind==='permission';
 const bare=/^(?:yes|no|yeah|nope|yep|correct)[.! ]*$/i.test(t);
 if(bare)return !/^(?:what|which|how (?:old|many|much)|may I know)/i.test(question);
 if(qkind==='age')return /^(?:(?:um|uh|actually|no|sorry)[, ]+)*(?:(?:I(?:'m| am)|my age is|it(?:'s| is))\s+)?(?:\d{1,3}|(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and)[ -]*)+)(?:\s+years? old)?[.! ]*$/i.test(t);
 if(qkind==='name'||qkind==='place')return /^(?:(?:my (?:name|state|city) is|I(?:'m| am| live| reside)(?: in| from)?)\s+)?[a-z][a-z .'-]{1,75}$/i.test(t)&&! /^(?:yes|no|okay|ok|sure|fine|good|well|great|hmm|um|uh|waiting|here|there|at home|I have|I need|I want)\b/i.test(t);
 if(qkind==='schedule')return /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tomorrow|today|next week|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(t);
 return /^(?:yes|no|yeah|nope|yep|correct)\b|\b(?:I have|I am|I'm|my|medicaid|medicare|part [ab])\b|\d/i.test(t);
}
function rememberQuestions(history){
 const done=new Map(),pending=new Map();let active=null,checkPending=false,latestAnswer=null;
 for(const turn of history){
  if(turn.role==='assistant'){
   if(turn.content.includes('[interrupted]')){active=null;checkPending=true;continue;}
   if(check(turn.content)){checkPending=true;continue;}
   const qs=turn.content.match(/[^.!?\n]+\?/g)||[];
   if(qs.length!==1&&!(qs.length>1&&/\b(?:may|can|could) I ask\b/i.test(qs.at(-1))))continue;
   const question=qs.at(-1).trim().replace(/^(?:Coming back to (?:your|the) question:|Before we finish,)\s*/i,'');
   active={question,key:key(question)};checkPending=false;
   if(courtesy(question)&&pending.size){checkPending=true;continue;}
   if(!done.has(active.key))pending.set(active.key,question);
  }else if(turn.role==='user'){
   const text=turn.content.trim();latestAnswer=null;
   // Explicit corrections revise only a uniquely identifiable answered field.
   if(/^(?:actually|correction|no[, ]+(?:actually|I(?:'m| am)))\b/i.test(text)){
    const corrected=text.replace(/^(?:actually|correction)[,: ]*/i,'');
    const correctionKind=usable('How old are you?',corrected)?'age':/my name is/i.test(corrected)?'name':null;
    const matches=[...done.entries()].filter(([,a])=>(correctionKind?kind(a.question)===correctionKind:kind(a.question)!=='other')&&usable(a.question,corrected));
    if(matches.length===1){const [k,a]=matches[0];done.set(k,{question:a.question,response:text});latestAnswer={question:a.question,response:text};continue;}
   }
   if(checkPending){checkPending=false;const last=[...pending.entries()].filter(([,q])=>!courtesy(q)).at(-1);if(last)active={key:last[0],question:last[1]};continue;}
   if((!active||done.has(active.key))&&!/^(?:yes|no|okay|ok|sure)[.! ]*$/i.test(text)){
    const matches=[...pending.entries()].filter(([,q])=>kind(q)!=='other'&&usable(q,text));
    if(matches.length===1)active={key:matches[0][0],question:matches[0][1]};
   }
   if(!active||!usable(active.question,text))continue;
   done.set(active.key,{question:active.question,response:text});latestAnswer={question:active.question,response:text};pending.delete(active.key);
  }
 }
 const unresolved=[...pending.values()].filter(q=>!courtesy(q));
 const activePending=active&&pending.has(active.key)&&!courtesy(active.question)?active.question:unresolved.at(-1)||null;
 return {latestAnswer,completed:[...done.values()],pendingQuestion:activePending,deferredQuestions:unresolved.filter(q=>q!==activePending)};
}
module.exports={rememberQuestions};
