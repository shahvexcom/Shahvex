/** Event deduplication and exclusive turn ownership in one database round trip. */
export const turnAdmissionSql = `WITH verified_connection AS (
 SELECT id FROM voip_connections WHERE id=$1 AND bridge_secret_ciphertext=$7
), incoming AS (
 INSERT INTO vicidial_events(connection_id,event_id,call_id,kind,payload_hash,processing_state,lease_expires_at)
 SELECT $1,$2,$3,'turn',$5,'RUNNING',NOW()+INTERVAL '180 seconds' FROM verified_connection
 ON CONFLICT DO NOTHING RETURNING event_id
), retried AS (
 UPDATE vicidial_events SET processing_state='RUNNING',lease_expires_at=NOW()+INTERVAL '180 seconds'
 WHERE connection_id=$1 AND event_id=$2 AND payload_hash=$5 AND processing_state<>'COMPLETED'
 AND EXISTS(SELECT 1 FROM verified_connection)
 AND (processing_state<>'RUNNING' OR lease_expires_at<NOW()) AND NOT EXISTS(SELECT 1 FROM incoming)
 RETURNING event_id
), claimed AS (SELECT event_id FROM incoming UNION ALL SELECT event_id FROM retried), candidate AS (
 SELECT id FROM agent_calls WHERE voip_connection_id=$1 AND id=$3 AND EXISTS(SELECT 1 FROM verified_connection)
 AND (($6::text IS NOT NULL AND direct_audio_uuid=$6 AND telephony_provider='AUDIOSOCKET')
 OR ($6::text IS NULL AND vicidial_call_id=$4))
), leased AS (
 UPDATE agent_calls a SET conversation_busy=TRUE,transfer_consent=FALSE,handoff_ready=FALSE,
 qualification='{}'::jsonb,updated_at=NOW()
 FROM claimed WHERE a.id=(SELECT id FROM candidate) AND a.status='ANSWERED'
 AND COALESCE(a.transfer_status,'') NOT IN ('PREPARING','UNCERTAIN','SUBMITTED','ANSWERED')
 AND a.conversation_busy=FALSE RETURNING a.id,a.status,a.transfer_status,a.voice_session_id,a.vicidial_call_id,a.conversation_history
)
 SELECT (SELECT row_to_json(leased) FROM leased) AS admitted_call,
 EXISTS(SELECT 1 FROM candidate) AS current_call,
 EXISTS(SELECT 1 FROM claimed) AS claimed,
 EXISTS(SELECT 1 FROM verified_connection) AS connection_current,
 (SELECT row_to_json(e) FROM vicidial_events e WHERE connection_id=$1 AND event_id=$2 AND EXISTS(SELECT 1 FROM verified_connection) AND NOT EXISTS(SELECT 1 FROM claimed)) AS prior`;

/** Persist final transcript and complete the event atomically, with one wait. */
export const turnCompletionSql = `WITH saved AS (
 UPDATE agent_calls SET conversation_history=$1::jsonb,transcript=$2,conversation_busy=FALSE,
 conversation_state=CASE WHEN status IN ('COMPLETED','FAILED') THEN 'COMPLETED' ELSE $3 END,updated_at=NOW()
 WHERE id=$4 RETURNING id
) UPDATE vicidial_events SET processing_state='COMPLETED',processed_at=NOW(),lease_expires_at=NULL,last_error=$5
 WHERE connection_id=$6 AND event_id=$7 AND EXISTS(SELECT 1 FROM saved)`;

