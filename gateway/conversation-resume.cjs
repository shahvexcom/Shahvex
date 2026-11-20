'use strict';
const { rememberQuestions } = require('./question-memory.cjs');
const FLOW_REVISION = 'REC414-playback-v13';
const { mainQuestions } = require('./conversation-flow.cjs');

// A short listening signal is not an answer to an interrupted business question.
function isListeningSignal(value) {
  return /^(?:(?:hello again|hello|hi|hey|absolutely|certainly|of course|please do|sounds good|that's fine|sure thing|carry on|proceed|yes|yeah|yep|yup|okay|ok|well|hmm|hm|mm|mhm|mm[- ]?hmm|uh[- ]?huh|sure|right|alright|all right|go ahead|please continue|continue|I'm listening|I am listening|I'm here|I am here|tell me more|fine|good|great|not bad|I'm fine|I am fine|I'm good|I am good|I'm well|I am well)[\s,.!?-]*)+$/i.test(String(value || '').trim());
}
// A social answer to the intro is not a screening answer or a missing-question request.
function isWellbeingReply(value) {
  const text=String(value||'').replace(/[’]/g,"'").replace(/[,.!?]+/g,' ').replace(/\s+/g,' ').trim().replace(/^(?:(?:u+h+|u+m+|erm|ah|well|oh|hey|hello|hi|okay|ok)\s+)+/i,'');
  const answer="(?:(?:I(?:'m| am)(?: doing)?|doing|feeling) )?(?:(?:pretty|very|really) )?(?:fine|good|great|well|okay|ok|not bad|alright|all right)(?: today)?(?: (?:thanks|thank you)(?: for asking)?)?";
  const reciprocal="(?:(?:and|but) )?(?:you|yourself|how about (?:you|yourself)|what about you|how are you(?: doing)?(?: today)?)";
  return new RegExp("^(?:"+answer+"(?: "+reciprocal+")?|"+reciprocal+")$",'i').test(text);
}
function introductionOnly(turn) {
  const text = String(turn?.content || '');
  return turn?.role === 'assistant' && /\b(?:hello|hi|this is|my name is|(?:you are|you're) speaking (?:with|to)|I(?:'m| am))\b/i.test(text)
    && !/\b(?:calling (?:to|about|because|regarding)|reason (?:for|I))\b/i.test(text)
    && !text.replace(/\b(?:how are you(?: today| doing(?: today)?)?|how is your day(?: going)?)\?/gi, '').includes('?');
}
function pendingQuestion(history, script = '') {
  const memory = rememberQuestions(history);
  const last = history.findLast(turn => turn.role === 'assistant');
  if (last?.content.includes('[interrupted]') && !introductionOnly(last)) {
    const question = last.content.match(/[^.!?\n]+\?/g)?.at(-1)?.trim();
    if (question && !memory.completed.some(item => item.question === question)) return question;
    const fragment = last.content.replace(/\s*\[interrupted\]/g, '').match(/(?:^|[.!]\s+)((?:are you|do you|have you|what|which|how|is your|can you|would you)\b[^.!?]*)$/i)?.[1]?.trim();
    if (fragment) {
      const normalize = text => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      const matches = mainQuestions(script).filter(item => normalize(item).startsWith(normalize(fragment)));
      if (matches.length === 1) return matches[0];
    }
  }
  return memory.pendingQuestion;
}
function openingPhase(history) {
  const spoken = history.filter(turn => turn.role === 'assistant');
  return spoken.length > 0 && spoken.every(introductionOnly);
}
function repairTurn(text, history, script = '', purposeDelivered = false) {
  if (!isListeningSignal(text) && !(isWellbeingReply(text) && openingPhase(history))) return;
  const last = history.findLast(turn => turn.role === 'assistant');
  if (openingPhase(history) && !purposeDelivered) {
    return last.content.includes('[interrupted]')
      ? { kind: 'introduction', source: last.content.replace(/\s*\[interrupted\]/g, '') }
      : { kind: 'purpose' };
  }
  const question = pendingQuestion(history, script);
  // A plain yes/yep can answer a completed yes/no question. Only greetings,
  // hesitation, or an interrupted question need repair before progression.
  const answered = rememberQuestions([...history, {role:'user',content:text}]).latestAnswer;
  if (question && (last?.content.includes('[interrupted]') || !answered)) {
    return { kind: 'question', source: question };
  }
  if (!answered && purposeDelivered) return {kind:'continue'};
}
function repairInstruction(repair) {
  if (repair.kind === 'handoff-reason') return 'The customer asks WHY the human connection is relevant. Answer that reason directly in fresh, simple wording using only the assigned script. Explain what the configured human can actually do for this customer. Do not repeat the earlier offer or report transfer status as the explanation. Never invent eligibility, benefits or actions. If consent is still needed, finish with one clear connection permission question. If consent is already given, do not ask again.';
  if (repair.kind === 'purpose-clarification') return 'The customer asks why this outbound call was made. Answer ALL parts of the actual customer question, including the configured company, department or representative role if asked. Use the assigned identity and never deny a role that is explicitly configured. Do not imply a government affiliation or licensed role unless verified in the configuration. Give one concise, freshly worded explanation of the actual script purpose. Avoid replaying the pitch or introducing yourself again. Then return to the pending business question if one remains, using fresh wording. Never say My last point was or repeat a benefits pitch. Do not ask a time-permission question again if permission was already given. Pending point: ' + JSON.stringify(repair.source || 'Use the next applicable unanswered script step.');
  if (repair.kind === 'continue') return 'Keep ownership of this outbound call and continue from the next applicable unfinished script step. Completed answers remain binding. A listening signal is not a missing business answer. Do not repeat the introduction, purpose, answered questions or a declined handoff. Never say I am here and listening, please go ahead, or ask what the customer wants help with. If all applicable steps are finished, use the configured closing rather than restarting the pitch.';

  if (repair.kind === 'introduction') return 'The customer interrupted your initial introduction with a listening signal. Reintroduce the configured name and company in one short freshly phrased sentence. Preserve mandatory disclosures. Start with Hi or Hello, state the configured name and company, and finish with one natural wellbeing question such as How are you today? Do not explain the purpose yet. Wait for their reply. Source introduction: ' + JSON.stringify(repair.source);
  if (repair.kind === 'purpose') return 'The customer has acknowledged your introduction and is listening. Briefly answer any wellbeing question first. Explain the actual purpose from the assigned script and goal in one or two natural sentences, around 20 to 35 words if supported. Use your own words, preserving required disclosures and uncertainty. Do not stop at a presence acknowledgment. Do not invent offers or facts. Then ask one relevant permission or next script question, respecting permission already given.';
  return 'The customer has not answered the pending question. This recovery rule overrides anti-repetition constraints for this unfinished step only. Ask that SAME question again, a little shorter and in natural different wording. Keep all names, alternatives, numbers and qualifying conditions. Do not add a presence check, introduction, purpose, new question or assumed answer. Output just one question. Source question: ' + JSON.stringify(repair.source);
}
function knownSalutation(history) {
  // Use only an explicit preference from the customer, never the agent's voice.
  const preference = history.filter(turn => turn.role === 'user').findLast(turn => /\b(?:call|address) me (?:sir|ma['’]?am|madam)\b/i.test(turn.content));
  const word = preference?.content.match(/\b(?:call|address) me (sir|ma['’]?am|madam)\b/i)?.[1];
  if (word) return /^sir$/i.test(word) ? 'Sir, ' : "Ma'am, ";
  const stated = history.filter(turn => turn.role === 'user').findLast(turn => /\bI(?:'m| am) (?:a )?(?:male|female|man|woman)\b/i.test(turn.content));
  return stated && /\b(?:female|woman)\b/i.test(stated.content) ? "Ma'am, " : 'Sir, ';
}
module.exports = { FLOW_REVISION, isListeningSignal, isWellbeingReply, introductionOnly, openingPhase, pendingQuestion, repairTurn, repairInstruction, knownSalutation };
