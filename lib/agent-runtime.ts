import type { PoolClient } from "pg";
import { db } from "./database";
type Client = Pick<PoolClient, "query">;
export const agentRuntimeStates = [
  "OFFLINE",
  "READY",
  "RESERVED",
  "BUSY",
  "TRANSFERRING",
  "ERROR",
] as const;
export async function markAgentReady(
  agentId: string,
  campaignId: string | null,
  client?: Client,
) {
  await (client || (await db())).query(
    `INSERT INTO ai_agent_runtime_states(agent_id,campaign_id,state,last_seen_at) VALUES($1,$2,'READY',NOW())
 ON CONFLICT(agent_id) DO UPDATE SET campaign_id=EXCLUDED.campaign_id,state='READY',last_error='',last_seen_at=NOW(),updated_at=NOW()
 WHERE ai_agent_runtime_states.call_id IS NULL`,
    [agentId, campaignId],
  );
}
export async function reserveAgent(
  client: Client,
  agentId: string,
  callId: string,
  campaignId: string | null,
) {
  const result = await client.query(
    `UPDATE ai_agent_runtime_states SET state='RESERVED',call_id=$2,campaign_id=$3,last_assigned_at=NOW(),last_seen_at=NOW(),lease_expires_at=NOW()+INTERVAL '60 seconds',updated_at=NOW()
 WHERE agent_id=$1 AND state='READY' AND call_id IS NULL RETURNING agent_id`,
    [agentId, callId, campaignId],
  );
  return result.rowCount === 1;
}
export async function mediaReady(
  callId: string,
  voiceSessionId?: string,
  event?: {
    connectionId: string;
    eventId: string;
    payloadHash: string;
    payload: object;
  },
) {
  // One atomic statement: audio readiness cannot leave a BUSY instance attached to
  // an unactivated call, and no network round trips separate the two updates.
  const result = await (
    await db()
  ).query(
    `WITH candidate AS (
 SELECT id FROM agent_calls WHERE id=$1 AND status='INITIATED' AND ($2::text IS NOT NULL OR voice_session_id IS NOT NULL) FOR UPDATE
 ), activated AS (
  UPDATE ai_agent_runtime_states r SET state='BUSY',last_seen_at=NOW(),updated_at=NOW()
  WHERE r.call_id=$1 AND r.state='RESERVED' AND EXISTS(SELECT 1 FROM candidate)
  RETURNING r.call_id
 ), answered AS (UPDATE agent_calls c SET status='ANSWERED',voice_session_id=COALESCE($2::text,c.voice_session_id),conversation_state='LISTENING',
 answered_at=COALESCE(answered_at,NOW()),last_heartbeat_at=NOW()
 WHERE c.id IN (SELECT call_id FROM activated) AND c.status='INITIATED' RETURNING c.id
 ), completed AS (
 UPDATE vicidial_events e SET processing_state='COMPLETED',processed_at=NOW(),lease_expires_at=NULL,
 response_payload=$6::jsonb,response_status=200
 FROM answered a WHERE e.connection_id=$3::text AND e.event_id=$4::text AND e.payload_hash=$5::text AND e.processing_state='RUNNING' RETURNING e.event_id
 ) SELECT a.id,CASE WHEN $3::text IS NULL THEN 1 ELSE 1/(SELECT COUNT(*)::int FROM completed) END AS event_saved FROM answered a`,
    [
      callId,
      voiceSessionId || null,
      event?.connectionId || null,
      event?.eventId || null,
      event?.payloadHash || null,
      event ? JSON.stringify(event.payload) : null,
    ],
  );
  return result.rowCount === 1;
}
export async function setRuntimeState(
  callId: string,
  state: "ERROR" | "TRANSFERRING" | "BUSY",
  error = "",
) {
  await (
    await db()
  ).query(
    "UPDATE ai_agent_runtime_states SET state=$1,last_error=$2,updated_at=NOW() WHERE call_id=$3",
    [state, error, callId],
  );
}
/** A timestamp expiry is never sufficient evidence to release a customer call. */
export async function releaseConfirmedAgent(
  callId: string,
  observed?: { connectionId: string; nativeId: string | null; audioUuid: string | null; before: Date },
) {
  const pool = await db(),
    tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const call = (
      await tx.query("SELECT * FROM agent_calls WHERE id=$1 FOR UPDATE", [
        callId,
      ])
    ).rows[0];
    if (observed) {
      // A reconnect, native link, or handoff since the observation invalidates it.
      const confirmed = await tx.query(
        `UPDATE agent_calls a SET customer_ended=TRUE,ai_leg_released=TRUE,
          ai_media_ended_at=COALESCE(ai_media_ended_at,NOW())
          WHERE a.id=$1 AND a.voip_connection_id=$2
            AND a.vicidial_call_id IS NOT DISTINCT FROM $3::text
            AND a.direct_audio_uuid IS NOT DISTINCT FROM $4::text
            AND a.status IN ('INITIATED','RINGING','ANSWERED')
            AND COALESCE(a.transfer_status,'') NOT IN ('PREPARING','UNCERTAIN','SUBMITTED','ANSWERED')
            AND COALESCE(a.last_heartbeat_at,a.created_at)<$5
            AND ($3::text IS NOT NULL OR EXISTS(
              SELECT 1 FROM ai_agent_runtime_states r WHERE r.agent_id=a.agent_id AND r.call_id=a.id
            )) RETURNING a.id`,
        [callId, observed.connectionId, observed.nativeId, observed.audioUuid, observed.before],
      );
      if (!confirmed.rowCount) {
        await tx.query("COMMIT");
        return false;
      }
    }
    if (
      !call ||
      (!observed &&
        (!call.ai_leg_released ||
          (!call.customer_ended && !["SUBMITTED", "ANSWERED"].includes(call.transfer_status))))
    ) {
      await tx.query("COMMIT");
      return false;
    }
    await tx.query(
      `UPDATE agent_calls SET status=CASE WHEN status='FAILED' THEN status ELSE 'COMPLETED' END,
 conversation_state=CASE WHEN transfer_status IN ('SUBMITTED','ANSWERED') THEN 'HANDED_OFF' ELSE 'COMPLETED' END,
 ended_at=COALESCE(ended_at,ai_media_ended_at,NOW()),recording_active=FALSE,conversation_busy=FALSE,updated_at=NOW() WHERE id=$1`,
      [callId],
    );
    await tx.query(
      `UPDATE ai_agent_runtime_states r SET call_id=NULL,state=CASE WHEN EXISTS(SELECT 1 FROM vicidial_pool_agents q WHERE q.agent_id=r.agent_id AND q.ready=TRUE) THEN 'READY' ELSE 'OFFLINE' END,
 campaign_id=COALESCE((SELECT x.campaign_id FROM campaign_agent_assignments x WHERE x.agent_id=r.agent_id),campaign_id),lease_expires_at=NULL,last_seen_at=NOW(),last_error='',updated_at=NOW() WHERE call_id=$1`,
      [callId],
    );
    await tx.query("COMMIT");
    return true;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}
