import { db } from "./database";
import { releaseConfirmedAgent } from "./agent-runtime";
import { parseVicidialTable } from "./campaign-config";
import { decryptCredential } from "./credential-crypto";
import { requestBridge } from "./vicidial-bridge";
import { vicidialRequest } from "./vicidial";
import { vicidialLiveConfig } from "./vicidial-config";

const running = new Set<string>();
const cursors = new Map<string, string>();

export function nativeAbsence(raw: string, remoteUser: string, campaign: string, nativeId: string | null) {
  const offline = /^ERROR: agent_status AGENT NOT LOGGED IN:\s*[^|\r\n]+\|([^|\r\n]+)\s*$/i.exec(raw.trim());
  if (offline?.[1].trim() === remoteUser) return "offline";
  const rows = parseVicidialTable(raw);
  if (rows.length !== 1) return null;
  const row = rows[0];
  const id = row.call_id || row.callerid || "";
  if (row.campaign_id !== campaign) return null;
  if (row.status === "READY" && !id && row.lead_id === "0") return "ready";
  if (nativeId && row.status === "INCALL" && /^[-\w]{16,40}$/.test(id) && id !== nativeId && /^[1-9]\d*$/.test(row.lead_id))
    return `${id}|${row.lead_id}`;
  return null;
}

/** Reconcile only a missing exact bridge session and a stable native readback.
 * Age selects candidates. It is never evidence that a call ended. */
export async function reconcileMissingVicidialCalls(
  connection: any, key: string, activeIds: string[], stop: (call: any) => Promise<void>, endedCallId?: string,
) {
  const reconciliationKey = endedCallId ? connection.id + ":" + endedCallId : connection.id;
  if (running.has(reconciliationKey)) return;
  running.add(reconciliationKey);
  try {
    const pool = await db();
    const live = vicidialLiveConfig.parse(connection.live_config);
    const before = new Date(Date.now() - (endedCallId ? 0 : 45_000));
    const { rows } = await pool.query(
      `SELECT a.* FROM agent_calls a
       WHERE a.voip_connection_id=$1 AND a.telephony_provider IN ('VICIDIAL','AUDIOSOCKET')
         AND a.status IN ('INITIATED','RINGING','ANSWERED')
         AND COALESCE(a.transfer_status,'') NOT IN ('PREPARING','UNCERTAIN','SUBMITTED','ANSWERED')
         AND COALESCE(a.last_heartbeat_at,a.created_at)<$2 AND NOT (a.id=ANY($3::text[]))
         AND (a.vicidial_call_id IS NOT NULL OR (a.direct_audio_uuid IS NOT NULL AND EXISTS(
           SELECT 1 FROM ai_agent_runtime_states r WHERE r.agent_id=a.agent_id AND r.call_id=a.id
         ))) AND a.id>$4 AND ($5::text IS NULL OR a.id=$5)
       ORDER BY a.id LIMIT 4`,
      [connection.id, before, activeIds, endedCallId ? "" : cursors.get(connection.id) || "", endedCallId || null],
    );
    if (!endedCallId) {
      if (rows.length < 4) cursors.delete(connection.id);
      else cursors.set(connection.id, rows[rows.length - 1].id);
    }
    if (!rows.length) return;
    const secret = decryptCredential(connection.bridge_secret_ciphertext);
    const health = () => requestBridge(live.bridgeUrl, secret, "/health");
    const absent = (snapshot: Awaited<ReturnType<typeof health>>, id: string) =>
      snapshot.audioSocket === true && snapshot.testOnly === false && snapshot.startingCalls === 0 &&
      Array.isArray(snapshot.streams) && snapshot.activeCalls === snapshot.streams.length &&
      snapshot.audioConnections === snapshot.streams.length &&
      snapshot.streams.every(stream => typeof stream?.callId === "string" && stream.callId !== id);
    const initial = await health();
    const confirmed = await Promise.all(rows.map(async call => {
      if (!absent(initial, call.id)) return null;
      const mapping = live.directAudioLines.filter(line => line.agentId === call.agent_id && line.prefix === call.direct_audio_line);
      const user = call.vicidial_call_id ? call.vicidial_agent_user : mapping.length === 1 ? mapping[0].remoteUser : null;
      if (!user || !call.external_campaign_id) return null;
      if (!call.vicidial_call_id) {
        if (!live.remoteUsers.includes(user) || live.directAudioLines.filter(line => line.remoteUser === user).length !== 1) return null;
        const binding = await pool.query(
          `SELECT 1 FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id
           WHERE q.agent_id=$1 AND q.remote_user=$2 AND p.connection_id=$3 AND p.campaign_id=$4`,
          [call.agent_id, user, connection.id, call.external_campaign_id],
        );
        if (binding.rowCount !== 1) return null;
      }
      const read = async () => nativeAbsence(await vicidialRequest(connection.server_url, connection.username, key,
        { function: "agent_status", agent_user: user, stage: "pipe", header: "YES" }, false, 2500),
        user, call.external_campaign_id, call.vicidial_call_id);
      try {
        const first = await read();
        return first && first === await read() ? call : null;
      } catch {
        return null;
      }
    }));
    if (!confirmed.some(Boolean)) return;
    const checked = await health();
    let exactReleased = false;
    for (const call of confirmed) {
      if (!call || !absent(checked, call.id)) continue;
      const released = await releaseConfirmedAgent(call.id, {
        connectionId: connection.id, nativeId: call.vicidial_call_id,
        audioUuid: call.direct_audio_uuid, before,
      });
      if (released) {
        exactReleased ||= call.id === endedCallId;
        await stop(call);
      }
    }
    return exactReleased;
  } finally {
    running.delete(reconciliationKey);
  }
}
