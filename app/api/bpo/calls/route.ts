import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bpoEntitlements, bpoLeadUsage } from "@/lib/bpo-entitlements";
import { db } from "@/lib/database";
import { requireApprovedBpo } from "@/lib/bpo-session";
import { CallStartError, startAgentCall } from "@/lib/call-start";
import { agentCallCommand, agentCallDetail, saveAgentCallNotes } from "@/lib/agent-call-detail";
import { decryptCredential } from "@/app/api/admin/credentials/route";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid 24-hour time.");
const startSchema = z.object({ action: z.literal("start-agent"), agentId: z.string().uuid() });
const autoTickSchema = z.object({ action: z.literal("auto-tick") });
const settingsSchema = z.object({ action: z.literal("save-auto-settings"), isEnabled: z.boolean(), startTime: timeSchema, endTime: timeSchema, maxCallDurationMinutes: z.number().int().min(0).max(240) });
const callIdSchema = z.object({ id: z.string().uuid() });
const manualModes = "('MANUAL','BOTH')";
const bpoMessage = (message: string) => message.replace(/lead sheet/gi, "customer sheet");
type Mode = "MANUAL" | "AUTO";
type AutoSettings = { isEnabled: boolean; startTime: string; endTime: string; maxCallDurationMinutes: number };

