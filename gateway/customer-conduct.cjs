'use strict';

// High-confidence direct conduct only. Product complaints and reported incidents
// must not become automatic hangups. Less explicit cases remain model-handled.
function normalize(text) {
  return String(text || '').normalize('NFKC').replace(/[’]/g, "'").trim().slice(0, 16000);
}
function isHarassment(customer) {
  const text = normalize(customer);
  if (/\b(?:he|she|they|someone|customer|caller)\s+(?:said|says|called|asked|told)\b|\b(?:reporting|harassed me|abused me)\b/i.test(text)) return false;
  return /\b(?:fuck you|fuck off|shut (?:the fuck )?up|you(?:'re| are)? (?:a |an )?(?:bitch|whore|slut|fucking idiot)|(?:show|send) me (?:your )?(?:boobs|tits|nudes)|(?:have sex|sleep) with me|(?:talk dirty|moan) (?:to|for) me|what are you wearing|you sound sexy|are you naked)\b/i.test(text)
    || /\b(?:chup (?:kar|kr) (?:sali|saali)|apn[ei] (?:boobs|tits) dikhao|mere sath sex|sexy awaz)\b/i.test(text);
}
function explicitlyEndsCall(customer) {
  const text = normalize(customer);
  if (/\b(?:he|she|they|someone) (?:said|asked|told)\b/i.test(text)) return false;
  if (/\b(?:don't|do not|never)\s+(?:hang up|end (?:the|this) call|stop calling)\b/i.test(text)) return false;
  if(/^(?:(?:please|can you|could you|would you|will you)\s+)?(?:hang[ -]?(?:up|out)|end|cut|disconnect|terminate)(?: (?:the|this|my|your))?(?: (?:phone )?call)?(?: for me)?(?: right now| now)?(?: please)?[.!? ]*$/i.test(text))return true;
  const command = /^(?:(?:please|can you|could you)\s+)?(?:hang[ -]?(?:up|out)(?: (?:the|this|my) call+)?|end (?:the|this|my) call+)(?: now)?[.!? ]*$/i;
  if (command.test(text) || /^(?:(?:please|can you|could you|would you)\s+)?(?:end|cut|disconnect|terminate) (?:the |this |my )?call(?: now)?(?: please)?[.!? ]*$/i.test(text) || /^(?:hang[ -]?(?:up|out)(?: (?:the |this |my )?call)?(?: now)?(?: please)?|that['’]?s all|that is all|we['’]?re done|we are done)[.!? ]*$/i.test(text)) return true;
  return /^(?:stop|no thanks|no thank you|(?:i(?:'m| am) )?not interested)[.! ]*$/i.test(text)
    || /\b(?:stop calling(?: me)?|don't call(?: me)?(?: again)?|do not call(?: me)?(?: again)?|remove (?:me|my number)|leave me alone|end (?:the|this) call|hang[ -]?up(?: now)?|disconnect (?:me|this call)|end this conversation|call band (?:karo|kar do|krdo))\b/i.test(text);
}
/**
 * @param {string} customer
 * @param {boolean} warned
 * @returns {{kind:'offer',text:string}|{kind:'warn',text:string}|{kind:'end',reason:'harassment'|'customer_request',text:string,immediate?:boolean}|null}
 */
function conductDecision(customer, warned = false, endOfferMade, awaitingEndDecision = endOfferMade) {
  const text = normalize(customer);
  const stopNow = /\b(?:stop calling|don't call|do not call|remove (?:me|my number)|leave me alone|stop immediately)\b/i.test(text);
  if (endOfferMade === false && explicitlyEndsCall(text) && !stopNow) {
    return { kind: 'offer', text: "Would you be willing to give me two minutes to explain? We can continue if it makes sense for you, or I can end the call." };
  }
  if (endOfferMade === true && (explicitlyEndsCall(text) || awaitingEndDecision && /^(?:no|nope|nah|no thanks|stop|please stop)[.! ]*$/i.test(text))) {
    return { kind: 'end', reason: 'customer_request', text: '', immediate: true };
  }
  if (explicitlyEndsCall(customer)) return { kind: 'end', reason: 'customer_request', text: "Understood. I'll end the call. Goodbye." };
  if (!isHarassment(customer)) return null;
  return warned
    ? { kind: 'end', reason: 'harassment', text: "The comments have continued, so I'm ending the call now. Goodbye." }
    : { kind: 'warn', text: "I'm here to help with your enquiry. Please keep the conversation respectful." };
}
module.exports = { isHarassment, explicitlyEndsCall, conductDecision };

