'use strict';

const catalog = require('./scenario-catalog.json');

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const examples = Object.fromEntries(Object.entries(catalog).map(([scope, rows]) =>
  [scope, new Map(rows.map(row => [normalize(row.customer), row.action]))]));
const repeatExamples = new Set(Object.entries(examples).flatMap(([, rows]) =>
  [...rows].filter(([, action]) => action === 'REPEAT').map(([customer]) => customer)));

function repeatIntent(value) {
  const text = normalize(value);
  if (/\b(?:don't|do not|stop|needn't) (?:keep )?(?:repeat|repeating|say|saying|ask|asking)\b/.test(text)) return false;
  return repeatExamples.has(text) ||
    /^(?:sorry )?(?:what(?: then)?|i (?:say|said) what|huh|pardon|excuse me|come again)$/.test(text) ||
    /\b(?:repeat (?:that|it|(?:the|your|that|last) question|what you (?:said|asked))|(?:say|ask) (?:that|it|me|the question) (?:again|(?:just )?one more time)|what did you (?:just )?(?:say|ask)|what was (?:the|your) (?:last )?question|what was that again)\b/.test(text) || /(?:^| )(?:can|could|would) you (?:please )?repeat(?: please)?$/.test(text) ||
    /\b(?:didn't|did not|couldn't|could not|can't|cannot) (?:quite |really )?(?:hear|catch|understand|make out) (?:that|it|you|what you (?:said|asked)|(?:the|your) question)(?:$| (?:clearly|properly|very well|at all|say|please)\b)/.test(text) ||
    /\b(?:you're|you are|the line is|the audio is) (?:breaking up|cutting (?:in and )?out)\b|\b(?:can|could|would) you (?:please )?(?:speak|talk) (?:a (?:bit|little) )?(?:more clearly|louder|slower|more slowly)\b/.test(text);
}

function scopeOf(question = "") {
  if (/\b(?:rebate|money back|refund)\b/i.test(question)) return 'rebate';
  if (/\bbetween\s+60\s+and\s+80\b/i.test(question)) return 'age';
  if (/\b(?:part a|part b|medicaid)\b/i.test(question)) return 'coverage';
}

function suppressionRequested(text) {
  if (/\b(?:he|she|they|someone) (?:said|asked|told)\b/.test(text)) return false;
  return /\b(?:stop (?:calling|contacting)|(?:don't|do not|never) (?:call|contact)(?: me| us| this number| again)|(?:remove|delete) (?:my number|this number)|(?:remove|take) (?:me|my number|this number) (?:from|off) (?:your|the) (?:list|records))\b/.test(text) ||
    /^(?:please )?remove me(?: please)?$/.test(text);
}

function customerChecking(value) {
  const text = normalize(value);
  return !repeatIntent(value) && /\b(?:let me (?:check|look|see|find|grab|get)|(?:i'll|i will) (?:check|look))\b/.test(text);
}

function scenarioDecision(question, value) {
  const scope = scopeOf(question);
  const text = normalize(value);
  const exact = examples[scope]?.get(text);
  if (suppressionRequested(text)) return {action:'DNC'};
  if (/\b(?:not interested|wrong number|no thanks|no thank you|(?:don't|do not) want to (?:continue|answer|talk))\b/.test(text)) return {action:'END'};
  const leadingAnswer = String(value).match(/^(.+?)[,;.!]\s*(?=(?:can|could|would|will) you\b|(?:please )?(?:check|look up|verify)\b)/i)?.[1];
  const answer = leadingAnswer && /^(?:i think so|i believe so|maybe|(?:i(?:'m| am) )?not sure|i don't know|yes\b.*|no\b.*|yeah\b.*|nope\b.*|i (?:get|have)\b.*)$/i.test(leadingAnswer.trim())
    ? leadingAnswer.trim() : undefined;
  const replay = repeatIntent(value);
  if (customerChecking(value) || !replay && /\b(?:(?:hold|hang) on|give me (?:a|one) (?:second|moment|minute))\b/.test(text))
    return {action:'WAIT'};
  if (/(?:^| )(?:(?:actually|please|just) )*put me through to (?:someone|somebody|a person|an agent)(?: |$)/.test(text))
    return {action:'TRANSFER',direct:true};
  if (/\b(?:(?:can|could|would|will) you (?:please )?(?:check|look (?:it )?up|verify|find out|see if|pull up)|(?:please )?(?:check|look up|verify) my (?:account|statement|balance|coverage|plan|age|rebate|card))\b/.test(text) && scope)
    return {action:'TRANSFER',answer,assistance:true};
  if (/\b(?:call|ring|phone) (?:me )?back\b|\b(?:call|ring) me (?:later|tomorrow)\b|\bi(?:'m| am) (?:busy|driving)\b/.test(text))
    return {action:'CALLBACK'};
  if (scope === 'age') {
    const age = normalize(answer || text).match(/^(?:(?:yes|no) )?(?:i'm |i am )?(?:exactly )?(\d{1,3})(?: years old)?$/)?.[1];
    if (age && +age > 0 && +age <= 125) return {action:+age < 60 || +age > 80 ? 'END' : 'NEXT',answer};
    if (/^(?:no|nope|nah)(?: i(?:'m| am) (?:older|younger)(?: than that)?)?$/.test(text)) return {action:'END'};
  }
  if (scope === 'coverage' && /^(?:no|nope|nah)(?: i (?:don't|do not)(?: have (?:it|any coverage|medicare|medicaid))?)?$/.test(text))
    return {action:'END'};
  if (replay) return {action:'REPEAT'};
  if (exact === 'TRANSFER' && (scope !== 'coverage' || /\b(?:check|look|talk|need help)\b/.test(text)))
    return {action:exact,answer,assistance:true};
  if (exact) return {action:exact};
}

function scenarioAnnouncement(script, reason) {
  const { requestedTransferAnnouncement } = require('./handoff-intent.cjs');
  const configured = requestedTransferAnnouncement(script);
  if (reason === 'assistance' && /\blicensed (?:agent|specialist|representative)\b/i.test(configured))
    return "A licensed agent can help you review that and discuss your options. Let me connect you now.";
  return configured;
}

module.exports = { customerChecking, repeatIntent, scenarioDecision, scenarioAnnouncement };
