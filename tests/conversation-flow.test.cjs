const {test}=require('node:test'),assert=require('node:assert/strict');
const {interruptionKind,mainQuestions,acknowledgmentReply}=require('../gateway/conversation-flow.cjs');
const A=content=>({role:'assistant',content}),U=content=>({role:'user',content});
const script='Hello, this is Laura from Senior Benefits. How are you today? May I ask a few questions?\nMay I know your exact age?\nDo you have existing coverage?\nWhich state do you live in?';
test('filler and backchannels are distinguished from greetings, questions and refusals',()=>{
 for(const text of ['um','uh huh','hmm','mm-hmm'])assert.equal(interruptionKind(text),'filler');
 for(const text of ['yeah','yep','okay','yeah, yep.','um, yeah.'])assert.equal(interruptionKind(text),'acknowledgment');
 for(const text of ['Hello?','Who you are?','Why are you calling me?','No, stop.','Yeah, where do you live?'])assert.equal(interruptionKind(text),'interrupt');
});
test('permission acknowledgment asks the first real question in the same reply without a repeated pitch',()=>{
 const questions=mainQuestions(script);assert.deepEqual(questions,['May I know your exact age?','Do you have existing coverage?','Which state do you live in?']);
 const reply=acknowledgmentReply({script,goal:'Review current coverage'},'Okay',[A('Hello, this is Laura. May I ask you a few questions?')],{completed:[]});
 assert.match(reply,/calling to review current coverage.*May I know your exact age/);assert.ok(reply.split(/[.!?]/).filter(Boolean).length<=3);
});
test('an unanswered question is deferred until every main question has been attempted, then reviewed only once',()=>{
 const cfg={script};let history=[A('Hello, this is Laura. May I ask you a few questions?'),U('Okay'),A('May I know your exact age?')];
 let reply=acknowledgmentReply(cfg,'Okay',history,{completed:[]});assert.equal(reply,'Thank you. Do you have existing coverage?');history.push(U('Okay'),A(reply));
 assert.equal(acknowledgmentReply(cfg,'Hello',history,{completed:[]}),undefined);reply=acknowledgmentReply(cfg,'Okay',history,{completed:[]});assert.equal(reply,'Thank you. Which state do you live in?');history.push(U('Okay'),A(reply));
 reply=acknowledgmentReply(cfg,'Okay',history,{completed:[]});assert.equal(reply,'Before we finish, may I know your exact age?');history.push(U('Okay'),A(reply));
 assert.ok(!acknowledgmentReply(cfg,'Okay',history,{completed:[]}).includes('exact age'));
});
test('conditional branch selection stays with the model after the first question',()=>{
 const branched=script+'\nIf yes ask another question.';
 assert.equal(acknowledgmentReply({script:branched},'Yes',[A('Do you have existing coverage?')],{completed:[]}),undefined);
});

test('okay after an answer to a side question resumes the pending question in a branched script',()=>{
 const {rememberQuestions}=require('../gateway/question-memory.cjs');
 const history=[A('Do you have existing coverage?'),U('Why are you calling me?'),A('I am calling to review your service appointment.')];
 const memory=rememberQuestions([...history,U('Okay.')]);
 const branched=script+'\nIf yes, ask about the policy.';
 assert.equal(acknowledgmentReply({script:branched},'Okay.',history,memory),'Do you have existing coverage?');
});

test('wait and pause requests are never fillers or acknowledgments',()=>{const {interruptionKind,asksToWait}=require('../gateway/conversation-flow.cjs');for(const text of ['Wait a second.','Wait one second please.','Hold on.','Just a second.','Give me a moment.','One second please.']){assert.equal(interruptionKind(text),'interrupt');assert.equal(asksToWait(text),true,text);}assert.equal(asksToWait('Yeah'),false);assert.equal(asksToWait('I am 65.'),false);});

