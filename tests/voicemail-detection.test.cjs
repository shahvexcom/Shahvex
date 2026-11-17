const {test}=require('node:test'),assert=require('node:assert/strict');
const {isVoicemailGreeting}=require('../gateway/voicemail-detection.cjs');
test('recognizes machine greetings including the reported transcript',()=>{
 for(const text of ['All has been forwarded to an automatic voice message system. 12282279143 is not available.','Your call has been forwarded to an automated voice messaging system.','Please leave your message after the tone.','At the beep, record your message.','The subscriber is unavailable. Please leave a message.',"You've reached the voicemail of Sarah.",'Welcome to voicemail.','The mailbox is full.','Please record your message at the beep.',"You've reached Sarah. Leave me a message.","I cannot take your call. Please leave a message."])assert.equal(isVoicemailGreeting(text),true,text);
});
test('ordinary unavailability, questions and reported voicemail are not automatic hangups',()=>{
 for(const text of ["I'm not available.",'I left a message after the beep.','Can you leave a message after the tone?','Why was my call forwarded to an automatic voice message system?','Your voicemail says please leave your message after the tone.','I have voicemail.','Hello, who are you?', 'I want to leave a message after the beep.', 'How do I record my message at the beep?', 'What happens when the mailbox is full?', 'My voicemail is full.'])assert.equal(isVoicemailGreeting(text),false,text);
});
