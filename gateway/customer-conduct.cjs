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
  if (/\b(?:don't|do not|never)\s+(?:hang up|end (?:the|this) call|stop calling)\b/i.test(text)) return false;
  return /^(?:stop|no thanks|no thank you|(?:i(?:'m| am) )?not interested)[.! ]*$/i.test(text) || /\b(?:stop calling(?: me)?|don't call(?: me)?(?: again)?|do not call(?: me)?(?: again)?|remove (?:me|my number)|leave me alone|end (?:the|this) call|hang up(?: now)?|call band (?:karo|kar do|krdo))\b/i.test(text);
}
/**
 * @param {string} customer
 * @param {boolean} warned
 * @returns {{kind:'warn',text:string}|{kind:'end',reason:'harassment'|'customer_request',text:string}|null}
 */
function conductDecision(customer, warned = false) {
  if (explicitlyEndsCall(customer)) return { kind: 'end', reason: 'customer_request', text: "Understood. I'll end the call. Goodbye." };
  if (!isHarassment(customer)) return null;
  return warned
    ? { kind: 'end', reason: 'harassment', text: "The comments have continued, so I'm ending the call now. Goodbye." }
    : { kind: 'warn', text: "I'm here to help with your enquiry. Please keep the conversation respectful." };
}
module.exports = { isHarassment, explicitlyEndsCall, conductDecision };
