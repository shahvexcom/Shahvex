'use strict';
// Recognized voicemail/call-screening prompts only; a person discussing them is not a machine.
function isVoicemailGreeting(value, recent=[]){
 const text=String(value||'').normalize('NFKC').replace(/[’]/g,"'").trim();
 if(/^(?:my|our) (?:voicemail|mailbox) (?:is|was|has)\b/i.test(text))return false;
 if(/^(?:what|how|why|can (?:I|you)|could (?:I|you)|do you|is this|are you)\b/i.test(text)||/\bI (?:want|need|would like|plan|tried|try|will) (?:to )?(?:leave|record|send)\b|\bI(?:'d| would) like to (?:leave|record|send)\b/i.test(text))return false;
 if(!text||/\b(?:I (?:said|heard|got|received|left)|you (?:said|mentioned)|(?:it|he|she|they) (?:said|says)|(?:my|your|the) voicemail (?:said|says)|why (?:did|was|is)|can you|could you)\b/i.test(text))return false;
 // Carrier announcements and connection challenges are machines too. Never
 // infer this from "thank you for calling", a number or unavailability alone.
 if(/(?:\b(?:your|this) call |^)(?:has been|is being|was) forwarded (?:to )?(?:a |the )?voice[ -]?mail\b/i.test(text)
  || /\b(?:your|this) call\b[\s\S]{0,160}\b(?:has been|is|was) blocked\b[\s\S]{0,100}\b(?:protect|security|spam|scam|robocall)\b/i.test(text)
  || /\b(?:network security provider|automated call protection)\b[\s\S]{0,180}\b(?:robocall|spam|scam|blocked)\b/i.test(text)
  || /\b(?:please )?press (?:one|1|a key|any key)\b[\s\S]{0,80}\b(?:connect|complete|accept) (?:your |the |this )?call\b/i.test(text)
  || /\b(?:to )?(?:connect|complete) (?:your |the |this )?call[, ]+(?:please )?press (?:one|1|a key|any key)\b/i.test(text))return true;
 // STT may split the connection challenge into "One" / "To connect your
 // call". Require the greeting, digit and connection clause in nearby turns.
 const context=[...recent.slice(-3).map(String),text].join(' ');
 // Carrier and mailbox recordings observed in live calls often arrive in
 // separate recognition fragments. Require distinctive recorded prompts.
 if(/^welcome to verizon wireless[.! ,]*$/i.test(text)
  || /\b(?:voicemail|voice mail) box\b[\s\S]{0,80}\b(?:not been set up|not set up|hasn't been set up)\b/i.test(context)
  || /\b(?:to )?(?:review|re-record|rerecord|add to|send|mark) (?:your |the )?message\b[\s\S]{0,100}\bpress\s+(?:\w+|\d+)\b/i.test(context)
  || /\b(?:please )?hang up and (?:try|dial)\b/i.test(text)
  || /\b(?:unable to authenticate your phone|announcement \w+ switch|your message has been sent)\b/i.test(text)
  || /\b(?:thanks|thank you) for calling\b[\s\S]{0,100}\bpress (?:one|1|a key|any key)\b[\s\S]{0,100}\b(?:connect|agent)\b/i.test(context)
  || /\bnetwork security provider\b[\s\S]{0,180}\b(?:blocked|protect|automated)\b/i.test(context)
  || /\b(?:forwarded to an? automatic voice|mailbox belonging to)\b[\s\S]{0,150}\b(?:full|not receive|unavailable)\b/i.test(context))return true;
 if(/^to connect your call[.! ]*$/i.test(text)&&/\bthank you for calling\b[\s\S]{0,100}\b(?:one|1)\b/i.test(context))return true;
 // A call-screening recorder is also a machine, not a customer answering a question.
 const screening = /\brecord (?:your |a )?name(?:[\s,]+and)? (?:the |your )?reason for (?:(?:the|your) )?call(?:ing)?\b/i.test(text)
  || /\b(?:record|say) (?:your )?name\b[\s\S]{0,100}\b(?:I(?:'ll| will)|we(?:'ll| will)) (?:see|check) if (?:this|the) person is available\b/i.test(text)
  || /\brecord (?:your )?name\b[\s\S]{0,100}\b(?:after|at) (?:the )?(?:tone|beep)\b/i.test(text)
  || /\b(?:this call|your call) (?:is being|has been) screened\b[\s\S]{0,100}\b(?:name|reason|record)\b/i.test(text);
 if(screening)return true;
 return /\b(?:welcome to|you(?:'ve| have) reached|this is) (?:the |my |a )?(?:voice[ -]?mail|mailbox)\b/i.test(text)
  || /\b(?:voice[ -]?mail|mailbox) (?:is )?(?:full|not (?:yet )?set up|has not been set up|cannot accept messages)\b/i.test(text)
  || /\b(?:please )?record (?:a |your )?message\b[\s\S]{0,100}\b(?:after|at) (?:the )?(?:tone|beep)\b/i.test(text)
  || /\byou(?:'ve| have) reached\b[\s\S]{0,120}\b(?:leave|record) (?:me |us )?(?:a |your )?message\b/i.test(text)
  || /\b(?:cannot|can't|unable to) (?:take|answer) your call\b[\s\S]{0,120}\b(?:leave|record) (?:a |your )?message\b/i.test(text)
  || /\b(?:has been |have been |is being )?forwarded to (?:an? |the )?(?:automatic|automated) (?:voice[ -]?(?:messag(?:e|ing)|mail)|messaging) system\b/i.test(text)
  || /\b(?:please )?leave (?:me |us )?(?:a |your )?(?:voice[ -]?)?message\b[\s\S]{0,160}\b(?:after|at) (?:the )?(?:tone|beep)\b/i.test(text)
  || /\b(?:at|after) the (?:tone|beep)\b[\s\S]{0,120}\b(?:record|leave) (?:a |your )?message\b/i.test(text)
  || /\bplease (?:record|reply|speak)(?: (?:your|a|an additional) (?:message|reply))? (?:after|at) (?:the )?(?:tone|beep)\b/i.test(text)
  || /\b(?:the|this) (?:person|subscriber|number|mailbox)\b[\s\S]{0,100}\b(?:not available|unavailable|cannot accept|can't accept)\b[\s\S]{0,100}\b(?:message|voicemail|mailbox)\b/i.test(text);
}
module.exports={isVoicemailGreeting};