function number(value: unknown) { return Number(value || 0); }
function e164(input: unknown) {
  const cleaned = String(input || "").trim().replace(/[\s()-]/g, "");
  const normalized = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : "";
}
function customerValue(row: unknown[], headers: string[], names: string[]) {
  const index = headers.findIndex(header => names.some(name => String(header).toLowerCase().replace(/[^a-z]/g, "").includes(name)));
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}
function extractTasks(text: string) {
  const lines = text.split(/\r?\n|(?<=[?.!])\s+(?=[A-Z])/).map(line => line.replace(/^[-•\d.)\s]+/, "").trim()).filter(line => line.length > 4);
  const start = lines.findIndex(line => /following details|following information|collect|confirm|take the following/i.test(line));
  const source = start >= 0 ? lines.slice(start + 1) : lines;
  const blocked = /^(if |you will have to|you must |please |when |the agent|call |hello |hi |thank |do not |never )/i;
  return [...new Set(source.filter(line => line.length < 180 && !blocked.test(line) && /[a-z]/i.test(line)))].slice(0, 20);
}
function taskProgress(row: Record<string, unknown>) {
  const tasks = extractTasks(String(row.script_text || ""));
  const transcript = String(row.transcript || "").split(/\r?\n/).filter(line => /^\s*(client|customer|user)\s*:/i.test(line)).join(" ");
  const evidence = `${String(row.summary || "")} ${String(row.notes || "")} ${transcript || String(row.transcript || "")}`.toLowerCase();
  const ignored = new Set(["with", "that", "this", "from", "your", "have", "will", "about", "please", "customer", "details", "information", "collect", "confirm"]);
  const completed = tasks.filter(task => task.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(word => word.length > 3 && !ignored.has(word)).some(word => evidence.includes(word))).length;
  return { collected: completed, total: tasks.length, percent: tasks.length ? Math.min(100, Math.round(completed / tasks.length * 100)) : 0 };
}
function karachiTime() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return `${parts.find(part => part.type === "hour")?.value || "00"}:${parts.find(part => part.type === "minute")?.value || "00"}`;
}
function inWindow(start: string, end: string, current: string) {
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
function normalizeTime(value: unknown) { return String(value || "09:00").slice(0, 5); }

async function autoSettingsFor(bpoId: string): Promise<AutoSettings> {
  const result = await (await db()).query("SELECT is_enabled,start_time::text start_time,end_time::text end_time,max_call_duration_seconds FROM bpo_auto_dialer_settings WHERE bpo_id=$1", [bpoId]);
  const row = result.rows[0];
  return { isEnabled: Boolean(row?.is_enabled), startTime: normalizeTime(row?.start_time), endTime: normalizeTime(row?.end_time || "17:00"), maxCallDurationMinutes: Math.round(number(row?.max_call_duration_seconds) / 60) };
}

async function planUsageFor(bpoId: string) {
  const client = await db();
  const [limits, usage] = await Promise.all([bpoEntitlements(client, bpoId), bpoLeadUsage(client, bpoId)]);
  return { calls: usage.calls, minutes: usage.minutes, limits: { calls: limits.calls, minutes: limits.minutes }, remaining: { calls: Math.max(0, limits.calls - usage.calls), minutes: Math.max(0, limits.minutes - usage.minutes) } };
}

async function ownerAgentForCall(callId: string, bpoId: string) {
  const result = await (await db()).query(`SELECT c.agent_id FROM agent_calls c JOIN bpo_created_agents b ON b.agent_id=c.agent_id WHERE c.id=$1 AND b.bpo_id=$2`, [callId, bpoId]);
  return String(result.rows[0]?.agent_id || "");
}

async function dialingAgents(bpoId: string, mode: Mode, usage: Awaited<ReturnType<typeof planUsageFor>>) {
  const client = await db();
  const [result, claimed] = await Promise.all([
    client.query(`SELECT a.id,a.name,COALESCE(a.avatar_url,'') avatar_url,a.status,b.is_active,b.dialing_mode,
      COALESCE(v.status,lv.status,'INACTIVE') voice_status,COALESCE(x.is_active,lv.status='ACTIVE',FALSE) voice_workspace_active,
      COALESCE(s.lead_file_name,'') customer_sheet_name,COALESCE(s.script_file_name,'') script_name,
      COALESCE(s.lead_headers,'[]'::jsonb) lead_headers,COALESCE(s.lead_rows,'[]'::jsonb) lead_rows,COALESCE(s.script_text,'') script_text,
      COALESCE(NULLIF(tc.config->>'outboundNumber',''),NULLIF(tc.config->>'outbound_number',''),NULLIF(tc.config->>'phoneNumber',''), '') outbound_number,
      EXISTS(SELECT 1 FROM agent_credentials x WHERE x.agent_id=a.id AND x.provider='TELNYX') has_telnyx,
      EXISTS(SELECT 1 FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id AND vc.owner_id=va.owner_id WHERE va.agent_id=a.id AND vc.live_config->>'enabled'='true') uses_vicidial,
      EXISTS(SELECT 1 FROM voip_agent_assignments va JOIN voip_connections vc ON vc.id=va.connection_id AND vc.owner_id=va.owner_id WHERE va.agent_id=a.id AND vc.enabled=TRUE AND vc.status='CONNECTED' AND vc.media_verified_at IS NOT NULL AND vc.live_config->>'enabled'='true' AND va.direction='OUTBOUND') vicidial_ready,
      EXISTS(SELECT 1 FROM vicidial_pool_agents q WHERE q.agent_id=a.id) is_queued,
      EXISTS(SELECT 1 FROM agent_credentials x WHERE x.agent_id=a.id AND x.provider='GROQ') has_knowledge,
      (SELECT c.id FROM agent_calls c WHERE c.agent_id=a.id AND c.status IN ('INITIATED','RINGING','ANSWERED') ORDER BY c.created_at DESC LIMIT 1) live_call_id,
      (SELECT c.status FROM agent_calls c WHERE c.agent_id=a.id AND c.status IN ('INITIATED','RINGING','ANSWERED') ORDER BY c.created_at DESC LIMIT 1) live_call_status,
      (SELECT COUNT(*)::int FROM agent_calls c WHERE c.agent_id=a.id AND c.call_type='LEAD') calls_made
      FROM bpo_created_agents b JOIN agents a ON a.id=b.agent_id
      LEFT JOIN local_voice_registry lv ON lv.id=a.local_voice_id AND (lv.is_global=TRUE OR lv.owner_id=b.bpo_id)
      LEFT JOIN admin_voices v ON v.id=b.voice_id LEFT JOIN bpo_voice_assignments x ON x.bpo_id=b.bpo_id AND x.voice_id=b.voice_id
      LEFT JOIN agent_credentials at ON at.agent_id=a.id AND at.provider='TELNYX' LEFT JOIN ai_credentials tc ON tc.id=at.credential_id
      LEFT JOIN LATERAL (SELECT lead_file_name,script_file_name,lead_headers,lead_rows,script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE
      WHERE b.bpo_id=$1 AND b.dialing_mode IN ($2,'BOTH') ORDER BY b.created_at DESC`, [bpoId, mode]),
    client.query("SELECT lead_number FROM lead_claims UNION SELECT phone_number AS lead_number FROM do_not_call"),
  ]);
  const unavailableNumbers = new Set(claimed.rows.map(row => String(row.lead_number || "")));
  return result.rows.map(row => {
    const headers = Array.isArray(row.lead_headers) ? row.lead_headers.map(String) : [];
    const rows: unknown[][] = Array.isArray(row.lead_rows) ? row.lead_rows.filter(Array.isArray) as unknown[][] : [];
    const nextCustomer = rows.map(values => ({ name: customerValue(values, headers, ["name", "fullname", "client", "customer"]), number: e164(customerValue(values, headers, ["phone", "mobile", "telephone", "number"])) })).find(customer => customer.number && !unavailableNumbers.has(customer.number));
    const quotaReason = !usage.limits.calls || !usage.remaining.calls ? "Your purchased call allowance has been reached."
      : !usage.limits.minutes || !usage.remaining.minutes ? "Your purchased minute allowance has been reached." : "";
    const blockedReason = row.live_call_id ? "This agent already has a live call."
      : quotaReason ? quotaReason
      : !row.is_active || row.status !== "APPROVED" ? "Activate this agent first."
      : row.voice_status !== "ACTIVE" || !row.voice_workspace_active ? "The assigned voice is inactive."
      : row.is_queued ? "Waiting for a VICIdial answered call."
      : row.uses_vicidial && !row.vicidial_ready ? "Complete VICIdial API and audio bridge verification in VoIP."
      : ((!row.uses_vicidial && (!row.has_telnyx || !row.has_knowledge)) || !String(row.script_text || "").trim()) ? "AI credentials and an agent script are required."
      : !row.uses_vicidial && !e164(row.outbound_number) ? "A valid VoIP outbound number is required."
      : !row.uses_vicidial && !nextCustomer ? "No eligible customer remains in this customer sheet."
      : "";
    return { is_queued:Boolean(row.is_queued), id: row.id, name: row.name, avatar_url: row.avatar_url, dialing_mode: row.dialing_mode, customer_sheet_name: row.uses_vicidial ? "Customers managed in VICIdial" : row.customer_sheet_name, script_name: row.script_name, calls_made: number(row.calls_made), live_call: row.live_call_id ? { id: row.live_call_id, status: row.live_call_status } : null, next_customer: nextCustomer ? { name: nextCustomer.name || "Unnamed customer", number: nextCustomer.number } : null, ready: !blockedReason, blocked_reason: blockedReason };
  });
}

async function callProgressFor(bpoId: string, mode: Mode) {
  const result = await (await db()).query(`SELECT c.id,c.status,c.lead_name,c.lead_number,c.duration_seconds,c.created_at,c.dialing_source,c.summary,c.notes,c.transcript,
    COALESCE(s.script_text,'') script_text FROM agent_calls c JOIN bpo_created_agents b ON b.agent_id=c.agent_id
    LEFT JOIN LATERAL (SELECT script_text FROM script_assignments WHERE agent_id=c.agent_id ORDER BY created_at DESC LIMIT 1) s ON TRUE
    WHERE b.bpo_id=$1 AND c.dialing_source=$2 ORDER BY c.created_at DESC LIMIT 30`, [bpoId, mode]);
  return result.rows.map(row => ({ id: row.id, status: row.status, customer_name: row.lead_name || "Unnamed customer", customer_number: row.lead_number || "", duration_seconds: number(row.duration_seconds), created_at: row.created_at, progress: taskProgress(row) }));
}

async function endActiveCalls(bpoId: string, reason: "timer" | "minutes") {
  const client = await db();
  const result = await client.query(`SELECT c.id,c.telnyx_call_control_id,t.secret_ciphertext,c.max_call_duration_seconds,c.answered_at
    FROM agent_calls c JOIN bpo_created_agents b ON b.agent_id=c.agent_id
    JOIN agent_credentials ac ON ac.agent_id=c.agent_id AND ac.provider='TELNYX' JOIN ai_credentials t ON t.id=ac.credential_id
    WHERE b.bpo_id=$1 AND c.status='ANSWERED' AND c.telnyx_call_control_id IS NOT NULL AND c.ending_requested=FALSE`, [bpoId]);
  const now = Date.now(); let ended = 0;
  for (const call of result.rows) {
    const timedOut = number(call.max_call_duration_seconds) > 0 && call.answered_at && now - new Date(call.answered_at).getTime() >= number(call.max_call_duration_seconds) * 1000;
    if (reason === "timer" && !timedOut) continue;
    try {
      const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(call.telnyx_call_control_id)}/actions/hangup`, { method: "POST", headers: { Authorization: `Bearer ${decryptCredential(call.secret_ciphertext)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ command_id: randomUUID() }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) continue;
      await client.query("UPDATE agent_calls SET conversation_state='ENDING',ending_requested=TRUE,updated_at=NOW() WHERE id=$1", [call.id]);
      ended++;
    } catch { /* The next auto tick may safely retry a provider timeout. */ }
  }
  return ended;
}

