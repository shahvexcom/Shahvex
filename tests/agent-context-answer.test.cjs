const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/agent-context-answer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);const answer=m.exports.contextualQuestionReply;
const config={script:'Hi, this is Lauren with Wellness Team.',instructions:'',knowledge:''};
test('time and location answer from clock and configured facts rather than repeating transfer waiting',async()=>{
 const now=Date.parse('2026-11-14T12:00:00Z');assert.match(await answer(config,'What time is it in Chicago?',[],{now}),/6:00 AM in Chicago/);
 assert.match(await answer(config,'What is the time right now where you are sitting? Are you calling from a laptop or cellphone?',[],{now}),/5:00 AM in Phoenix/);
 assert.match(await answer(config,'Where are you calling from?',[]),/Phoenix, Arizona, United States/);
 assert.match(await answer({...config,knowledge:'Office location: Denver, Colorado'},'Where are you calling from?',[]),/Denver, Colorado/);
 assert.equal(await answer(config,'Yes, I am seventy one.',[]),undefined);
});
test('weather asks for a city, uses only current primary-source forecast data and never fabricates a failed lookup',async()=>{
 assert.match(await answer(config,"How's the weather down there?",[],{fetchImpl:async()=>{throw Error("offline")}}),/live weather for Phoenix/);
 const now=Date.parse('2026-11-14T12:00:00Z');let requests=0;
 const fetchImpl=async url=>{requests++;assert.ok(String(url).startsWith('https://api.weather.gov/'));return Response.json(requests===1?{properties:{forecastHourly:'https://api.weather.gov/gridpoints/LOT/1,1/forecast/hourly'}}:{properties:{periods:[{startTime:'2026-11-14T11:00:00Z',endTime:'2026-11-14T13:00:00Z',temperature:45,temperatureUnit:'F',shortForecast:'Partly Cloudy'}]}})};
 assert.match(await answer(config,'Chicago',[{role:'assistant',content:'Which city would you like the weather for?'}],{now,fetchImpl}),/45 degrees Fahrenheit, partly cloudy/);assert.equal(requests,2);
 assert.match(await answer(config,'Weather in Seattle?',[],{now,fetchImpl:async()=>{throw Error('offline')}}),/couldn't retrieve/);
});

test('pending weather city clarification does not swallow expression or time requests',async()=>{
 const history=[{role:'assistant',content:'Which city would you like the weather for?'}];
 assert.equal(await answer(config,'Please laugh.',history),undefined);assert.equal(await answer(config,'Can you cry?',history),undefined);assert.match(await answer(config,'What time is it in Chicago?',history,{now:Date.parse('2026-11-14T12:00:00Z')}),/6:00 AM in Chicago/);
});


test('a yes after greeting asks the first assigned question instead of treating it as an answer',()=>{
 const question=m.exports.initialScriptQuestion,script='Hi there, this is Lauren. Are you currently getting any rebate?\nIf customer says no do you have coverage?';
 const history=[{role:'user',content:'Hello?'},{role:'assistant',content:'Hello, this is Ayesha.'}];
 assert.equal(question(script,'Yes.',history),'Are you currently getting any rebate?');
 assert.equal(question(script,'Who are you?',history),undefined);
 assert.equal(question(script,'Yes.',[{role:'assistant',content:'Are you currently getting any rebate?'}]),undefined);
 assert.equal(question(script,'Yes.',[...history,{role:'assistant',content:'Are you currently getting any rebate?'}]),undefined);
 assert.equal(question('', 'Yes.',history),undefined);
});

test('hold wording applies only to acknowledgments after a transfer offer',()=>{
 const ack=m.exports.transferAcknowledgment,offer=[{role:'assistant',content:'Let me connect you with a licensed specialist.'}];
 assert.equal(ack('Okay.',offer),'Please wait while I connect you to the licensed specialist.');
 assert.equal(ack('Okay.',[{role:'assistant',content:'Are you getting a rebate?'}]),undefined);
 assert.equal(ack('What information will they need?',offer),undefined);
 assert.equal(ack("Don't transfer me.",offer),undefined);
 assert.equal(ack('Okay.',[...offer,{role:'assistant',content:'I cannot connect you.'}]),undefined);
});

test('Phoenix is the confirmed office, with local Arizona time and grounded weather',async()=>{
 const now=Date.parse('2026-11-14T12:00:00Z');
 assert.match(await answer(config,'What is your address?',[]),/Phoenix, Arizona, United States of America/);
 assert.match(await answer(config,'What time is it in your state Arizona?',[],{now}),/5:00 AM in Phoenix/);
 const urls=[];
 const fetchImpl=async url=>{urls.push(String(url));return Response.json(urls.length===1?{properties:{forecastHourly:'https://api.weather.gov/gridpoints/PSR/1,1/forecast/hourly'}}:{properties:{periods:[{startTime:'2026-11-14T11:00:00Z',endTime:'2026-11-14T13:00:00Z',temperature:70,temperatureUnit:'F',shortForecast:'Sunny'}]}})};
 assert.match(await answer(config,'How is the weather over there in Arizona?',[],{now,fetchImpl}),/Phoenix.*70 degrees Fahrenheit, sunny/);
 assert.match(urls[0],/33.4484,-112.074/);
});
test('wellbeing and smoking questions receive answers, without fabricating human experiences',async()=>{
 assert.match(await answer(config,'How are you doing?',[]),/doing well/);
 assert.match(await answer(config,'How was your day?',[]),/thank you/);
 assert.match(await answer(config,'Are you a smoker?',[]),/AI assistant.*lungs and heart/);
});
test('flexible introduction uses the script identity and company; mandatory openings are preserved',()=>{
 const opening=m.exports.briefAgentOpening;
 assert.equal(opening({name:'Database Name',script:'Hello, this is Alex from Wellness Team. Ask about coverage.',instructions:''}), 'Hello, this is Alex from Wellness Team. How are you today?');
 assert.equal(opening({name:'Alex',script:'Read exactly: required disclosure.',instructions:''}),undefined);
 assert.match(opening({name:'Alex',script:'Introduce yourself.',instructions:''}),/this is Alex\. How are you/);
});
test('address response excludes adjacent timezone metadata',async()=>{
 const result=await answer({...config,knowledge:'Office location: Phoenix, Arizona, United States of America. Timezone: America/Phoenix.'},'What is your address?',[]);
 assert.equal(result,'Our listed office location is Phoenix, Arizona, United States of America.');
});

test('identity, wellbeing, address and political detours answer only the requested topics',async()=>{
 const cfg={...config,name:'Database Name',script:'Hello, this is Laura from Senior Benefits Department.'};
 const identity=await answer(cfg,'Who you are?',[]);assert.equal(identity,"I'm Laura from Senior Benefits Department. How are you today?");assert.doesNotMatch(identity,/Phoenix|assist|help you today/);
 assert.equal(await answer(cfg,'What is your name?',[]),"I'm Laura.");
 assert.match(await answer(cfg,'What about you?',[]),/doing well/);
 const combined=await answer(cfg,'What about you and where you live?',[]);assert.match(combined,/Laura.*Senior Benefits.*Phoenix/);
 const address=await answer(cfg,'Where are you?',[]);assert.match(address,/Phoenix/);assert.doesNotMatch(address,/Laura/);
 const political=await answer(cfg,'Who should win the election?',[]);assert.match(political,/serves people's needs/);assert.doesNotMatch(political,/will win|cannot answer/i);
});
