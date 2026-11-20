export type VisibleCall = {id:string; agent_id?:string; status:string; vicidial_call_id?:string; voip_connection_id?:string; ai_leg_released?:boolean; [key:string]:any};
/** Observations are never inserted as billable AI calls or used to reserve an agent. */
export function mergeNativeCalls(calls: VisibleCall[], observations: VisibleCall[]) {
  const result:VisibleCall[]=calls.map(c=>({...c,native_connected:false,native_only:false})), seen=new Set<string>();
  for(const observed of observations){
    const key=`${observed.voip_connection_id}:${observed.vicidial_call_id}`;if(seen.has(key))continue;seen.add(key);
    const index=result.findIndex(c=>c.voip_connection_id===observed.voip_connection_id&&c.vicidial_call_id===observed.vicidial_call_id&&c.agent_id===observed.agent_id);
    if(index<0){result.unshift(observed);continue;}
    const original=result[index];
    if(original.customer_ended)continue;
    if(!['INITIATED','RINGING','ANSWERED'].includes(original.status)){
      // A verified human leg has its own monitor identity after AI handoff.
      if(['SUBMITTED','ANSWERED'].includes(original.transfer_status))result.unshift(observed);
      continue;
    }
    result[index]={...original,native_connected:true,native_verified_at:observed.native_verified_at,
      lead_number:observed.lead_number||original.lead_number,native_only:!!original.ai_leg_released,
      conversation_state:original.ai_leg_released?'NATIVE_CONNECTED':original.conversation_state};
  }
  return result.sort((a,b)=>Number(['INITIATED','RINGING','ANSWERED'].includes(b.status))-Number(['INITIATED','RINGING','ANSWERED'].includes(a.status))||Number(!!b.native_connected)-Number(!!a.native_connected));
}
