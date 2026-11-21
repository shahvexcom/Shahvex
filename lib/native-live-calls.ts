import "server-only";
import { createHash } from "node:crypto";
import { db } from "./database";
import { decryptCredential } from "./credential-crypto";
import { vicidialRequest } from "./vicidial";
import { parseVicidialTable } from "./campaign-config";
import { mergeNativeCalls, type VisibleCall } from "./native-call-merge";

type Mapping={connection_id:string;agent_id:string;agent_name:string;agent_avatar:string;prefix:string;remote_user:string;campaign_id:string;server_url:string;username:string;secret_ciphertext:string};
type Cached={failed?:boolean;until:number;pending?:Promise<VisibleCall|null>;value?:VisibleCall|null};
const shared=globalThis as typeof globalThis&{nativeLiveCache?:Map<string,Cached>};
const cache=shared.nativeLiveCache ||= new Map<string,Cached>();
const mappingKey = (row: Mapping) => createHash("sha256").update(JSON.stringify(row)).digest("hex");
const refreshes = new Map<string, Promise<void>>();
/** Request only the exact account-owned configured remote user. No lead HTML or dialer writes. */
async function observe(row:Mapping):Promise<VisibleCall|null>{
 const key=mappingKey(row);
 const prior=cache.get(key);if(prior?.pending)return prior.pending;if(prior&&prior.until>Date.now())return prior.value||null;
 const entry:Cached={until:0,value:prior?.value,failed:prior?.failed};cache.set(key,entry);
 entry.pending=(async()=>{try{
  const raw=await vicidialRequest(row.server_url,row.username,decryptCredential(row.secret_ciphertext),{function:'agent_status',agent_user:row.remote_user,stage:'pipe',header:'YES'},false,1500);
  if(/^\s*ERROR:/.test(raw)){entry.failed=!/AGENT NOT (?:LOGGED IN|FOUND)/i.test(raw);return null;}
  const state=parseVicidialTable(raw)[0],id=state?.call_id||state?.callerid||'';
  if(state?.status!=='INCALL'||state.campaign_id!==row.campaign_id||!/^[-\w]{16,40}$/.test(id)||!/^\d+$/.test(state.lead_id||''))return null;
  const at=new Date().toISOString();
  return {id:`native-${row.connection_id}-${row.remote_user}-${id}`,agent_id:row.agent_id,agent_name:row.agent_name,agent_avatar:row.agent_avatar,voip_connection_id:row.connection_id,vicidial_call_id:id,vicidial_lead_id:state.lead_id,vicidial_agent_user:row.remote_user,direct_audio_line:row.prefix,external_campaign_id:row.campaign_id,lead_number:/^\+?\d{7,15}$/.test(state.phone_number||'')?state.phone_number:'',lead_name:'',status:'ANSWERED',conversation_state:'NATIVE_CONNECTED',telephony_provider:'VICIDIAL',native_connected:true,native_only:true,native_verified_at:at,updated_at:at,ai_leg_released:true,conversation_busy:false,recording_active:false,conversation_history:[],transcript:''};
 }catch{entry.failed=true;return null;}})();
 try{entry.value=await entry.pending;entry.until=Date.now()+2000;return entry.value;}finally{entry.pending=undefined;if(cache.size>600)for(const[k,v]of cache)if(v.until<Date.now()&&!v.pending)cache.delete(k);}
}
export async function withNativeLiveCalls(calls:VisibleCall[],portal:'admin'|'bpo',owner?:string){
 const scope=portal==='bpo'?'EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id AND b.bpo_id=$1)':'NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)';
 try {
 const rows=(await(await db()).query(`SELECT c.id connection_id,a.id agent_id,a.name agent_name,COALESCE(a.avatar_url,'') agent_avatar,line->>'prefix' prefix,line->>'remoteUser' remote_user,v.campaign_id,c.server_url,c.username,c.secret_ciphertext
 FROM voip_connections c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.live_config->'directAudioLines','[]'::jsonb)) line
 JOIN agents a ON a.id=line->>'agentId' AND a.deleted_at IS NULL
 JOIN voip_agent_assignments v ON v.agent_id=a.id AND v.connection_id=c.id AND v.owner_id=c.owner_id AND v.direction='OUTBOUND'
 WHERE c.enabled AND c.status='CONNECTED' AND c.live_config->>'enabled'='true' AND ${scope}`,portal==='bpo'?[owner]:[])).rows as Mapping[];
 const keys = rows.map(mappingKey);
 const refreshKey = keys.join(":");
 let refresh = refreshes.get(refreshKey);
 if (!refresh) {
   let next = 0;
   refresh = Promise.all(Array.from({length:Math.min(8,rows.length)}, async () => {
     while (next < rows.length) await observe(rows[next++]);
   })).then(() => {}).finally(() => refreshes.delete(refreshKey));
   refreshes.set(refreshKey, refresh);
 }
 // Slow native enrichment must not hold back already-connected Shahvex calls.
 let timer: ReturnType<typeof setTimeout> | undefined;
 await Promise.race([refresh, new Promise<void>(resolve => { timer = setTimeout(resolve, 250); })])
   .finally(() => clearTimeout(timer));
 const observed = keys.flatMap(key => {
   const value = cache.get(key)?.value;
   return value ? [value] : [];
 });
 return {calls:mergeNativeCalls(calls,observed),native_status:{available:!keys.some(key=>cache.get(key)?.failed),checked_at:new Date().toISOString()}};

 }catch{return {calls,native_status:{available:false,checked_at:new Date().toISOString()}};}
}
