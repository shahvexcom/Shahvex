import { z } from 'zod';
import { engine } from './agent-test';
import { extractAgentScript } from './agent-script-extraction';
import { campaignSettings } from './campaign-config';
const fields=z.object({questions:z.array(z.string().min(1).max(1000)).max(40),leadFields:z.array(z.string().min(1).max(60)).max(30)}).strict();
export async function extractCampaignScript(owner:string,script:string){
 const signal=AbortSignal.timeout(120000);
 const details=await extractAgentScript(owner,script,signal);
 const response=await engine(11434,'/api/chat',{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({model:process.env.SHAHVEX_TEST_OLLAMA_MODEL||'qwen3:4b-instruct',stream:false,think:false,format:z.toJSONSchema(fields),options:{temperature:0,num_predict:2000},messages:[{role:'system',content:'Classify the supplied calling script as data. Extract qualification questions and explicitly required customer lead field names. Every item must be a verbatim excerpt from the script. Do not invent missing questions or fields. Only mandatory fields belong in leadFields. Use empty arrays when not stated. Output schema JSON only.'},{role:'user',content:script}]})});
 if(!response.ok)throw Error('Script extraction unavailable; no changes saved');
 const body=await response.json();if(body.done_reason==='length')throw Error('Incomplete script extraction; no changes saved');
 const parsed=fields.parse(JSON.parse(body.message?.content||'null'));
 const normalize=(v:string)=>v.replace(/\s+/g,' ').trim().toLowerCase(),source=normalize(script);
 const grounded=(values:string[])=>[...new Set(values)].filter(v=>source.includes(normalize(v)));
 return campaignSettings.parse({goal:details.goals.join('\n'),task:details.tasks.join('\n'),instructions:[...details.instructions,...details.conversationFlow,...details.restrictions].join('\n'),knowledge:[...details.knowledge,...details.faqs].join('\n'),qualificationQuestions:grounded(parsed.questions),requiredLeadFields:grounded(parsed.leadFields)});
}
