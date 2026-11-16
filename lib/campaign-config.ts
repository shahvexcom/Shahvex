import { z } from "zod";
export const campaignSettings=z.object({
 companyName:z.string().max(100).default(''),goal:z.string().max(4000).default(''),task:z.string().max(4000).default(''),
 instructions:z.string().max(12000).default(''),knowledge:z.string().max(12000).default(''),behavior:z.string().max(6000).default(''),
 qualificationQuestions:z.array(z.string().max(1000)).max(40).default([]),requiredLeadFields:z.array(z.string().min(1).max(60)).max(30).default([]),
 transferConditions:z.string().max(4000).default(''),refusalHandling:z.string().max(4000).default(''),endBehavior:z.string().max(4000).default(''),
 disclosure:z.string().max(1000).default(''),recordingNotice:z.string().max(1000).default(''),
 leadFieldMap:z.record(z.string().max(60),z.string().regex(/^[a-zA-Z][\w]{0,63}$/)).default({}),
 commentLimit:z.number().int().min(80).max(65535).default(255),
 speed:z.literal(1).default(1),pitch:z.literal(0).default(0), // Installed TTS does not advertise these controls.
}).strict();
export type CampaignSettings=z.infer<typeof campaignSettings>;
export function campaignInstructionText(c:CampaignSettings) {
 return [c.companyName?`Configured company name: ${c.companyName}`:'',c.instructions,c.behavior,
 c.qualificationQuestions.length?`Qualification questions: ${c.qualificationQuestions.join('\n')}`:'',
 c.requiredLeadFields.length?`Required lead fields: ${c.requiredLeadFields.join(', ')}`:'',
 c.transferConditions,c.refusalHandling,c.endBehavior,c.disclosure?`Required truthful AI disclosure: ${c.disclosure}`:'',
 c.recordingNotice?`Required recording notice/consent: ${c.recordingNotice}`:''].filter(Boolean).join('\n');
}
export function parseVicidialTable(body:string) {
 if(/^\s*(?:ERROR:|<!|<html)/i.test(body))throw Error('Dialer rejected the operation; verify API version and permissions');
 const lines=body.replace(/^\uFEFF/,'').replace(/(?:\r?\n)+$/,'').split(/\r?\n/);if(!lines[0])throw Error('Empty dialer response');
 const heads=lines.shift()!.split('|').map(v=>v.trim());
 if(new Set(heads).size!==heads.length||heads.some(h=>!h))throw Error('Unsupported Native table header');
 return lines.filter(Boolean).map(line=>{const cells=line.split('|');if(cells.length!==heads.length)throw Error('Unsupported Native table encoding; engineer verification required');return Object.fromEntries(cells.map((v,i)=>[heads[i],v]));});
}
