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
const { questionParts, missingQuestion, memoryQuestionKey, answersAffirmatively } = require('./question-memory.cjs');
const questionPattern = /\b(?:are you|do you|does your|have you|is your|what\b|where\b|when\b|how\b|may I (?:know|have)|can you|could you|would you|will you|which\b)[^?\n]*\?/gi;
const policyLine = /\b(?:do not|don['’]t|never|must not|avoid|skip)\s+(?:ever\s+)?(?:ask|collect|request|screen for)\b/i;
const nonSteps = /^(?:knowledge(?: base)?|faqs?|frequently asked questions|restrictions|prohibitions|examples?|explanations?|notes|background|objections|customer questions)\b/i;
const section = /^(?:conversation flow|tasks?|call (?:flow|script)|script|screening(?: questions)?|qualification(?: questions)?|questions|opening|closing|purpose|steps|instructions|goal)\s*:?$/i;

function prohibited(question, restrictions) {
 const normalized = questionKey(question);
 const topics = [
  [/\b(?:medicare|medicaid|coverage|insurance|part [ab])\b/i, /\b(?:coverage|insurance)\b/i],
  [/\b(?:age|how old|years old)\b/i, /\bage\b/i],
  [/\b(?:rebate|refund|money back)\b/i, /\b(?:rebate|refund)\b/i],
 ];
 return restrictions.some(rule => {
  const target = rule.slice(rule.search(policyLine)).replace(policyLine,'').trim();
  if (/^(?:any|all)\s+(?:screening |business |qualification )?questions\b/i.test(target)) return true;
  if ([...target.matchAll(questionPattern)].some(match=>questionKey(match[0])===normalized)) return true;
  if (topics.some(([inQuestion,inRule])=>inQuestion.test(question)&&inRule.test(target))) return true;
  const words = target.toLowerCase().match(/[a-z0-9]+/g) || [];
  const subject = words.filter(word=>!/^(?:the|a|an|about|for|of|or|and|any|their|your|whether|if|they|you|have|customer|s|questions?|details?|ever|again)$/.test(word));
  const questionWords = new Set(normalized.split(' '));
  return subject.length > 0 && (subject.every(word=>questionWords.has(word)) ||
    subject.some(word=>/^(?:medicare|medicaid|zip|address|age|rebate|refund)$/.test(word)&&questionWords.has(word)));
 });
}

function scriptQuestions(script, instructions = '', knowledge = '') {
 const lines = String(script || '').split('\n').map(line=>line.trim().replace(/^(?:#{1,6}\s*|[-*•]\s+|\d+[.)]\s*)+/,'').replace(/\*\*/g,''));
 const restrictions = [...lines,...String(instructions).split('\n')].filter(line=>policyLine.test(line));
 const reference = String(knowledge).split('\n').map(line=>line.trim().toLowerCase()).filter(line=>line.length>4);
 const entries = [];
 let excluded = false, anchor = null, condition = null;
 for (const line of lines) {
  if (nonSteps.test(line) && (!line.includes('?') || /:/.test(line))) { excluded = true; continue; }
  if (section.test(line)) { excluded = false; continue; }
  if (excluded || reference.includes(line.toLowerCase()) || policyLine.test(line) || /^(?:Q:|A:|customer (?:asks?|says?)\b|if asked\b|for example\b|e\.g\.|such as\b|explain\b|describe\b)/i.test(line)) continue;
  const branch = line.match(/^if\s+(?:(?:the )?customer says?\s+|they say\s+)?(yes|no|unsure|both|refuses?|declines?)\b/i);
  if (branch) condition = {question:anchor, answer:/^(?:refus|declin)/i.test(branch[1]) ? 'refused' : branch[1].toLowerCase()};
  else if (/^(?:whatever|regardless|in (?:either|both) case|always|next step)/i.test(line)) condition = null;
  else if (/^(?:otherwise|else)\b/i.test(line) && condition?.answer && anchor)
   condition = {question:anchor, answer:'not:'+condition.answer};
  else if (/^(?:if|unless|otherwise|else|optional)\b/i.test(line)) condition = {question:anchor, answer:null};
  const spoken = line.replace(/^(?:if|unless|otherwise|else|optional)\b[^:?,]*[:,]\s*/i,'');
  for (const match of spoken.matchAll(questionPattern)) {
   const question = match[0];
   const prefix = spoken.slice(0,match.index).split(/[.!?]/).at(-1).trim().replace(/["“*]+$/,'').trim();
   if (prefix && !/^(?:(?:ask|question)(?:\s+(?:the )?customer)?\s*[:,-]?|(?:thank you|thanks|got it|great|perfect|okay|ok|so|and|sir|ma'am)[, ]*|(?:then |now )?ask(?: them)?[: ]*|(?:(?:so|and|now)[, ]+)?(?:please |just )?(?:let me know|tell me)[,: ]*)$/i.test(prefix)) continue;
   if (/^(?:are you today|are you doing|are you feeling)\b/i.test(question) ||
       /\b(?:how are you|how is your day|good time|time to talk|connect|transfer|can you hear|are you (?:still )?there)\b/i.test(question)) continue;
   const id = questionKey(question);
   if (!entries.some(entry=>entry.id===id && entry.condition?.answer===condition?.answer && entry.condition?.question===condition?.question))
    entries.push({id,question,condition,parts:questionParts(question), prohibited:prohibited(question,restrictions)});
   if (!condition) anchor = question;
  }
 }
 return entries.filter(entry=>!entry.prohibited);
}

const isRefusal = text => /\b(?:rather not|prefer not|don['’]t (?:want to|wish to) (?:answer|share|say|give)|not (?:sharing|saying)|that['’]s private|I refuse)\b/i.test(text);
function branchAnswer(question, response) {
 const text = response?.trim() || '';
 if (isRefusal(text)) return 'refused';
 if (/\bboth\b|\bpart a and (?:part )?b\b/i.test(text) && /\bPart A\b.*\bPart B\b/i.test(question)) return 'both';
 if (/^(?:no|nope)\b|\bI (?:do not|don't) have\b/i.test(text)) return 'no';
 if (/^(?:yes|yeah|yep|yup|correct)\b/i.test(text) || answersAffirmatively(question,text) ||
     /^do you have\b/i.test(question) && /^I have\b/i.test(text) ||
     /\b(?:coverage|medicare|medicaid|part [ab])\b/i.test(question) && /^(?:medicaid|medicare|part [ab])\b/i.test(text)) return 'yes';
 if (/^(?:unsure|not sure|I don['’]t know)\b/i.test(text)) return 'unsure';
}

/** Keep branches in script order. An unknown outcome cannot activate a branch. */
function scriptQuestionProgress(script,memory,{instructions='',knowledge='',outcomes=new Map()}={}){
 return scriptQuestions(script,instructions,knowledge).map(entry=>{
  const answer=memory.completed.find(item=>questionKey(item.question)===entry.id);
  const supplied=memory.parts?.get(memoryQuestionKey(entry.question));
  /** @type {'required'|'unresolved'|'not_applicable'} */
  let applicability='required';
  if(entry.condition){
   const parent=memory.completed.find(item=>questionKey(item.question)===questionKey(entry.condition.question));
   const recorded = outcomes.get(questionKey(entry.condition.question));
   const outcome=recorded || (parent && branchAnswer(parent.question,parent.response));
   applicability=['unclear','unanswered'].includes(recorded) ? 'not_applicable' : !outcome || !entry.condition.answer ? 'unresolved' : (entry.condition.answer.startsWith('not:') ? outcome!==entry.condition.answer.slice(4) : outcome===entry.condition.answer || entry.condition.answer==='yes' && outcome==='both') ? 'required' : 'not_applicable';
  }
  return {...entry,applicability,status:answer || outcomes?.has(entry.id)?'answered':'pending',
   speech:missingQuestion(entry.question,entry.parts,supplied),
   missingParts:entry.parts.filter(part=>!supplied?.has(part.id)).map(part=>part.label)};
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
 if(next?.applicability==='required')return next.speech;
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
function configuredQuestionOutcome(script,instructions,knowledge,question,response) {
 const outcome=branchAnswer(question,response);
 if (!['refused','unsure'].includes(outcome)) return;
 return scriptQuestions(script,instructions,knowledge).some(entry=>
  questionKey(entry.condition?.question)===questionKey(question) && entry.condition?.answer===outcome) ? outcome : undefined;
}
module.exports={configuredQuestionOutcome,scriptQuestions,questionKey,createReplayGuard,scriptQuestionProgress,nextScriptQuestion,customerFloorReply,supportsSimpleScriptFlow};

