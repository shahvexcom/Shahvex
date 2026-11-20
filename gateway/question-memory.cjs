'use strict';
const key=s=>s.replace(/^\s*(?:sir|ma['’]?am|madam)[, .!]+/i,'').toLowerCase().replace(/^(?:(?:thank you|thanks|great|perfect|okay|ok|so|and|before we finish|coming back to (?:your|the) question)[,:.! ]+)+/g,'').replace(/\b(?:please|currently)\b/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
const check=s=>/^(?:Are you still there\?|Can you hear me(?: clearly)?\?|Mm-hmm[.!]?)$/i.test(s.trim());
const courtesy=s=>/\bhow are you|how (?:is|was) your day|can you hear|are you (?:still )?there|(?:is )?my voice clear|audio.*(?:clear|pause)|repeat (?:it|that)|say (?:it|that) again|what you.d like to know|what would you like (?:to ask|me to explain)\b/i.test(s);
const kind=q=>/\b(?:age|how old|years old|between \d+ and \d+)\b/i.test(q)?'age':/\b(?:your|full|first|last) name\b/i.test(q)?'name':/\b(?:what|which) (?:state|city|country)\b|\bwhere do you (?:live|reside)\b/i.test(q)?'place':/\b(?:which|what) day|morning or afternoon|preferred time|what time\b/i.test(q)?'schedule':/\b(?:may|can|could) I ask|good time|time to talk\b/i.test(q)?'permission':'other';
const contextualAffirmation = /^(?:(?:yes|yeah|yep|yup)[,. ]+)?(?:I (am|do|have|can|will|would|could|did)|that['’]s right)[.! ]*$/i;
function answersAffirmatively(question, text) {
 const match=text.trim().match(contextualAffirmation);
 if(!match)return false;
 const start=key(question).match(/^(are|is|am|do|does|did|have|has|can|could|would|will|was|were|should)\b/)?.[1];
 if(!start||courtesy(question))return false;
 if(!match[1])return true;
 const verb=match[1].toLowerCase();
 if(verb==='am')return start==='are';
 if(verb==='do')return start==='do'||start==='does';
 if(verb==='have')return start==='have'||start==='has'||/^do you have\b/.test(key(question));
 return verb===start;
}
function usable(question,text){
 const qkind=kind(question),t=text.replace(/[’]/g,"'").trim();
 if(/\b(?:rather not|prefer not|don't want to|do not want to|not sharing|not saying|that's private|I refuse)\b/i.test(t))return false;
 if(/^(?:(?:yes|yeah|yep|okay|ok)[,.! ]*)?(?:I(?:'m| am) (?:still )?(?:here|listening)|I can hear you|I hear you|go ahead|please continue)[.!? ]*$/i.test(t))return false;
 if(!t||/\?|^(?:what|where|why|who|when|how|are you|do you|can you|could you|hello|hi|hey)\b|\b(?:say again|repeat|didn't catch|don't know|not sure)\b/i.test(t))return false;
 if(/^(?:I(?:'m| am) (?:still )?here|I(?:'m| am) (?:fine|good|well|great|okay|ok|doing well)|my day|thank(?:s| you))/i.test(t))return false;
 if(/^(?:okay|ok|sure|absolutely|yup|hmm|hm|mm|mhm|mm[- ]?hmm)[.! ]*$/i.test(t))return /^(?:are|is|do|does|have|has|can|could|would|will|may)\b/i.test(question) || qkind==='permission';
 if(contextualAffirmation.test(t))return answersAffirmatively(question,t);
 const bare=/^(?:yes|no|yeah|nope|yep|correct)[.! ]*$/i.test(t);
 if(bare)return !/^(?:what|which|how (?:old|many|much)|may I know)/i.test(question);
 if(qkind==='age')return /^(?:(?:um|uh|actually|no|sorry)[, ]+)*(?:(?:I(?:'m| am)|my age is|it(?:'s| is))\s+)?(?:\d{1,3}|(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and)[ -]*)+)(?:\s+years? old)?[.! ]*$/i.test(t);
 if(qkind==='name'||qkind==='place')return /^(?:(?:my (?:name|state|city) is|I(?:'m| am| live| reside)(?: in| from)?)\s+)?[a-z][a-z .'-]{1,75}$/i.test(t)&&! /^(?:yes|no|okay|ok|sure|fine|good|well|great|hmm|um|uh|waiting|here|there|at home|I have|I need|I want)\b/i.test(t);
 if(qkind==='schedule')return /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tomorrow|today|next week|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(t);
 return /^(?:yes|no|yeah|nope|yep|correct)\b|\b(?:I have|I am|I'm|my|medicaid|medicare|part [ab])\b|\d/i.test(t);
}
function rememberQuestions(history){
 const done=new Map(),pending=new Map();let active=null,checkPending=false,latestAnswer=null,lastSpokenQuestion=null;
 for(const turn of history){
  if(turn.role==='assistant'){
   lastSpokenQuestion=null;
   if(turn.content.includes('[interrupted]')){const qs=turn.content.replace(/\s*\[interrupted\]/g,'').match(/[^.!?\n]+\?/g)||[];const q=qs.at(-1)?.trim();if(q&&!courtesy(q)&&!done.has(key(q)))pending.set(key(q),q);active=null;checkPending=true;continue;}
   if(check(turn.content)){checkPending=true;continue;}
   const qs=turn.content.match(/[^.!?\n]+\?/g)||[];
   if(qs.length!==1&&!(qs.length>1&&/\b(?:may|can|could) I ask\b/i.test(qs.at(-1))))continue;
   const question=qs.at(-1).trim().replace(/^(?:Coming back to (?:your|the) question:|Before we finish,)\s*/i,'');
   active={question,key:key(question)};lastSpokenQuestion=active.key;checkPending=false;
   if(courtesy(question)&&pending.size){checkPending=true;continue;}
   if(!done.has(active.key))pending.set(active.key,question);
  }else if(turn.role==='user'){
   const text=turn.content.trim();latestAnswer=null;
   if(turn.conversationOnly===true)continue;
   // Explicit corrections revise only a uniquely identifiable answered field.
   if(/^(?:actually|correction|no[, ]+(?:actually|I(?:'m| am)))\b/i.test(text)){
    const corrected=text.replace(/^(?:actually|correction)[,: ]*/i,'');
    const correctionKind=usable('How old are you?',corrected)?'age':/my name is/i.test(corrected)?'name':null;
    const matches=[...done.entries()].filter(([,a])=>(correctionKind?kind(a.question)===correctionKind:kind(a.question)!=='other')&&usable(a.question,corrected));
    if(matches.length===1){const [k,a]=matches[0];done.set(k,{question:a.question,response:text});latestAnswer={question:a.question,response:text};continue;}
   }
   if(checkPending){checkPending=false;const last=[...pending.entries()].filter(([,q])=>!courtesy(q)).at(-1);if(last){active={key:last[0],question:last[1]};const presence=/^(?:(?:yes|yeah|yep|okay|ok)[,.! ]*)?(?:I(?:'m| am)(?: (?:still )?(?:here|listening))?|I (?:can )?hear you|I can)[.!? ]*$/i.test(text);if(!presence&&!contextualAffirmation.test(text)&&text.split(/\s+/).length>1&&usable(active.question,text)){done.set(active.key,{question:active.question,response:text});latestAnswer={question:active.question,response:text};pending.delete(active.key);}}continue;}
   if(!contextualAffirmation.test(text)&&(!active||done.has(active.key))&&!/^(?:yes|no|okay|ok|sure)[.! ]*$/i.test(text)){
    const matches=[...pending.entries()].filter(([,q])=>kind(q)!=='other'&&usable(q,text));
    if(matches.length===1)active={key:matches[0][0],question:matches[0][1]};
   }
   if(!active||contextualAffirmation.test(text)&&(active.key!==lastSpokenQuestion||done.has(active.key))||!usable(active.question,text))continue;
   done.set(active.key,{question:active.question,response:text});latestAnswer={question:active.question,response:text};pending.delete(active.key);
  }
 }
 const unresolved=[...pending.values()].filter(q=>!courtesy(q));
 const activePending=active&&pending.has(active.key)&&!courtesy(active.question)?active.question:unresolved.at(-1)||null;
 return {latestAnswer,completed:[...done.values()],pendingQuestion:activePending,deferredQuestions:unresolved.filter(q=>q!==activePending)};
}
/** Match only a unique, high-overlap rewording; preserve numbers and Part A/B alternatives. */
function canonicalQuestion(value,sources){
 const question=(String(value).match(/[^.!?\n]+\?/g)||[]).at(-1)?.trim();if(!question)return;
 const exact=sources.find(source=>key(source)===key(question));if(exact)return exact;
 const digits=text=>(text.match(/\d+/g)||[]).join('|');
 const qualifiers=text=>{const v=text.toLowerCase().replace(/monthly/g,'month').replace(/weekly/g,'week').replace(/yearly|annually/g,'year').replace(/daily/g,'day');return JSON.stringify({negative:/\b(?:not|never|without|don['’]?t)\b/.test(v),terms:(v.match(/\bpart [ab]\b|\b(?:month|week|year|day)\b/g)||[]).sort()});};
 const tokens=text=>new Set(key(text).replace(/part ([ab])\b/g,'part_$1').split(' ').filter(word=>word&&!/^(?:sir|maam|are|is|do|does|did|you|your|the|a|an|any|some|can|could|would|please|tell|me|whether|currently|now|at|on|in|of|or|and|have|getting|receive|receiving)$/.test(word)));
 const spoken=tokens(question),ranked=sources.filter(source=>digits(source)===digits(question)&&qualifiers(source)===qualifiers(question)).map(source=>{const words=tokens(source),shared=[...words].filter(word=>spoken.has(word)).length;return {source,score:shared/Math.max(1,Math.max(words.size,spoken.size)),shared};}).filter(item=>item.shared>=2&&item.score>=.65).sort((a,b)=>b.score-a.score);
 if(ranked[0]&&(!ranked[1]||ranked[0].score-ranked[1].score>=.2))return ranked[0].source;
}
module.exports={rememberQuestions,canonicalQuestion,answersAffirmatively};

