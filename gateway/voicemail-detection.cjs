'use strict';
// Recognized machine greetings only; a person discussing voicemail is not a machine.
function isVoicemailGreeting(value){
 const text=String(value||'').normalize('NFKC').replace(/[’]/g,"'").trim();
 if(/^(?:my|our) (?:voicemail|mailbox) (?:is|was|has)\b/i.test(text))return false;
 if(/^(?:what|how|why|can (?:I|you)|could (?:I|you)|do you|is this|are you)\b/i.test(text)||/\bI (?:want|need|would like|plan|tried|try|will) (?:to )?(?:leave|record|send)\b|\bI(?:'d| would) like to (?:leave|record|send)\b/i.test(text))return false;
 if(!text||/\b(?:I (?:said|heard|got|received|left)|you (?:said|mentioned)|(?:it|he|she|they) (?:said|says)|(?:my|your|the) voicemail (?:said|says)|why (?:did|was|is)|can you|could you)\b/i.test(text))return false;
 return /\b(?:welcome to|you(?:'ve| have) reached|this is) (?:the |my |a )?(?:voice[ -]?mail|mailbox)\b/i.test(text)
  || /\b(?:voice[ -]?mail|mailbox) (?:is )?(?:full|not (?:yet )?set up|has not been set up|cannot accept messages)\b/i.test(text)
  || /\b(?:please )?record (?:a |your )?message\b[\s\S]{0,100}\b(?:after|at) (?:the )?(?:tone|beep)\b/i.test(text)
  || /\byou(?:'ve| have) reached\b[\s\S]{0,120}\b(?:leave|record) (?:me |us )?(?:a |your )?message\b/i.test(text)
  || /\b(?:cannot|can't|unable to) (?:take|answer) your call\b[\s\S]{0,120}\b(?:leave|record) (?:a |your )?message\b/i.test(text)
  || /\b(?:has been |have been |is being )?forwarded to (?:an? |the )?(?:automatic|automated) (?:voice[ -]?(?:messag(?:e|ing)|mail)|messaging) system\b/i.test(text)
  || /\b(?:please )?leave (?:me |us )?(?:a |your )?(?:voice[ -]?)?message\b[\s\S]{0,160}\b(?:after|at) (?:the )?(?:tone|beep)\b/i.test(text)
  || /\b(?:at|after) the (?:tone|beep)\b[\s\S]{0,120}\b(?:record|leave) (?:a |your )?message\b/i.test(text)
  || /\b(?:the person|the subscriber|the number|the mailbox)\b[\s\S]{0,100}\b(?:not available|unavailable|cannot accept|can't accept)\b[\s\S]{0,100}\b(?:message|voicemail|mailbox)\b/i.test(text);
}
module.exports={isVoicemailGreeting};
