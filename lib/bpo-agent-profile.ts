import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { writeAgentRoute, type agentRouteFields } from './voip-controller';
import type { z } from 'zod';
import { db } from './database';
import { bpoEntitlements } from './bpo-entitlements';
type Profile={name:string;gender:string;voiceId:string;conversationStyle:string;speaksFirst:string;avatarUrl?:string;route?:z.infer<typeof agentRouteFields>};
export async function saveBpoAgentProfile(owner:string,value:Profile,id?:string){
 const tx=await (await db()).connect();try{await tx.query('BEGIN');
  const owned=await tx.query("SELECT id FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED' FOR UPDATE",[owner]);if(!owned.rows.length)throw Error('Approved BPO account required');
  if(id){const agent=await tx.query('SELECT b.agent_id FROM bpo_created_agents b JOIN agents a ON a.id=b.agent_id WHERE b.agent_id=$1 AND b.bpo_id=$2 AND a.deleted_at IS NULL FOR UPDATE OF b',[id,owner]);if(!agent.rows.length)throw Error('Agent not found');}
  else{const plan=await bpoEntitlements(tx,owner),count=await tx.query('SELECT COUNT(*)::int agents FROM bpo_created_agents b JOIN agents a ON a.id=b.agent_id WHERE b.bpo_id=$1 AND a.deleted_at IS NULL',[owner]);if(Number(count.rows[0]?.agents)>=plan.agents)throw Error('No available agent slots');}
  const voice=(await tx.query("SELECT id,name,accent FROM local_voice_registry WHERE id=$1 AND status='ACTIVE' AND (is_global=TRUE OR owner_id=$2)",[value.voiceId,owner])).rows[0];if(!voice)throw Error('Select an approved local voice');
  const agentId=id||randomUUID();
  if (value.route) await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`vicidial:${value.route.connectionId}`]);
  if(!id){await tx.query("INSERT INTO agents(id,name,username,password_hash,gender,accent,avatar_url,status,role,approved_at,local_voice_id,conversation_style,speaks_first) VALUES($1,$2,$3,$4,$5,$6,$7,'APPROVED','AGENT',NOW(),$8,$9,$10)",[agentId,value.name,`bpo-${agentId.replaceAll('-','').slice(0,20)}`,await hash(randomUUID(),12),value.gender,voice.accent||'',value.avatarUrl||null,voice.id,value.conversationStyle,value.speaksFirst]);await tx.query("INSERT INTO bpo_created_agents(agent_id,bpo_id,voice_name,script_name,lead_file_name,dialing_mode) VALUES($1,$2,$3,'','','BOTH')",[agentId,owner,voice.name]);}
  else{await tx.query('UPDATE agents SET name=$1,gender=$2,local_voice_id=$3,accent=$4,conversation_style=$5,speaks_first=$6,avatar_url=$7,updated_at=NOW() WHERE id=$8',[value.name,value.gender,voice.id,voice.accent||'',value.conversationStyle,value.speaksFirst,value.avatarUrl||null,agentId]);await tx.query('UPDATE bpo_created_agents SET voice_id=NULL,voice_name=$1 WHERE agent_id=$2 AND bpo_id=$3',[voice.name,agentId,owner]);}
  if (value.route) {
   const route = value.route;
   const connection = (await tx.query(`SELECT id,live_config FROM voip_connections
     WHERE id=$1 AND owner_id=$2 AND (enabled OR $3) AND deleted_at IS NULL FOR UPDATE`, [route.connectionId, owner, Boolean(id)])).rows[0];
   const assigned = id && (await tx.query(`SELECT connection_id FROM voip_agent_assignments
     WHERE owner_id=$1 AND agent_id=$2 FOR UPDATE`, [owner, agentId])).rows[0];
   if (assigned && assigned.connection_id !== route.connectionId) {
    await tx.query('ROLLBACK');
    return Response.json({ message: 'Edit the route on the agent’s assigned connection.' }, { status: 409 });
   }
   const failure = connection
     ? await writeAgentRoute(tx, connection, { ...route, agentId })
     : { error: 'Choose an enabled VICIdial connection in your workspace.', status: 400 };
   if (failure) {
    await tx.query('ROLLBACK');
    return Response.json({ message: failure.error }, { status: failure.status });
   }
   if (!assigned) await tx.query(`INSERT INTO voip_agent_assignments(id,owner_id,agent_id,connection_id,direction)
     VALUES($1,$2,$3,$4,'OUTBOUND')`, [randomUUID(),owner,agentId,route.connectionId]);
  }
  await tx.query('COMMIT');if(id){try{await (await import('./vicidial-live')).stopVicidialAgent(id);}catch{return Response.json({message:'Profile saved; Native intake pause needs verification.'},{status:207});}}return Response.json({message:id?(value.route?'Agent profile and VICIdial route updated.':'Agent profile updated.'):value.route ? 'Agent and VICIdial route saved. Assign the agent to a campaign in VoIP.' : 'Agent created. Assign it to a campaign in VoIP.',agentId},{status:id?200:201});
 }catch{await tx.query('ROLLBACK');return Response.json({message:'Unable to save profile. Check agent slots, unique name and approved voice.'},{status:400});}finally{tx.release();}
}