async function runAutoDialer(bpoId: string) {
  const settings = await autoSettingsFor(bpoId);
  const currentTime = karachiTime();
  const usage = await planUsageFor(bpoId);
  const timedOut = await endActiveCalls(bpoId, "timer");
  if (usage.limits.minutes && usage.minutes >= usage.limits.minutes) {
    const limited = await endActiveCalls(bpoId, "minutes");
    return { settings, currentTime, started: 0, timedOut: timedOut + limited, reason: "Your purchased minute allowance has been reached." };
  }
  if (!settings.isEnabled) return { settings, currentTime, started: 0, timedOut, reason: "Auto dialer is paused." };
  if (!inWindow(settings.startTime, settings.endTime, currentTime)) return { settings, currentTime, started: 0, timedOut, reason: "Outside your scheduled auto dialing window." };
  if (!usage.limits.calls || !usage.remaining.calls) return { settings, currentTime, started: 0, timedOut, reason: "Your purchased call allowance has been reached." };
  const agents = await dialingAgents(bpoId, "AUTO", usage);
  let started = 0;
  for (const agent of agents.filter(agent => agent.ready)) {
    try {
      await startAgentCall(agent.id, { bpoId, dialingSource: "AUTO", maxCallDurationSeconds: settings.maxCallDurationMinutes * 60 });
      started++;
    } catch (error) {
      if (error instanceof CallStartError && /allowance/i.test(error.message)) break;
    }
  }
  return { settings, currentTime, started, timedOut, reason: started ? "" : "No ready auto dialing agent is currently available." };
}

