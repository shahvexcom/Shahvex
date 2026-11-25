'use strict';

// High-confidence direct conduct only. Product complaints and reported incidents
// must not become automatic hangups. Less explicit cases remain model-handled.
function normalize(text) {
  return String(text || '').normalize('NFKC').replace(/[’]/g, "'").trim().slice(0, 16000);
}
function isDirectedAbuse(customer) {
  const text = normalize(customer);
  // Require a direct address at the start of the utterance. A quote or report
  // can otherwise contain the same words as a direct insult.
  if (/["“”‘]|(?:^|\s)'[^']+'(?:[.!?]|\s|$)|\b(?:said|says|called|quoted|told|heard|reporting|means)\b/i.test(text)) return false;
  const slur = "(?:bitch(?:es)?|assholes?|motherfuckers?|dickheads?|douchebags?|bastards?|whore|slut|cunt|jackass|dumbass)";
  const insult = "(?:(?:fucking|little) )?(?:" + slur + "|idiot|moron|piece of shit)";
  const directed = new RegExp("(?:^|[,.!?]\\s*)\\s*(?:(?:oh|hey|well|no|okay)[, ]+)*(?:fuck(?:ing)? (?:you|off)|go fuck yourself|shut the fuck up|you(?:'re| are)?[, ]+(?:a |an )?" + insult +
    "|chup (?:kar|kr) (?:sali|saali))\\b", "i");
  const standalone = new RegExp("^(?:(?:oh|hey|well)[, ]+)*(?:fucking )?" + slur + "[.!? ,]*$", "i");
  const vocative = new RegExp(",\\s*(?:you )?(?:fucking )?" + slur + "[.!? ]*$", "i");
  return directed.test(text) || standalone.test(text) || vocative.test(text);
}
function isHarassment(customer) {
  const text = normalize(customer);
  if (/\b(?:he|she|they|someone|customer|caller)\s+(?:said|says|called|asked|told)\b|\b(?:reporting|harassed me|abused me)\b/i.test(text)) return false;
  return /\b(?:(?:show|send) me (?:your )?(?:boobs|tits|nudes)|(?:have sex|sleep) with me|(?:talk dirty|moan) (?:to|for) me|what are you wearing|you sound sexy|are you naked|apn[ei] (?:boobs|tits) dikhao|mere sath sex|sexy awaz)\b/i.test(text);
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
function confirmsHangup(text) {
  if (/\b(?:don't|do not|never) (?:hang[ -]?up|end|disconnect|cut)\b/i.test(text)) return false;
  const reply = text.replace(/[,!.?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:yes|yeah|yep|yup|sure|absolutely)(?: please| go ahead)?|please stop|(?:no|nope|nah) (?:please )?(?:just )?stop)$/i.test(reply) ||
    /^(?:(?:okay|ok|alright|well|thanks|thank you|no thanks|bye)[ ]+)*(?:good[ -]?bye|bye(?: bye)?|see you(?: later)?|take care|have a (?:good|nice) day|i(?:'m| am) (?:leaving|hanging up)|i(?:'ve| have) got to go|i (?:need|have) to go|gotta go|allah hafiz|khuda hafiz)(?: (?:now|then|thanks|thank you|bye|goodbye))*$/i.test(reply) ||
    /^(?:(?:yes|yeah|ok|okay|no|please|just) )*(?:(?:end|cut|disconnect|close) (?:the |this |my )?(?:phone )?call|hang[ -]?up|hang it up|end it|(?:call )?band (?:kar(?:o| do| dein)|krdo)|(?:end call|hang[ -]?up) (?:karo|kar do|krdo))(?: (?:now|please|karo|kro|kar do|krdo))*$/i.test(reply);
}
function declinesHangup(text) {
  return /^(?:no|nope|nah)(?:[, ]+(?:thanks|thank you))?[.!? ]*$|\b(?:don't|do not) (?:hang[ -]?up|end the call)\b/i.test(normalize(text));
}
/**
 * @param {string} customer
 * @param {boolean} warned
 * @returns {{kind:'offer',text:string}|{kind:'warn',text:string}|{kind:'end',reason:'abusive_language'|'harassment'|'customer_request',text:string,immediate?:boolean}|null}
 */
function conductDecision(customer, warned = false, endOfferMade, awaitingEndDecision = endOfferMade) {
  const text = normalize(customer);
  if (isDirectedAbuse(text)) return {kind:"end", reason:"abusive_language", text:"", immediate:true};
  const stopNow = /\b(?:stop calling|don't call|do not call|remove (?:me|my number)|leave me alone|stop immediately)\b/i.test(text);
  if (awaitingEndDecision && declinesHangup(text)) return null;
  if (awaitingEndDecision && (explicitlyEndsCall(text) || confirmsHangup(text))) {
    return { kind: 'end', reason: 'customer_request', text: '', immediate: true };
  }
  if (endOfferMade !== undefined && explicitlyEndsCall(text) && !stopNow) {
    return { kind: 'offer', text: "Just to confirm, would you like me to end the call now?" };
  }
  if (explicitlyEndsCall(customer)) return { kind: 'end', reason: 'customer_request', text: "Understood. I'll end the call. Goodbye." };
  if (!isHarassment(customer)) return null;
  return warned
    ? { kind: 'end', reason: 'harassment', text: "The comments have continued, so I'm ending the call now. Goodbye." }
    : { kind: 'warn', text: "I'm here to help with your enquiry. Please keep the conversation respectful." };
}
module.exports = { isDirectedAbuse, isHarassment, explicitlyEndsCall, conductDecision, declinesHangup };

