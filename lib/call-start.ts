import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { bpoEntitlements, bpoLeadUsage } from "@/lib/bpo-entitlements";
import { db } from "@/lib/database";
import { decryptCredential } from "@/app/api/admin/credentials/route";

function value(row: string[], headers: string[], names: string[]) { const index = headers.findIndex(header => names.some(name => header.toLowerCase().replace(/[^a-z]/g, "").includes(name))); return index >= 0 ? String(row[index] ?? "").trim() : ""; }
function e164(number: string) {
  const cleaned = String(number ?? "").trim().replace(/[\s()-]/g, "");
  const normalized = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : "";
}
function pakistanMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}
function timeMinutes(value: unknown) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}
function insideSchedule(start: unknown, end: unknown) {
  const now = pakistanMinutes(), from = timeMinutes(start), to = timeMinutes(end);
  return from === to || (from < to ? now >= from && now < to : now >= from || now < to);
}
async function telnyxGet(url: string, key: string) { const result = await fetch(`https://api.telnyx.com/v2${url}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) }); const json = await result.json().catch(() => ({})); if (!result.ok) throw new Error(json?.errors?.[0]?.detail || json?.errors?.[0]?.title || `Telnyx request failed (${result.status}).`); return json; }
export async function syncLiveAssistantTranscript(call: { id: string; telnyx_ai_conversation_id?: string; transcript?: string; conversation_history?: unknown[] }, client: Pick<PoolClient, "query">) { if (!call.telnyx_ai_conversation_id) return; try { const credential = await client.query("SELECT t.secret_ciphertext FROM agent_calls c JOIN agent_credentials ac ON ac.agent_id=c.agent_id AND ac.provider='TELNYX' JOIN ai_credentials t ON t.id=ac.credential_id WHERE c.id=$1 LIMIT 1", [call.id]); const secret = credential.rows[0]?.secret_ciphertext; if (!secret) return; const data = await telnyxGet(`/ai/conversations/${encodeURIComponent(call.telnyx_ai_conversation_id)}/messages`, decryptCredential(secret)); const turns = (Array.isArray(data?.data) ? data.data : []).filter((item: { role?: unknown; text?: unknown; content?: unknown }) => (item.role === "assistant" || item.role === "user") && typeof (item.text ?? item.content) === "string").map((item: { role: "assistant"|"user"; text?: string; content?: string }) => ({ role: item.role, content: String(item.text ?? item.content).slice(0, 4000), at: new Date().toISOString() })); if (!turns.length) return; const transcript = turns.map((turn: { role: string; content: string }) => `${turn.role === "assistant" ? "AGENT" : "CLIENT"}: ${turn.content}`).join("\n"); await client.query("UPDATE agent_calls SET conversation_history=$1::jsonb,transcript=$2,updated_at=NOW() WHERE id=$3", [JSON.stringify(turns), transcript, call.id]); call.conversation_history=turns; call.transcript=transcript; } catch (error) { console.error("Live assistant transcript sync failed", error); } }
async function connectionIdFor(agent: { config: { connectionId?: string }; secret_ciphertext: string; credential_id: string }, client: Pick<PoolClient, "query">) {
  const key = decryptCredential(agent.secret_ciphertext);
  let connectionId = agent.config.connectionId?.trim() || "";
  if (connectionId) {
    try {
      const app = await telnyxGet(`/call_control_applications/${encodeURIComponent(connectionId)}`, key);
      if (!app?.data?.webhook_event_url) throw new Error("The selected Call Control App has no webhook URL.");
      return connectionId;
    } catch {
      throw new Error("The saved Connection ID is not a valid Telnyx Call Control App. In AI Credentials, replace it with the Call Control App ID and configure its HTTPS webhook URL.");
    }
  }
  const data = await telnyxGet("/call_control_applications?page[size]=25", key);
  const apps = Array.isArray(data.data) ? data.data.filter((item: { id?: unknown; webhook_event_url?: unknown }) => typeof item?.id === "string" && typeof item?.webhook_event_url === "string" && item.webhook_event_url.startsWith("https://")) : [];
  if (apps.length !== 1) throw new Error(apps.length ? "More than one Telnyx Call Control App was found. Save the correct Call Control App ID in AI Credentials." : "No active Telnyx Call Control App with an HTTPS webhook URL was found.");
  connectionId = apps[0].id as string;
  await client.query("UPDATE ai_credentials SET config=jsonb_set(config,'{connectionId}',to_jsonb($1::text),true),updated_at=NOW() WHERE id=$2", [connectionId, agent.credential_id]);
  return connectionId;
}


export class CallStartError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

/** Reserve and commit an active call before contacting the provider.
 * All portals take the same agent row lock, so only one request can reserve it.
 */
type BpoCallOptions = { bpoId?: string; dialingSource?: "MANUAL" | "AUTO"; maxCallDurationSeconds?: number };

export async function startAgentCall(agentId: string, options: BpoCallOptions = {}) {
  const pool = await db();
  const assigned = await pool.query("SELECT c.live_config FROM voip_agent_assignments v JOIN voip_connections c ON c.id=v.connection_id AND c.owner_id=v.owner_id WHERE v.agent_id=$1",[agentId]);
  if (assigned.rows[0]?.live_config?.enabled) {
    try { return await (await import("./vicidial-live")).startVicidialAgent(agentId,options); }
    catch (error) { throw new CallStartError(error instanceof Error ? error.message : "VICIdial start failed",409); }
  }
  const client = await pool.connect();
  const id = randomUUID();
  let reserved: { name: string; to: string; from: string; key: string; connectionId: string };
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT id FROM agents WHERE id=$1 FOR UPDATE", [agentId]);
    if (!locked.rowCount) throw new CallStartError("Agent not found.", 404);
    if (!options.bpoId) {
      const setup = await client.query(`SELECT a.id FROM agents a WHERE a.id=$1
        AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)
        AND EXISTS (SELECT 1 FROM script_assignments s WHERE s.agent_id=a.id AND BTRIM(s.script_text)<>'')
        AND EXISTS (SELECT 1 FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id AND vc.owner_id=va.owner_id WHERE va.agent_id=a.id AND vc.enabled=TRUE AND vc.status='CONNECTED')`, [agentId]);
      if (!setup.rowCount) throw new CallStartError("Assign a script and an enabled, API-verified VoIP connection before starting this controller agent.", 400);
    }
    if (options.bpoId) {
      // Serialise BPO starts on the workspace row. This prevents two browser
      // requests (manual or auto) from both consuming the final plan call.
      const bpo = await client.query("SELECT id FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED' FOR UPDATE", [options.bpoId]);
      if (!bpo.rows[0]) throw new CallStartError("Your BPO workspace is not active.", 403);
      const allowedModes = options.dialingSource === "AUTO" ? "('AUTO','BOTH')" : options.dialingSource === "MANUAL" ? "('MANUAL','BOTH')" : "('AUTO','MANUAL','BOTH')";
      const ownership = await client.query(`SELECT b.agent_id FROM bpo_created_agents b
        JOIN admin_voices v ON v.id=b.voice_id AND v.status='ACTIVE'
        JOIN bpo_voice_assignments x ON x.bpo_id=b.bpo_id AND x.voice_id=b.voice_id AND x.is_active=TRUE
        WHERE b.agent_id=$1 AND b.bpo_id=$2 AND b.is_active=TRUE AND b.dialing_mode IN ${allowedModes}`, [agentId, options.bpoId]);
      if (!ownership.rows[0]) throw new CallStartError("This calling agent is not active in your BPO workspace.", 403);
      const [limits, usage] = await Promise.all([bpoEntitlements(client, options.bpoId), bpoLeadUsage(client, options.bpoId)]);
      if (!limits.calls || usage.calls >= limits.calls) throw new CallStartError("Your purchased call allowance has been reached. Buy more calls from Plans.", 409);
      if (!limits.minutes || usage.minutes >= limits.minutes) throw new CallStartError("Your purchased minute allowance has been reached. Buy more minutes from Plans.", 409);
    } else {
      const schedule = await client.query("SELECT is_enabled,start_time::text start_time,end_time::text end_time FROM agent_call_schedules WHERE agent_id=$1", [agentId]);
      const assigned = schedule.rows[0];
      if (assigned?.is_enabled && !insideSchedule(assigned.start_time, assigned.end_time)) {
        throw new CallStartError(`Calling is scheduled from ${String(assigned.start_time).slice(0, 5)} to ${String(assigned.end_time).slice(0, 5)} Pakistan time.`, 403);
      }
    }
    const active = await client.query("SELECT id FROM agent_calls WHERE agent_id=$1 AND status IN ('INITIATED','RINGING','ANSWERED') LIMIT 1", [agentId]);
    if (active.rowCount) throw new CallStartError("This agent already has a live or starting call. End it before starting another.");
    const found = await client.query(`SELECT a.name,a.daily_call_limit,s.lead_headers,s.lead_rows,s.script_text,c.id credential_id,c.secret_ciphertext,c.config
      FROM agents a JOIN LATERAL (SELECT lead_headers,lead_rows,script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE
      JOIN agent_credentials ac ON ac.agent_id=a.id AND ac.provider='TELNYX' JOIN ai_credentials c ON c.id=ac.credential_id
      JOIN agent_credentials gac ON gac.agent_id=a.id AND gac.provider='GROQ' JOIN ai_credentials g ON g.id=gac.credential_id
      WHERE a.id=$1 AND a.role='AGENT' AND a.status='APPROVED'`, [agentId]);
    const agent = found.rows[0];
    if (!agent || !String(agent.script_text || "").trim()) throw new CallStartError("Approval, AI credentials, lead sheet and script are required.", 400);
    const today = await client.query("SELECT COUNT(*)::int total FROM agent_calls WHERE agent_id=$1 AND created_at >= date_trunc('day',NOW())", [agentId]);
    if (today.rows[0].total >= agent.daily_call_limit) throw new CallStartError("Daily call limit reached.", 409);
    const config = agent.config as { connectionId?: string; outboundNumber?: string };
    const from = e164(config.outboundNumber || "");
    if (!from) throw new CallStartError("A valid assigned outbound number is required.", 400);
    const headers = Array.isArray(agent.lead_headers) ? agent.lead_headers as string[] : [];
    const rows = Array.isArray(agent.lead_rows) ? agent.lead_rows as string[][] : [];
    let lead: string[] | undefined;
    let to = "";
    for (const row of rows) {
      const number = e164(value(row, headers, ["phone", "mobile", "telephone", "number"]));
      if (!number) continue;
      const suppressed = await client.query("SELECT 1 FROM do_not_call WHERE phone_number=$1", [number]);
      if (suppressed.rowCount) continue;
      const claim = await client.query("INSERT INTO lead_claims (lead_number,agent_id,call_id) VALUES ($1,$2,NULL) ON CONFLICT (lead_number) DO NOTHING RETURNING lead_number", [number, agentId]);
      if (claim.rowCount) { lead = row; to = number; break; }
    }
    if (!lead) throw new CallStartError("No uncalled, eligible leads remain.", 409);
    const connectionId = await connectionIdFor({ config, secret_ciphertext: agent.secret_ciphertext, credential_id: agent.credential_id }, client);
    const key = decryptCredential(agent.secret_ciphertext);
    const maxCallDuration = Math.max(0, Math.min(14400, Math.floor(Number(options.maxCallDurationSeconds || 0))));
    await client.query("INSERT INTO agent_calls (id,agent_id,status,telnyx_connection_id,lead_name,lead_number,dialing_source,max_call_duration_seconds,updated_at) VALUES ($1,$2,'INITIATED',$3,$4,$5,$6,$7,NOW())", [id,agentId,connectionId,value(lead,headers,["name","fullname","client"]),to,options.dialingSource || "DIRECT",maxCallDuration]);
    await client.query("UPDATE lead_claims SET call_id=$1 WHERE lead_number=$2 AND agent_id=$3", [id,to,agentId]);
    await client.query("COMMIT");
    reserved = { name: agent.name, to, from, key, connectionId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }

  const publicUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const webhook_url = publicUrl?.startsWith("https://") ? `${publicUrl}/api/telnyx/webhook` : undefined;
  let response: Response;
  try {
    response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST", headers: { Authorization: `Bearer ${reserved.key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: reserved.to, from: reserved.from, connection_id: reserved.connectionId, command_id: id,
        client_state: Buffer.from(JSON.stringify({ callId: id })).toString("base64"), ...(webhook_url ? { webhook_url } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    await pool.query("UPDATE agent_calls SET failure_reason=$1,updated_at=NOW() WHERE id=$2", ["Provider response uncertain. Awaiting call events; another call is blocked.",id]);
    throw new CallStartError("Call submission is still being confirmed. Another call is blocked until its status is resolved.", 503);
  }
  if (!response.ok) {
    // Only an explicit client rejection guarantees no call was placed.
    if (response.status >= 400 && response.status < 500) {
      await pool.query("UPDATE agent_calls SET status='FAILED',ended_at=NOW(),failure_reason=$1,updated_at=NOW() WHERE id=$2 AND status='INITIATED' AND telnyx_call_control_id IS NULL", [`Provider rejected the call (HTTP ${response.status}).`,id]);
      await pool.query("DELETE FROM lead_claims WHERE call_id=$1 AND EXISTS (SELECT 1 FROM agent_calls WHERE id=$1 AND status='FAILED')", [id]);
    } else {
      await pool.query("UPDATE agent_calls SET failure_reason=$1,updated_at=NOW() WHERE id=$2", ["Provider response uncertain. Awaiting call events.",id]);
    }
    throw new CallStartError(`Call could not be confirmed (HTTP ${response.status}). Check the call status before retrying.`, 502);
  }
  try {
    const body = await response.json();
    const call = body.data;
    if (!call?.call_control_id) throw new Error("Missing call control ID");
    await pool.query("UPDATE agent_calls SET telnyx_call_control_id=$1,telnyx_call_session_id=COALESCE($2,telnyx_call_session_id),updated_at=NOW() WHERE id=$3", [call.call_control_id,call.call_session_id ?? null,id]);
  } catch {
    throw new CallStartError("The provider accepted this call; status synchronization is pending. Do not retry.", 503);
  }
  return { id, name: reserved.name };
}