export async function GET(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  try {
    const url = new URL(request.url), id = url.searchParams.get("id");
    if (id) {
      if (!z.string().uuid().safeParse(id).success) return Response.json({ message: "Invalid call ID." }, { status: 400 });
      const agentId = await ownerAgentForCall(id, session.agentId);
      return agentId ? agentCallDetail(id, agentId) : Response.json({ message: "Call not found." }, { status: 404 });
    }
    if (url.searchParams.get("view") === "dialing") {
      const mode: Mode = url.searchParams.get("mode") === "AUTO" ? "AUTO" : "MANUAL";
      const [usage, settings] = await Promise.all([planUsageFor(session.agentId), autoSettingsFor(session.agentId)]);
      const [agents, callProgress] = await Promise.all([dialingAgents(session.agentId, mode, usage), callProgressFor(session.agentId, mode)]);
      return Response.json({ agents, callProgress, usage, autoSettings: settings, currentTime: karachiTime(), scheduleActive: settings.isEnabled && inWindow(settings.startTime, settings.endTime, karachiTime()), mode }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const client = await db();
    const [calls, metrics] = await Promise.all([
      client.query(`SELECT c.id,c.call_type,c.status,c.lead_name,c.lead_number,c.duration_seconds,c.outcome,c.created_at,c.recording_url,c.summary,c.transcript,a.name agent_name,COALESCE(a.avatar_url,'') agent_avatar
        FROM agent_calls c JOIN agents a ON a.id=c.agent_id LEFT JOIN bpo_created_agents b ON b.agent_id=c.agent_id
        WHERE (c.call_type='LEAD' AND b.bpo_id=$1) OR (c.call_type='QUICK_DIAL' AND c.agent_id=$1) ORDER BY c.created_at DESC LIMIT 100`, [session.agentId]),
      client.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE c.created_at >= date_trunc('day',NOW()))::int today,COUNT(*) FILTER (WHERE c.status='COMPLETED')::int completed,COUNT(*) FILTER (WHERE c.recording_url IS NOT NULL AND c.recording_url <> '')::int recordings,COUNT(*) FILTER (WHERE c.outcome IS NOT NULL AND c.outcome <> '')::int outcomes
        FROM agent_calls c LEFT JOIN bpo_created_agents b ON b.agent_id=c.agent_id
        WHERE (c.call_type='LEAD' AND b.bpo_id=$1) OR (c.call_type='QUICK_DIAL' AND c.agent_id=$1)`, [session.agentId]),
    ]);
    return Response.json({ calls: calls.rows, metrics: metrics.rows[0] || {} }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { console.error("BPO call data failed", error); return Response.json({ message: "Unable to load call data." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if(body?.action==='stop-agent'&&typeof body.agentId==='string'){
    const owned=await (await db()).query("SELECT agent_id FROM bpo_created_agents WHERE agent_id=$1 AND bpo_id=$2",[body.agentId,session.agentId]);
    if(!owned.rows[0])return Response.json({message:"Agent not found"},{status:404});
    try{await (await import("@/lib/vicidial-live")).stopVicidialAgent(body.agentId,{disableAssignment:true});return Response.json({message:"VICIdial queue stopped."});}
    catch{return Response.json({message:"Remote agent stop could not be confirmed; check VICIdial."},{status:503});}
  }
  const start = startSchema.safeParse(body), autoTick = autoTickSchema.safeParse(body), settings = settingsSchema.safeParse(body);
  try {
    if (settings.success) {
      await (await db()).query(`INSERT INTO bpo_auto_dialer_settings (bpo_id,is_enabled,start_time,end_time,max_call_duration_seconds,updated_at) VALUES ($1,$2,$3::time,$4::time,$5,NOW()) ON CONFLICT (bpo_id) DO UPDATE SET is_enabled=EXCLUDED.is_enabled,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,max_call_duration_seconds=EXCLUDED.max_call_duration_seconds,updated_at=NOW()`, [session.agentId, settings.data.isEnabled, settings.data.startTime, settings.data.endTime, settings.data.maxCallDurationMinutes * 60]);
      return Response.json({ message: settings.data.isEnabled ? "Auto dialer schedule is active." : "Auto dialer schedule is paused.", autoSettings: await autoSettingsFor(session.agentId) });
    }
    if (autoTick.success) {
      const result = await runAutoDialer(session.agentId);
      return Response.json({ message: result.started ? `${result.started} auto call${result.started === 1 ? "" : "s"} started.` : result.reason, ...result });
    }
    if (start.success) {
      const owned = await (await db()).query(`SELECT b.agent_id FROM bpo_created_agents b JOIN agents a ON a.id=b.agent_id WHERE b.agent_id=$1 AND b.bpo_id=$2 AND b.is_active=TRUE AND b.dialing_mode IN ${manualModes} AND a.status='APPROVED'`, [start.data.agentId, session.agentId]);
      if (!owned.rows[0]) return Response.json({ message: "Choose an active agent enabled for manual dialing." }, { status: 403 });
      const call = await startAgentCall(start.data.agentId, { bpoId: session.agentId, dialingSource: "MANUAL" });
      return Response.json({ message: "queued" in call ? `${call.name} is ready for VICIdial answered calls.` : `${call.name} is calling the next customer.`, callId: "queued" in call ? undefined : call.id, queued: "queued" in call }, { status: 201 });
    }
    const command = callIdSchema.safeParse(body);
    if (!command.success) return Response.json({ message: "Invalid call action." }, { status: 400 });
    const agentId = await ownerAgentForCall(command.data.id, session.agentId);
    return agentId ? agentCallCommand(body, agentId) : Response.json({ message: "Call not found." }, { status: 404 });
  } catch (error) { console.error("BPO call action failed", error); return Response.json({ message: error instanceof CallStartError ? bpoMessage(error.message) : "Call action failed. Please check call status before retrying." }, { status: error instanceof CallStartError ? error.status : 503 }); }
}

export async function PATCH(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null), parsed = callIdSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: "Invalid notes." }, { status: 400 });
  const agentId = await ownerAgentForCall(parsed.data.id, session.agentId);
  if (!agentId) return Response.json({ message: "Call not found." }, { status: 404 });
  try { return await saveAgentCallNotes(body, agentId); } catch { return Response.json({ message: "Unable to save notes." }, { status: 503 }); }
}
