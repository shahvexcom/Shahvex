const {test}=require('node:test'),assert=require('node:assert/strict');
const {isVoicemailGreeting}=require('../gateway/voicemail-detection.cjs');
test('recognizes machine greetings including the reported transcript',()=>{
 for(const text of ['All has been forwarded to an automatic voice message system. 12282279143 is not available.','Your call has been forwarded to an automated voice messaging system.','Please leave your message after the tone.','At the beep, record your message.','The subscriber is unavailable. Please leave a message.',"You've reached the voicemail of Sarah.",'Welcome to voicemail.','The mailbox is full.','Please record your message at the beep.',"You've reached Sarah. Leave me a message.","I cannot take your call. Please leave a message."])assert.equal(isVoicemailGreeting(text),true,text);
});
test('ordinary unavailability, questions and reported voicemail are not automatic hangups',()=>{
 for(const text of ["I'm not available.",'I left a message after the beep.','Can you leave a message after the tone?','Why was my call forwarded to an automatic voice message system?','Your voicemail says please leave your message after the tone.','I have voicemail.','Hello, who are you?', 'I want to leave a message after the beep.', 'How do I record my message at the beep?', 'What happens when the mailbox is full?', 'My voicemail is full.'])assert.equal(isVoicemailGreeting(text),false,text);
});
test('REC-000156 screening, unavailable and tone prompts are machine greetings, not customer replies',()=>{
 for(const text of ["if you record your name and reason for calling. I'll see if this person is available.","Record your name and reason for calling.","Please record your name and the reason for your call.","Please record your name after the tone.","Say your name. I'll see if this person is available.","I'm sorry this person is not available. If you would like to leave an additional message.","Please reply after the tone.","Please record after the beep.","This call is being screened. Please say your name."])assert.equal(isVoicemailGreeting(text),true,text);
});
test('human questions, quoted screening prompts and ordinary hold requests remain live',()=>{
 for(const text of ["Thanks. Please stay on the line.","Please stay on the line.","Please tell me your name and reason for calling.","What is your name and reason for calling?","I said record your name and reason for calling.","My voicemail says please reply after the tone.","Can you record your name and reason for calling?","I would like to leave an additional message.","This person is not available.","Please repeat your last question."])assert.equal(isVoicemailGreeting(text),false,text);
});
test('REC-167, REC-170 and REC-176 exact carrier and connection challenge prompts stop silently',()=>{
 for(const text of ['Your call has been forwarded to voicemail.','has been forwarded the voicemail.','Our network security provider indicates that your call may be a robocall, spam, or scam, and has been blocked in order to protect the end user.','Your call has been blocked in order to protect the end user.','Please press 1 to connect your call.','To complete your call, please press one.'])assert.equal(isVoicemailGreeting(text),true,text);
 assert.equal(isVoicemailGreeting('To connect your call.', ['Thank you for calling.','One.']),true);
 for(const text of ['Thank you for calling.','One.','To connect your call.','Can you press 1 to connect your call?','I heard your call has been forwarded to voicemail.','Your voicemail says please press 1 to connect your call.','Are you a robocall or spam?','My phone blocked your call yesterday.','I was forwarded to voicemail.'])assert.equal(isVoicemailGreeting(text),false,text);
});
test('recognizes observed carrier and split mailbox announcements',()=>{
 const {isVoicemailGreeting}=require('../gateway/voicemail-detection.cjs');
 assert.equal(isVoicemailGreeting('Welcome to Verizon Wireless.'),true);
 assert.equal(isVoicemailGreeting("The person you are trying to reach has a voicemail box that has not been set up yet."),true);
 assert.equal(isVoicemailGreeting('re-record or add to your message, press 1.'),true);
 assert.equal(isVoicemailGreeting('Please hang up and try again later.'),true);
 assert.equal(isVoicemailGreeting('We are currently unable to authenticate your phone.'),true);
 assert.equal(isVoicemailGreeting('Press one. To be connected with the agent.',['Thanks for calling homes dot com.']),true);
 assert.equal(isVoicemailGreeting('and has been blocked in order to protect the end user.',['Our network security provider indicates that your call']),true);
 assert.equal(isVoicemailGreeting('is full and will not receive',['Your call has been forwarded to an automatic voice.','Sorry, the mailbox belonging to','Yvonne.']),true);
 assert.equal(isVoicemailGreeting('Can you press one to speak to an agent?'),false);
});
