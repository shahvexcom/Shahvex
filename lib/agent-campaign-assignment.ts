import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
/** Caller owns the transaction and has already checked access to the agent. */
export async function saveAgentCampaign(tx:Pick<PoolClient,'query'>,agentId:string,owner:string,campaignId:string|undefined){
 if(campaignId===undefined)return;
 if(!campaignId){await tx.query('UPDATE campaign_agent_assignments SET enabled=FALSE WHERE agent_id=$1 AND owner_id=$2',[agentId,owner]);return;}
 const d=(await tx.query('SELECT * FROM campaign_definitions WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR SHARE',[campaignId,owner])).rows[0];
 if(!d)throw Error('Select an owned campaign');
 const assigned=await tx.query('INSERT INTO campaign_agent_assignments(agent_id,campaign_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(agent_id) DO UPDATE SET enabled=TRUE,updated_at=NOW() WHERE campaign_agent_assignments.campaign_id=EXCLUDED.campaign_id AND campaign_agent_assignments.owner_id=EXCLUDED.owner_id RETURNING agent_id',[agentId,d.id,owner]);
 if(assigned.rowCount===0)throw Error('Agent already belongs to another campaign; remove that assignment first');
 await tx.query("INSERT INTO voip_agent_assignments(id,owner_id,agent_id,connection_id,direction,campaign_id) VALUES($1,$2,$3,$4,'OUTBOUND',$5) ON CONFLICT(owner_id,agent_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,campaign_id=EXCLUDED.campaign_id,direction='OUTBOUND',updated_at=NOW()",[randomUUID(),owner,agentId,d.connection_id,d.external_campaign_id]);
}
