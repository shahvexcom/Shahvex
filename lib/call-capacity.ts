import 'server-only';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pcAiRequest } from './pc-ai-engine';
/** Capacity management always uses a server-configured, authenticated adapter. */
export async function callCapacityRequest(init:RequestInit={}){
 if(process.env.SHAHVEX_PC_AI_URL)return pcAiRequest('/internal/capacity',init);
 const text=await readFile(resolve(process.cwd(),'.data/pc-ai/.env.pc-ai'),'utf8');
 const values=new Map(text.split(/\r?\n/).flatMap(line=>{const match=/^(SHAHVEX_PC_AI_SECRET|SHAHVEX_PC_TESTER_PORT)=(.*)$/.exec(line);return match?[[match[1],match[2].trim().replace(/^(['"])(.*)\1$/,'$2')]]:[];}));
 const secret=values.get('SHAHVEX_PC_AI_SECRET'),port=Number(values.get('SHAHVEX_PC_TESTER_PORT')||8774);
 if(!secret||secret.length<32||!Number.isInteger(port)||port<1||port>65535)throw Error('Protected local adapter configuration is unavailable');
 return fetch(`http://127.0.0.1:${port}/internal/capacity`,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-shahvex-ai-key':secret}});
}
