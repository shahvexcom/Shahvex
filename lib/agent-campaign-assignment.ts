import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
/** Caller owns the transaction and has already checked access to the agent. */
export async function saveAgentCampaign(tx:Pick<PoolClient,'query'>,agentId:string,owner:string,campaignId:string|undefined){
 if(campaignId===undefined)return;
 await tx.query('SELECT id FROM agents WHERE id=$1 FOR UPDATE',[agentId]);
 if((await tx.query('SELECT agent_id FROM ai_agent_runtime_states WHERE agent_id=$1 AND call_id IS NOT NULL',[agentId])).rows.length)throw Error('Finish the active call before changing campaign assignment');
 if(!campaignId){await tx.query('DELETE FROM campaign_agent_assignments WHERE agent_id=$1 AND owner_id=$2',[agentId,owner]);await tx.query("UPDATE voip_agent_assignments SET campaign_id='',updated_at=NOW() WHERE agent_id=$1 AND owner_id=$2",[agentId,owner]);return;}
 const existing=(await tx.query('SELECT campaign_id,owner_id FROM campaign_agent_assignments WHERE agent_id=$1',[agentId])).rows[0];
 if(existing&&(existing.campaign_id!==campaignId||existing.owner_id!==owner))throw Error('An agent can belong to only one campaign. Remove its current assignment first.');
 // Profile saves must not re-enable paused intake or rewrite its dedicated route.
 if(existing?.campaign_id===campaignId&&existing.owner_id===owner)return;
 const d=(await tx.query('SELECT * FROM campaign_definitions WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR SHARE',[campaignId,owner])).rows[0];
 if(!d)throw Error('Select an owned campaign');
 const assigned=await tx.query('INSERT INTO campaign_agent_assignments(agent_id,campaign_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(agent_id) DO UPDATE SET enabled=TRUE,updated_at=NOW() WHERE campaign_agent_assignments.owner_id=EXCLUDED.owner_id AND campaign_agent_assignments.campaign_id=EXCLUDED.campaign_id RETURNING agent_id',[agentId,d.id,owner]);
 if(assigned.rowCount===0)throw Error('Agent belongs to another owner; use an agent from this account');
 await tx.query("INSERT INTO voip_agent_assignments(id,owner_id,agent_id,connection_id,direction,campaign_id) VALUES($1,$2,$3,$4,'OUTBOUND',$5) ON CONFLICT(owner_id,agent_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,campaign_id=EXCLUDED.campaign_id,direction='OUTBOUND',updated_at=NOW()",[randomUUID(),owner,agentId,d.connection_id,d.external_campaign_id]);
}

export async function saveAgentCampaignPreference(tx:Pick<PoolClient,'query'>,agentId:string,owner:string,categoryId:string|undefined,externalId:string|undefined){
 if(categoryId===undefined&&externalId===undefined)return;
 if(categoryId&&!(await tx.query('SELECT id FROM campaign_categories WHERE id=$1 AND owner_id=$2',[categoryId,owner])).rows.length)throw Error('Select an owned category');
 const saved=await tx.query(`INSERT INTO agent_campaign_preferences(agent_id,owner_id,category_id,external_campaign_id) VALUES($1,$2,$3,$4)
 ON CONFLICT(agent_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,category_id=EXCLUDED.category_id,external_campaign_id=EXCLUDED.external_campaign_id,updated_at=NOW() WHERE agent_campaign_preferences.owner_id=EXCLUDED.owner_id`,[agentId,owner,categoryId||null,externalId||'']);
 if(saved.rowCount===0)throw Error('Agent preferences belong to another owner');
}