test('audio confirmation repeats the unheard step and never advances on hello',()=>{
 const {audioCheckReply,openingCourtesyReply}=require('../gateway/conversation-flow.cjs');
 const history=[A('Which state do you live in?')];
 assert.equal(audioCheckReply('Hello?',history),'Can you hear me clearly?');
 history.push(U('Hello?'),A('Can you hear me clearly?'));
 assert.equal(audioCheckReply('Yes',history),'Which state do you live in?');
 assert.equal(openingCourtesyReply("I'm fine.",[A('Hello, this is Alex. How are you today?')],{script:"I'm calling to discuss your service appointment."}),"I'm calling to discuss your service appointment. Is now a good time for a brief call?");
});

test('intro replies explain the script purpose before permission without assuming screening consent',()=>{
 const {openingCourtesyReply,scriptPurpose,audioCheckReply}=require('../gateway/conversation-flow.cjs');
 const h=[A('Hello, this is Sofia from Shahvex. How are you today?')],cfg={script:"I'm calling about your service appointment.\nWhich day works for you?"};
 for(const text of ['Hello',"I am good",'Hello, I am good and how are you today?','How about you?']){
  const reply=openingCourtesyReply(text,h,cfg);assert.match(reply,/calling about your service appointment\. Is now a good time for a brief call\?/);
  assert.doesNotMatch(reply,/Which day|How is your day/);
 }
 assert.match(openingCourtesyReply('How are you today?',h,cfg),/^I'm doing well/);
 assert.equal(acknowledgmentReply(cfg,'Yes',h,{completed:[]}),undefined);
 assert.equal(audioCheckReply('Hello',h),undefined);
 assert.equal(openingCourtesyReply('What is AI?',h,cfg),undefined);
 assert.equal(openingCourtesyReply("I'm busy",h,cfg),undefined);
 assert.equal(scriptPurpose({script:'Introduce yourself and qualify the lead.',goal:'Collect age and address'}),undefined);
 assert.equal(scriptPurpose({...cfg,instructions:'Read exactly the mandatory disclosure.'}),undefined);
});

test('audio complaints interrupt progression and recovery does not replay the introduction',()=>{
 const {audioCheckReply}=require('../gateway/conversation-flow.cjs');
 const h=[{role:'assistant',content:"I'm Lauren. I'm calling about your review."}];
 for(const text of ['Why your voice is breaking?','I said why your voice is breaking.','Your audio is cutting out.',"I can't hear you.","You're breaking up."]){
  assert.equal(audioCheckReply(text,h),'The audio may be cutting out. Is my voice clear now?');
 }
 h.push({role:'assistant',content:audioCheckReply('Your voice is breaking',h)});
 assert.doesNotMatch(audioCheckReply('Yes',h),/Lauren|calling about/);
 assert.match(audioCheckReply('Your voice is breaking',h),/still unclear/);
 assert.equal(audioCheckReply('My voice is breaking',h),undefined);
});
test('clear audio resumes only the pending question',()=>{
 const {audioCheckReply}=require('../gateway/conversation-flow.cjs');
 const h=[{role:'assistant',content:"I'm Lauren. Which state do you live in?"},{role:'assistant',content:'The audio may be cutting out. Is my voice clear now?'}];
 assert.equal(audioCheckReply('Yes',h),'Thank you. Which state do you live in?');
});

test('audio-check recovery never replays the greeting or wellbeing question',()=>{
 const {audioCheckReply}=require('../gateway/conversation-flow.cjs');
 assert.equal(audioCheckReply('Yes',[A('Hello, this is Lauren. How are you today?'),A('Can you hear me clearly?')]),"Yes, I'm here.");
});

test('presence variants and punctuated audio confirmations do not need a model or restart the pitch',()=>{
 const {isPresenceCheck,audioCheckReply}=require('../gateway/conversation-flow.cjs');
 for(const text of ['Anyone there?','Is anybody there?','Hello?'])assert.equal(isPresenceCheck(text),true,text);
 assert.equal(isPresenceCheck('Hello, why are you calling me?'),false);
 const h=[A('Which state do you live in?'),A('Can you hear me clearly?')];
 assert.equal(audioCheckReply('Anyone there?',h),"I'm here and listening.");
 for(const text of ['Yes, I can hear you.','Yeah, I can.','I can hear.','Yeah, you can.'])assert.equal(audioCheckReply(text,h),'Which state do you live in?',text);
 assert.equal(audioCheckReply('Yes I can hear you. Why are you calling?',h),undefined);
});