/** Controller direct-audio admission in one round trip; BPO retains entitlement admission. */
export const directAdmissionSql = `WITH supported AS (
 SELECT NOT EXISTS(SELECT 1 FROM bpo_created_agents WHERE agent_id=$6) AS ok
), verified AS (
 SELECT id FROM voip_connections WHERE id=$1 AND owner_id=$8 AND enabled
 AND bridge_secret_ciphertext=$11 AND media_verified_at IS NOT NULL AND $3::text='direct-'||replace($5::text,'-','')
 AND live_config->>'enabled'='true' AND live_config->>'directAudioMode'='true'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(live_config->'directAudioLines') line
 WHERE line->>'agentId'=$6 AND line->>'remoteUser'=$7 AND line->>'prefix'=$10)
), incoming AS (
 INSERT INTO vicidial_events(connection_id,event_id,kind,payload_hash,processing_state,lease_expires_at)
 SELECT $1,$2,'connected',$4,'RUNNING',NOW()+INTERVAL '180 seconds' FROM verified WHERE (SELECT ok FROM supported)
 ON CONFLICT DO NOTHING RETURNING event_id
), retried AS (
 UPDATE vicidial_events SET processing_state='RUNNING',lease_expires_at=NOW()+INTERVAL '180 seconds'
 WHERE connection_id=$1 AND event_id=$2 AND payload_hash=$4 AND processing_state<>'COMPLETED'
 AND (processing_state<>'RUNNING' OR lease_expires_at<NOW())
 AND EXISTS(SELECT 1 FROM verified) AND (SELECT ok FROM supported) AND NOT EXISTS(SELECT 1 FROM incoming)
 RETURNING event_id
), claimed AS (SELECT event_id FROM incoming UNION ALL SELECT event_id FROM retried), previous AS (
 SELECT * FROM agent_calls WHERE voip_connection_id=$1 AND direct_audio_uuid=$5 AND telephony_provider='AUDIOSOCKET'
), eligible AS MATERIALIZED (
 SELECT a.id,a.name,a.local_voice_id,q.config,q.max_call_duration_seconds,d.id campaign_id,d.external_campaign_id,d.script
 FROM agents a JOIN campaign_agent_assignments x ON x.agent_id=a.id AND x.enabled
 JOIN campaign_definitions d ON d.id=x.campaign_id AND d.connection_id=$1 AND d.owner_id=$8
 JOIN voip_agent_assignments va ON va.agent_id=a.id AND va.connection_id=d.connection_id AND va.owner_id=d.owner_id AND va.campaign_id=d.external_campaign_id
 JOIN vicidial_pool_agents q ON q.agent_id=a.id AND q.ready AND q.remote_user=$7
 JOIN ai_agent_runtime_states rs ON rs.agent_id=a.id AND rs.state='READY' AND rs.call_id IS NULL
 WHERE a.id=$6 AND a.status='APPROVED' AND a.deleted_at IS NULL AND d.enabled AND d.deleted_at IS NULL
 AND d.intake_state='RUNNING' AND BTRIM(d.script)<>'' AND EXISTS(SELECT 1 FROM claimed)
 AND (SELECT ok FROM supported) AND NOT EXISTS(SELECT 1 FROM previous)
 AND (SELECT COUNT(*) FROM agent_calls today WHERE today.agent_id=a.id AND today.created_at>=date_trunc('day',NOW()))<a.daily_call_limit
 AND NOT EXISTS(SELECT 1 FROM agent_calls active WHERE active.agent_id=a.id AND active.status IN ('INITIATED','RINGING','ANSWERED'))
 FOR UPDATE OF a,rs SKIP LOCKED
), inserted AS (
 INSERT INTO agent_calls(id,agent_id,status,telephony_provider,voip_connection_id,direct_audio_uuid,direct_audio_line,campaign_definition_id,external_campaign_id,script_snapshot,conversation_state,dialing_source,max_call_duration_seconds,vicidial_sync_status)
 SELECT $9,e.id,'INITIATED','AUDIOSOCKET',$1,$5,$10,e.campaign_id,e.external_campaign_id,
 e.config||jsonb_build_object('name',e.name,'voice',e.local_voice_id,'script',e.script),'LISTENING','DIRECT',COALESCE(e.max_call_duration_seconds,0),'NOT_APPLICABLE'
 FROM eligible e RETURNING *
), reserved AS (
 UPDATE ai_agent_runtime_states r SET state='RESERVED',call_id=i.id,campaign_id=i.campaign_definition_id,
 last_assigned_at=NOW(),last_seen_at=NOW(),lease_expires_at=NOW()+INTERVAL '60 seconds',updated_at=NOW()
 FROM inserted i WHERE r.agent_id=i.agent_id AND r.state='READY' AND r.call_id IS NULL RETURNING r.agent_id
)
 SELECT (SELECT ok FROM supported) AS supported,EXISTS(SELECT 1 FROM verified) AS connection_current,
 EXISTS(SELECT 1 FROM claimed) AS claimed,(SELECT row_to_json(inserted) FROM inserted) AS admitted_call,
 (SELECT row_to_json(previous) FROM previous) AS existing_call,
 CASE WHEN EXISTS(SELECT 1 FROM inserted) THEN 1/(SELECT COUNT(*)::int FROM reserved) ELSE 1 END AS reservation_ok,
 (SELECT row_to_json(e) FROM vicidial_events e WHERE connection_id=$1 AND event_id=$2 AND NOT EXISTS(SELECT 1 FROM claimed)) AS prior`;

/** Resolve the authenticated line and its current readiness with the connection read. */
export const directPrefixReadSql = `SELECT c.*,(SELECT d.external_campaign_id
 FROM jsonb_array_elements(c.live_config->'directAudioLines') line
 JOIN campaign_agent_assignments x ON x.agent_id=line->>'agentId' AND x.enabled
 JOIN campaign_definitions d ON d.id=x.campaign_id AND d.connection_id=c.id AND d.owner_id=c.owner_id
 JOIN voip_agent_assignments va ON va.agent_id=x.agent_id AND va.connection_id=d.connection_id AND va.owner_id=d.owner_id AND va.campaign_id=d.external_campaign_id
 JOIN vicidial_pool_agents q ON q.agent_id=x.agent_id AND q.remote_user=line->>'remoteUser' AND q.ready
 JOIN ai_agent_runtime_states rs ON rs.agent_id=x.agent_id AND rs.state='READY' AND rs.call_id IS NULL
 WHERE line->>'prefix'=$2 AND d.enabled AND d.deleted_at IS NULL AND d.intake_state='RUNNING'
 LIMIT 1) AS resolved_campaign_id FROM voip_connections c WHERE c.id=$1`;
