import { withNativeLiveCalls } from "@/lib/native-live-calls";
import { startAgentCall, syncLiveAssistantTranscript } from "@/lib/call-start";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { decryptCredential } from "@/lib/credential-crypto";

export const runtime = "nodejs";
export const maxDuration = 300;
const timeValue = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const actions = z.discriminatedUnion("action", [z.object({ action: z.literal("pause-all") }), z.object({ action: z.literal("start-all") }), z.object({ action: z.literal("stop-agent"), agentId: z.string().min(1) }), z.object({ action: z.literal("start-agent"), agentId: z.string().min(1) }), z.object({ action: z.literal("run-schedules") }), z.object({ action: z.literal("save-schedule"), agentId: z.string().min(1), isEnabled: z.boolean(), startTime: timeValue, endTime: timeValue }), z.object({ action: z.literal("hangup"), id: z.string().uuid() }), z.object({ action: z.literal("hangup-all") }), z.object({ action: z.enum(["record-start", "record-stop", "hold", "resume", "transfer", "sync-comments"]), id: z.string().uuid() })]);

async function admin() { const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value); return session?.role === "ADMIN" ? session : null; }
function value(row: string[], headers: string[], names: string[]) { const index = headers.findIndex(header => names.some(name => header.toLowerCase().replace(/[^a-z]/g, "").includes(name))); return index >= 0 ? String(row[index] ?? "").trim() : ""; }
function e164(number: string) {
  const cleaned = String(number ?? "").trim().replace(/[\s()-]/g, "");
  const normalized = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : "";
}
function nextUncalledLead(rows: string[][], headers: string[], claimedNumbers: Set<string>) {
  return rows.find(row => {
    const number = e164(value(row, headers, ["phone", "mobile", "telephone", "number"]));
    return number && !claimedNumbers.has(number);
  });
}
function pakistanTime() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return `${parts.find(part => part.type === "hour")?.value || "00"}:${parts.find(part => part.type === "minute")?.value || "00"}`;
}
function timeMinutes(value: unknown) { const match = String(value || "").match(/^(\d{2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : 0; }
function inWindow(start: unknown, end: unknown, current = pakistanTime()) { const from = timeMinutes(start), to = timeMinutes(end), now = timeMinutes(current); return from === to || (from < to ? now >= from && now < to : now >= from || now < to); }
async function telnyx(url: string, key: string, body?: unknown) { const result = await fetch(`https://api.telnyx.com/v2${url}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); const json = await result.json().catch(() => ({})); if (!result.ok) throw new Error(json?.errors?.[0]?.detail || json?.errors?.[0]?.title || `Telnyx request failed (${result.status}).`); return json; }
export async function GET(request: Request) {
  const session=await admin(); if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  const params=new URL(request.url).searchParams;
  if(params.get('updates')==='1'){
    const live=await client.query(`SELECT c.transfer_status,c.voip_connection_id,c.vicidial_call_id,c.ai_leg_released,c.direct_audio_line,c.recording_serial,c.id,c.agent_id,c.status,c.conversation_state,c.created_at,c.answered_at,c.ended_at,c.updated_at,c.duration_seconds,c.lead_name,c.lead_number,c.recording_url,c.recording_active,c.on_hold,c.summary,RIGHT(c.transcript,1500) transcript,a.name agent_name,
      COUNT(*) FILTER(WHERE c.created_at>=date_trunc('day',NOW())) OVER()::int calls_today,
      COUNT(*) FILTER(WHERE c.status='COMPLETED') OVER()::int completed
      FROM agent_calls c JOIN agents a ON a.id=c.agent_id WHERE c.call_type='LEAD' AND NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)
      ORDER BY (c.status IN ('INITIATED','RINGING','ANSWERED')) DESC,c.created_at DESC LIMIT 100`);
    const native=await withNativeLiveCalls(live.rows,"admin",session.agentId);
    return Response.json({updatesOnly:true,...native,metrics:{calls_today:live.rows[0]?.calls_today||0,completed:live.rows[0]?.completed||0},currentTime:pakistanTime()},{headers:{'Cache-Control':'no-store'}});
  }
  const requestedId = new URL(request.url).searchParams.get("id");
  const callFilter = requestedId && /^[0-9a-f-]{36}$/i.test(requestedId) ? " AND c.id=$1" : "";
  const [result, ready, roster, metrics, claims] = await Promise.all([
    client.query(`SELECT c.voip_connection_id,c.vicidial_call_id,c.agent_id,c.ai_leg_released,c.telephony_provider,c.collected_fields,c.vicidial_sync_status,c.transfer_status,c.transfer_consent,c.script_snapshot,c.recording_serial,c.id,c.status,c.conversation_state,c.failure_reason,c.lead_name,c.lead_number,c.recording_url,c.recording_id,c.recording_active,c.on_hold,c.duration_seconds,c.summary,c.notes,c.start_note,c.mid_note,c.final_note,c.outcome,c.transcript,c.conversation_history,c.created_at,c.answered_at,c.ended_at,c.updated_at,a.name agent_name,COALESCE(a.avatar_url,'') agent_avatar,COALESCE(ac.config->>'outboundNumber','') agent_number,CASE WHEN c.telephony_provider='AUDIOSOCKET' THEN 'Direct AudioSocket' WHEN c.telephony_provider='VICIDIAL' THEN 'VICIdial' ELSE COALESCE(tc.label,'Telnyx') END telnyx_credential,COALESCE(gc.label,'Not assigned') groq_credential FROM agent_calls c JOIN agents a ON a.id=c.agent_id LEFT JOIN agent_credentials at ON at.agent_id=a.id AND at.provider='TELNYX' LEFT JOIN ai_credentials ac ON ac.id=at.credential_id LEFT JOIN ai_credentials tc ON tc.id=at.credential_id LEFT JOIN agent_credentials ag ON ag.agent_id=a.id AND ag.provider='GROQ' LEFT JOIN ai_credentials gc ON gc.id=ag.credential_id WHERE c.call_type='LEAD' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)${callFilter} ORDER BY c.created_at DESC LIMIT 100`, requestedId ? [requestedId] : []),
    client.query(`SELECT a.id,a.name,a.local_voice_id,(SELECT name FROM local_voice_registry lv WHERE lv.id=a.local_voice_id) local_voice_name,COALESCE(a.avatar_url,'') avatar_url,a.status,((BTRIM(a.agent_script)<>'' OR EXISTS (SELECT 1 FROM script_assignments script WHERE script.agent_id=a.id AND BTRIM(script.script_text)<>'')) AND EXISTS (SELECT 1 FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id AND vc.owner_id=va.owner_id WHERE va.agent_id=a.id AND vc.enabled=TRUE AND vc.status='CONNECTED')) setup_ready,COALESCE(tc.label,'Telnyx') telnyx_credential,COALESCE(gc.label,'Optional') groq_credential,COALESCE(tc.config->>'outboundNumber','') outbound_number,s.lead_headers,s.lead_rows,(SELECT COUNT(*)::int FROM agent_calls x WHERE x.agent_id=a.id AND x.call_type='LEAD') dialed_calls FROM agents a JOIN LATERAL (SELECT lead_headers,lead_rows FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE LEFT JOIN agent_credentials at ON at.agent_id=a.id AND at.provider='TELNYX' LEFT JOIN ai_credentials tc ON tc.id=at.credential_id LEFT JOIN agent_credentials ag ON ag.agent_id=a.id AND ag.provider='GROQ' LEFT JOIN ai_credentials gc ON gc.id=ag.credential_id WHERE a.role='AGENT' AND a.deleted_at IS NULL AND a.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) AND NOT EXISTS (SELECT 1 FROM agent_calls x WHERE x.agent_id=a.id AND x.status IN ('INITIATED','RINGING','ANSWERED')) AND tc.id IS NOT NULL AND gc.id IS NOT NULL AND (BTRIM(a.agent_script)<>'' OR EXISTS (SELECT 1 FROM script_assignments script WHERE script.agent_id=a.id AND BTRIM(script.script_text)<>'')) AND EXISTS (SELECT 1 FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id AND vc.owner_id=va.owner_id WHERE va.agent_id=a.id AND vc.enabled=TRUE AND vc.status='CONNECTED')`),
    client.query(`SELECT a.id,a.name,a.local_voice_id,(SELECT name FROM local_voice_registry lv WHERE lv.id=a.local_voice_id) local_voice_name,COALESCE(a.avatar_url,'') avatar_url,a.status,((BTRIM(a.agent_script)<>'' OR EXISTS (SELECT 1 FROM script_assignments script WHERE script.agent_id=a.id AND BTRIM(script.script_text)<>'')) AND EXISTS (SELECT 1 FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id AND vc.owner_id=va.owner_id WHERE va.agent_id=a.id AND vc.enabled=TRUE AND vc.status='CONNECTED')) setup_ready,COALESCE(tc.label,'Telnyx') telnyx_credential,COALESCE(gc.label,'Not assigned') groq_credential,COALESCE(tc.config->>'outboundNumber','') outbound_number,s.lead_headers,s.lead_rows,(SELECT COUNT(*)::int FROM agent_calls x WHERE x.agent_id=a.id AND x.call_type='LEAD') dialed_calls, EXISTS (SELECT 1 FROM agent_calls x WHERE x.agent_id=a.id AND x.status IN ('INITIATED','RINGING','ANSWERED')) is_running,COALESCE(sch.is_enabled,FALSE) schedule_enabled,COALESCE(sch.start_time::text,'09:00') schedule_start_time,COALESCE(sch.end_time::text,'17:00') schedule_end_time FROM agents a LEFT JOIN LATERAL (SELECT lead_headers,lead_rows FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE LEFT JOIN agent_credentials at ON at.agent_id=a.id AND at.provider='TELNYX' LEFT JOIN ai_credentials tc ON tc.id=at.credential_id LEFT JOIN agent_credentials ag ON ag.agent_id=a.id AND ag.provider='GROQ' LEFT JOIN ai_credentials gc ON gc.id=ag.credential_id LEFT JOIN agent_call_schedules sch ON sch.agent_id=a.id WHERE a.role='AGENT' AND a.deleted_at IS NULL AND a.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) ORDER BY a.created_at DESC`),
    client.query(`SELECT COUNT(*) FILTER (WHERE call_type='LEAD' AND created_at >= date_trunc('day', NOW()))::int AS calls_today, COUNT(*) FILTER (WHERE call_type='LEAD' AND status='COMPLETED')::int AS completed FROM agent_calls c WHERE NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)`),
    client.query("SELECT lead_number FROM lead_claims UNION SELECT phone_number AS lead_number FROM do_not_call")
  ]);
  if (requestedId && result.rows[0]) {
    const scriptLead = await client.query("SELECT s.lead_headers,s.script_text FROM agent_calls c JOIN LATERAL (SELECT lead_headers,script_text FROM script_assignments WHERE agent_id=c.agent_id ORDER BY created_at DESC LIMIT 1) s ON TRUE WHERE c.id=$1 AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)", [requestedId]);
    result.rows[0].script_lead_headers = scriptLead.rows[0]?.lead_headers || [];
    result.rows[0].script_text = result.rows[0].script_snapshot?.script || scriptLead.rows[0]?.script_text || "";
    const assistantCall = await client.query("SELECT id,telnyx_ai_conversation_id FROM agent_calls c WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id) LIMIT 1", [requestedId]);
    if (assistantCall.rows[0]) { result.rows[0].telnyx_ai_conversation_id = assistantCall.rows[0].telnyx_ai_conversation_id; await syncLiveAssistantTranscript(result.rows[0], client); }
  }
  const claimedNumbers = new Set(claims.rows.map(row => e164(String(row.lead_number || ""))).filter(Boolean));
  const readyAgents = ready.rows.map(agent => {
    const headers = Array.isArray(agent.lead_headers) ? (agent.lead_headers as string[]) : [];
    const rows = Array.isArray(agent.lead_rows) ? (agent.lead_rows as string[][]) : [];
    const lead = nextUncalledLead(rows, headers, claimedNumbers);
    return {
      id: agent.id,
      name: agent.name,
      avatar_url: agent.avatar_url,
      telnyx_credential: agent.telnyx_credential,
      groq_credential: agent.groq_credential,
      outbound_number: agent.outbound_number,
      lead_name: lead ? value(lead, headers, ["name", "fullname", "client"]) : "",
      lead_number: lead ? e164(value(lead, headers, ["phone", "mobile", "telephone", "number"])) : "",
      dialed_calls: Number(agent.dialed_calls || 0),
      status: agent.status,
      is_running: false
    };
  });
  const currentTime = pakistanTime();
  const allAgents = roster.rows.map(agent => { const headers = Array.isArray(agent.lead_headers) ? (agent.lead_headers as string[]) : []; const rows = Array.isArray(agent.lead_rows) ? (agent.lead_rows as string[][]) : []; const lead = nextUncalledLead(rows, headers, claimedNumbers); const telnyx = String(agent.telnyx_credential || "Telnyx"); const groq = String(agent.groq_credential || "Optional"); const leadNumber = lead ? e164(value(lead, headers, ["phone", "mobile", "telephone", "number"])) : ""; const hasTelnyx = Boolean(agent.telnyx_credential && agent.telnyx_credential !== "Telnyx"); const scheduleEnabled = false; return { id: agent.id, name: agent.name, avatar_url: agent.avatar_url, local_voice_id:agent.local_voice_id, local_voice_name:agent.local_voice_name||agent.local_voice_id, extension_route:"",remote_user:"",campaign_name:"",telnyx_credential: telnyx, groq_credential: groq, outbound_number: String(agent.outbound_number || ""), lead_name: lead ? value(lead, headers, ["name", "fullname", "client"]) : "", lead_number: leadNumber, dialed_calls: Number(agent.dialed_calls || 0), status: String(agent.status || "PENDING"), is_running: Boolean(agent.is_running), is_ready: Boolean(agent.status === "APPROVED" && agent.setup_ready && !agent.is_running && agent.outbound_number && leadNumber && hasTelnyx), schedule: { isEnabled: scheduleEnabled, startTime: String(agent.schedule_start_time).slice(0, 5), endTime: String(agent.schedule_end_time).slice(0, 5), isActive: scheduleEnabled && inWindow(agent.schedule_start_time, agent.schedule_end_time, currentTime) } }; });
  const viciSetups=await client.query(`SELECT v.agent_id,c.id connection_id,c.name,c.live_config,c.enabled,c.status,c.media_verified_at,v.campaign_id,q.agent_id queued_agent_id,q.ready queue_ready,q.remote_user,d.name campaign_name,COALESCE(k.name,pk.name) campaign_category
    FROM voip_agent_assignments v JOIN voip_connections c ON c.id=v.connection_id AND c.owner_id=v.owner_id
    LEFT JOIN vicidial_pool_agents q ON q.agent_id=v.agent_id LEFT JOIN campaign_agent_assignments x ON x.agent_id=v.agent_id LEFT JOIN campaign_definitions d ON d.id=x.campaign_id LEFT JOIN campaign_categories k ON k.id=d.category_id LEFT JOIN agent_campaign_preferences pref ON pref.agent_id=v.agent_id LEFT JOIN campaign_categories pk ON pk.id=pref.category_id WHERE c.live_config->>'enabled'='true'`);
  for(const agent of allAgents){const v=viciSetups.rows.find(v=>v.agent_id===agent.id);if(!v)continue;
    const setup=roster.rows.find(r=>r.id===agent.id);
    agent.telnyx_credential=`VICIdial ? ${v.name}`;agent.groq_credential="Shared testing engine";agent.outbound_number=v.campaign_id;
    const line=(v.live_config?.directAudioLines||[]).find((line:{agentId:string})=>line.agentId===agent.id);
    Object.assign(agent,{is_queued:Boolean(v.queued_agent_id),telephony_provider:"VICIDIAL",extension_route:line?.prefix||"",remote_user:line?.remoteUser||v.remote_user||"",campaign_name:v.campaign_name||v.campaign_id,campaign_category:v.campaign_category||""});
    agent.is_ready=Boolean(agent.status==='APPROVED'&&Boolean(v.campaign_id)&&setup?.local_voice_id&&v.enabled&&v.status==='CONNECTED'&&v.media_verified_at&&!agent.is_running&&!v.queued_agent_id&&(!v.live_config?.directAudioMode||Boolean(line)));
    if(agent.is_ready&&!readyAgents.some(r=>r.id===agent.id))readyAgents.push({...agent,lead_name:agent.lead_name,lead_number:agent.lead_number,is_running:false});
  }
  const native=requestedId?{calls:result.rows}:await withNativeLiveCalls(result.rows,"admin",session.agentId);
  return Response.json({ ...native, readyAgents, allAgents, currentTime, metrics: metrics.rows[0] ?? { calls_today: 0, completed: 0 } });
}

export async function POST(request: Request) {
  if (!await admin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = actions.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ message: "Invalid call action." }, { status: 400 });
  const client = await db();
  if (parsed.data.action === "pause-all") {
    const agents = await client.query("SELECT DISTINCT a.id FROM agents a JOIN campaign_agent_assignments x ON x.agent_id=a.id WHERE NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id) UNION SELECT q.agent_id AS id FROM vicidial_pool_agents q WHERE NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=q.agent_id)");
    const failed: string[] = [];
    for (const agent of agents.rows) {
      try { await (await import("@/lib/vicidial-live")).stopVicidialAgent(agent.id, { disableAssignment: true }); }
      catch { failed.push(agent.id); }
    }
    return Response.json({ message: failed.length ? `Pause unconfirmed for ${failed.length} agent(s). Retry before relying on the pause.` : "New VICIdial calls paused. Current calls will continue. Use Start all ready agents to resume.", failed }, { status: failed.length ? 503 : 200 });
  }
  if (parsed.data.action === "stop-agent") {
    const owned=await client.query("SELECT id FROM agents a WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)",[parsed.data.agentId]);
    if(!owned.rows[0])return Response.json({message:"Agent not found"},{status:404});
    try {await (await import("@/lib/vicidial-live")).stopVicidialAgent(parsed.data.agentId,{disableAssignment:true});return Response.json({message:"VICIdial queue stopped. An already connected customer call can finish."});}
    catch {return Response.json({message:"Unable to stop the remote agent; check VICIdial before retrying"},{status:503});}
  }
  if(parsed.data.action==='save-schedule')return Response.json({message:'Scheduling is currently disabled. Start agents manually from Live calls.'},{status:410});
  if(parsed.data.action==='run-schedules')return Response.json({started:[],failed:[],schedulingDisabled:true});
  if (parsed.data.action === "hangup-all") {
    const queued=await client.query("SELECT q.agent_id FROM vicidial_pool_agents q WHERE NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=q.agent_id)");
    const viciLive=await client.query("SELECT id FROM agent_calls c WHERE telephony_provider IN ('VICIDIAL','AUDIOSOCKET') AND status='ANSWERED' AND NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)");
    try {for(const q of queued.rows)await (await import("@/lib/vicidial-live")).stopVicidialAgent(q.agent_id,{disableAssignment:true});
      for(const call of viciLive.rows){const response=await (await import("@/lib/vicidial-controls")).vicidialCallCommand(call.id,"hangup");if(response&&!response.ok)return response;}
    }catch{return Response.json({message:"A VICIdial stop could not be confirmed. Check the dialer."},{status:503});}

    const found = await client.query("SELECT c.recording_serial,c.id,c.telnyx_call_control_id,ac.secret_ciphertext FROM agent_calls c JOIN agent_credentials a ON a.agent_id=c.agent_id AND a.provider='TELNYX' JOIN ai_credentials ac ON ac.id=a.credential_id WHERE c.status IN ('INITIATED','RINGING','ANSWERED') AND c.telnyx_call_control_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)");
    const failed: string[] = [];
    const endedIds: string[] = [];
    for (const call of found.rows) { try { await telnyx(`/calls/${encodeURIComponent(call.telnyx_call_control_id)}/actions/hangup`, decryptCredential(call.secret_ciphertext), { command_id: randomUUID() }); endedIds.push(call.id); } catch (error) { failed.push(error instanceof Error ? error.message : "Unknown hangup error"); } }
    if (endedIds.length) await client.query("UPDATE agent_calls SET conversation_state='ENDING',ending_requested=TRUE,updated_at=NOW() WHERE id = ANY($1::text[])", [endedIds]);
    return Response.json({ message: `${found.rows.length - failed.length + viciLive.rows.length} call ending request(s) sent.${failed.length ? ` ${failed.length} remote hangup(s) failed.` : ""}`, ended: found.rows.length - failed.length + viciLive.rows.length }, { status: failed.length === found.rows.length && found.rows.length ? 400 : 200 });
  }
  if (parsed.data.action !== "start-all" && parsed.data.action !== "start-agent") {
    const vici = await (await import("@/lib/vicidial-controls")).vicidialCallCommand(parsed.data.id,parsed.data.action,undefined,true);
    if(vici)return vici;
    const found = await client.query("SELECT c.recording_serial,c.id,c.telnyx_call_control_id,ac.secret_ciphertext FROM agent_calls c JOIN agent_credentials a ON a.agent_id=c.agent_id AND a.provider='TELNYX' JOIN ai_credentials ac ON ac.id=a.credential_id WHERE c.id=$1 AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)", [parsed.data.id]);
    const call = found.rows[0]; if (!call?.telnyx_call_control_id) return Response.json({ message: "Telnyx call control ID is not available yet." }, { status: 409 });
    try {
      const command = parsed.data.action === "hangup" ? "hangup" : parsed.data.action === "record-stop" ? "record_stop" : parsed.data.action === "record-start" ? "record_start" : parsed.data.action === "resume" ? "unhold" : "hold";
      await telnyx(`/calls/${encodeURIComponent(call.telnyx_call_control_id)}/actions/${command}`, decryptCredential(call.secret_ciphertext), parsed.data.action === "record-start" ? { format: "mp3", channels: "dual", recording_track: "both", play_beep: false, command_id: randomUUID() } : { command_id: randomUUID() });
      if (parsed.data.action === "hangup") await client.query("UPDATE agent_calls SET conversation_state='ENDING',ending_requested=TRUE,updated_at=NOW() WHERE id=$1", [call.id]);
      if (parsed.data.action === "record-start" || parsed.data.action === "record-stop") await client.query("UPDATE agent_calls SET recording_active=$1,updated_at=NOW() WHERE id=$2", [parsed.data.action === "record-start", call.id]);
      if (parsed.data.action === "hold" || parsed.data.action === "resume") await client.query("UPDATE agent_calls SET on_hold=$1,conversation_state=$2,updated_at=NOW() WHERE id=$3", [parsed.data.action === "hold", parsed.data.action === "hold" ? "ON_HOLD" : "LISTENING", call.id]);
      return Response.json({ message: parsed.data.action === "hangup" ? "Ending call. Waiting for confirmation." : parsed.data.action === "record-stop" ? "Recording stopped." : parsed.data.action === "record-start" ? "Recording started." : parsed.data.action === "hold" ? "Call placed on hold." : "Call resumed." });
    } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "Telnyx command failed." }, { status: 400 }); }
  }
  let agentIds: string[];
  if (parsed.data.action === "start-agent") {
    const selected = await client.query("SELECT id FROM agents a WHERE id=$1 AND deleted_at IS NULL AND role='AGENT' AND status='APPROVED' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)", [parsed.data.agentId]);
    if (!selected.rows[0]) return Response.json({ message: "Agent not found." }, { status: 404 });
    agentIds = [parsed.data.agentId];
  } else {
    agentIds = (await client.query("SELECT id FROM agents a WHERE role='AGENT' AND deleted_at IS NULL AND status='APPROVED' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)")).rows.map(row => String(row.id));
  }
  const started: string[] = [], failed: string[] = [], callIds: string[] = [];
  for (const agentId of agentIds) {
    try { const call = await startAgentCall(agentId); started.push(call.name); if (!("queued" in call)) callIds.push(call.id); }
    catch (error) { failed.push(error instanceof Error ? error.message : "Call could not start."); }
  }
  return Response.json({ message: started.length ? `${started.length} agent(s) started. VICIdial agents wait for answered calls.` : failed[0] || "No ready agents.", started, failed, callIds }, { status: started.length ? 201 : 409 });
}

const updateSchema = z.object({ id: z.string().uuid(), notes: z.string().max(10000).optional(), summary: z.string().max(10000).optional() });
export async function PATCH(request: Request) {
  if (!await admin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ message: "Invalid call notes." }, { status: 400 });
  const value = parsed.data, result = await (await db()).query("UPDATE agent_calls c SET notes=COALESCE($1,notes),summary=COALESCE($2,summary),updated_at=NOW() WHERE id=$3 AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id) RETURNING id", [value.notes, value.summary, value.id]);
  return result.rows[0] ? Response.json({ message: "Call notes saved." }) : Response.json({ message: "Call not found." }, { status: 404 });
}
