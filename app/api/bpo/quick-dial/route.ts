import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { cookies } from "next/headers";
import { z } from "zod";
import { bpoUsagePricing } from "@/lib/bpo-entitlements";
import { db } from "@/lib/database";
import { requireApprovedBpo } from "@/lib/bpo-session";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { decryptCredential } from "@/app/api/admin/credentials/route";

export const runtime = "nodejs";

const callIdSchema = z.string().uuid();
const e164Schema = z.string().trim().refine(value => /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s()-]/g, "")), "Enter a complete phone number with country code, for example +14155550123.");
const updateStatuses = ["INITIATED", "RINGING", "ANSWERED", "COMPLETED", "FAILED"] as const;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

type TelephonyConfig = { apiKey: string; connectionId: string; callerNumber: string };
type QuickDialPrincipal = { id: string; portal: "admin" | "bpo" };

async function requireQuickDialPrincipal(request: Request): Promise<QuickDialPrincipal | null> {
  if (!new URL(request.url).pathname.startsWith("/api/admin/")) {
    const bpo = await requireApprovedBpo();
    return bpo ? { id: bpo.agentId, portal: "bpo" } : null;
  }
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || session.role !== "ADMIN") return null;
  const result = await (await db()).query("SELECT id,admin_role,admin_permissions FROM agents WHERE id=$1 AND role='ADMIN' AND status='APPROVED' LIMIT 1", [session.agentId]);
  const admin = result.rows[0] as { id: string; admin_role?: string; admin_permissions?: string[] } | undefined;
  if (!admin || (admin.admin_role !== "SUPER_ADMIN" && !admin.admin_permissions?.includes("quickdial"))) return null;
  return { id: admin.id, portal: "admin" };
}

function e164(value: unknown) {
  const cleaned = String(value || "").trim().replace(/[\s()-]/g, "");
  const normalized = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : "";
}

function providerError(body: unknown, fallback: string) {
  const item = Array.isArray((body as { errors?: unknown })?.errors) ? (body as { errors: Array<{ detail?: unknown; title?: unknown }> }).errors[0] : undefined;
  return String(item?.detail || item?.title || (body as { message?: unknown })?.message || fallback);
}

async function telnyx(path: string, apiKey: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json, text/plain", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let body: unknown = raw;
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* The credential-token endpoint returns a plain-text JWT. */ }
  if (!response.ok) throw new Error(providerError(body, `Telnyx request failed (${response.status}).`));
  return body as string | { data?: Record<string, unknown> | Array<Record<string, unknown>> };
}

async function storedVoiceConfig(accountId: string, portal: QuickDialPrincipal["portal"]) {
  if (portal === "admin") {
    const result = await (await db()).query("SELECT secret_ciphertext,config FROM ai_credentials WHERE provider='TELNYX' ORDER BY updated_at DESC LIMIT 1");
    const row = result.rows[0] as { secret_ciphertext?: string; config?: Record<string, unknown> } | undefined;
    const config = row?.config && typeof row.config === "object" ? row.config : {};
    return {
      apiKey: row?.secret_ciphertext ? decryptCredential(row.secret_ciphertext) : "",
      connectionId: String(config.webRtcConnectionId || config.webrtcConnectionId || config.web_rtc_connection_id || "").trim(),
      callerNumber: e164(config.outboundNumber || config.outbound_number || config.phoneNumber),
    };
  }
  const result = await (await db()).query(`
    SELECT tc.secret_ciphertext,tc.config
    FROM bpo_voice_assignments x
    JOIN admin_voices v ON v.id=x.voice_id AND v.status='ACTIVE'
    JOIN ai_credentials tc ON tc.id=v.telnyx_credential_id AND tc.provider='TELNYX'
    WHERE x.bpo_id=$1 AND x.is_active=TRUE
    UNION ALL
    SELECT tc.secret_ciphertext,tc.config
    FROM bpo_created_agents b
    JOIN agent_credentials ac ON ac.agent_id=b.agent_id AND ac.provider='TELNYX'
    JOIN ai_credentials tc ON tc.id=ac.credential_id
    WHERE b.bpo_id=$1 AND b.is_active=TRUE
    LIMIT 1
  `, [accountId]);
  const row = result.rows[0] as { secret_ciphertext?: string; config?: Record<string, unknown> } | undefined;
  const config = row?.config && typeof row.config === "object" ? row.config : {};
  return {
    apiKey: row?.secret_ciphertext ? decryptCredential(row.secret_ciphertext) : "",
    connectionId: String(config.webRtcConnectionId || config.webrtcConnectionId || config.web_rtc_connection_id || "").trim(),
    callerNumber: e164(config.outboundNumber || config.outbound_number || config.phoneNumber),
  };
}

async function quickDialConfig(accountId: string, portal: QuickDialPrincipal["portal"]): Promise<TelephonyConfig> {
  const saved = await storedVoiceConfig(accountId, portal);
  const apiKey = process.env.TELNYX_API_KEY?.trim() || saved.apiKey;
  let connectionId = process.env.TELNYX_WEBRTC_CONNECTION_ID?.trim() || saved.connectionId;
  const callerNumber = e164(process.env.TELNYX_OUTBOUND_NUMBER || saved.callerNumber);
  if (!apiKey) throw new Error(portal === "admin" ? "No Telnyx API key is configured. Add one in AI Credentials." : "No Telnyx API key is available for this BPO workspace.");
  if (!connectionId) {
    const connections = await telnyx("/credential_connections?page[size]=10", apiKey);
    const active = (typeof connections === "string" ? [] : Array.isArray(connections.data) ? connections.data : []).filter(item => typeof item.id === "string" && item.active !== false);
    if (active.length === 1) connectionId = String(active[0].id);
    else throw new Error("Quick Dial needs a Credential-based SIP Connection. Set TELNYX_WEBRTC_CONNECTION_ID (a Call Control App ID cannot be used here).");
  }
  if (!callerNumber) throw new Error("Quick Dial needs an assigned outbound number. Set TELNYX_OUTBOUND_NUMBER or add an outbound number to the linked Telnyx credential.");
  const [ownedResponse, verifiedResponse] = await Promise.all([
    telnyx(`/phone_numbers?filter[phone_number]=${encodeURIComponent(callerNumber)}`, apiKey),
    telnyx("/verified_numbers?page[size]=100", apiKey),
  ]);
  const owned = typeof ownedResponse !== "string" && Array.isArray(ownedResponse.data) && ownedResponse.data.length > 0;
  const verified = typeof verifiedResponse !== "string" && Array.isArray(verifiedResponse.data) && verifiedResponse.data.some(item => e164(item.phone_number) === callerNumber);
  if (!owned && !verified) throw new Error("The configured outbound number is not owned or verified on this Telnyx account. Buy a Telnyx number or verify this caller ID, then update TELNYX_OUTBOUND_NUMBER.");
  return { apiKey, connectionId, callerNumber };
}

async function dashboard(principal: QuickDialPrincipal) {
  // Do not fan one page refresh out into four pool connections. On a hosted
  // Postgres plan that can exhaust the connection limit, leaving Quick Dial
  // unavailable even though the individual queries are small.
  const client = await (await db()).connect();
  try {
    const metrics = await client.query(`SELECT
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day',NOW()))::int dials_today,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day',NOW()) AND answered_at IS NOT NULL)::int connected_today,
      COALESCE(SUM(CASE WHEN created_at >= date_trunc('day',NOW()) AND answered_at IS NOT NULL THEN CASE WHEN status IN ('INITIATED','RINGING','ANSWERED') THEN EXTRACT(EPOCH FROM (NOW()-answered_at)) ELSE duration_seconds END ELSE 0 END),0)::int talk_seconds_today,
      COUNT(*) FILTER (WHERE recording_url<>'' AND created_at >= date_trunc('day',NOW()))::int recordings_today
      FROM agent_calls WHERE agent_id=$1 AND call_type='QUICK_DIAL'`, [principal.id]);
    const records = await client.query(`SELECT id,status,lead_number,duration_seconds,quick_dial_charge::float8 charged_credits,answered_at,recording_url,recording_active,created_at,ended_at FROM agent_calls WHERE agent_id=$1 AND call_type='QUICK_DIAL' ORDER BY created_at DESC LIMIT 8`, [principal.id]);
    if (principal.portal === "admin") return { metrics: metrics.rows[0] || {}, recordings: records.rows.map(row => ({ ...row, downloadable: Boolean(row.recording_url) })), billing: { balance: 0, minutePrice: 0, recordingPrice: 0 } };
    const pricing = await bpoUsagePricing(client);
    const account = await client.query("SELECT COALESCE(remaining_credits,0)::float8 remaining_credits FROM agents WHERE id=$1 AND role='BPO'", [principal.id]);
    return { metrics: metrics.rows[0] || {}, recordings: records.rows.map(row => ({ ...row, downloadable: Boolean(row.recording_url) })), billing: { balance: Number(account.rows[0]?.remaining_credits || 0), minutePrice: pricing.minuteUnitPrice, recordingPrice: pricing.recordingUnitPrice } };
  } finally {
    client.release();
  }
}

async function issueAccessToken(principal: QuickDialPrincipal) {
  const config = await quickDialConfig(principal.id, principal.portal);
  const client = await db();
  const cached = await client.query("SELECT credential_id,expires_at FROM bpo_quick_dial_credentials WHERE bpo_id=$1 AND connection_id=$2 AND expires_at>NOW()+INTERVAL '10 minutes'", [principal.id, config.connectionId]);
  let credentialId = String(cached.rows[0]?.credential_id || "");
  if (!credentialId) {
    const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    const createdCredential = await telnyx("/telephony_credentials", config.apiKey, { method: "POST", body: JSON.stringify({ connection_id: config.connectionId, name: `max7-${principal.portal}-${principal.id.slice(0, 30)}`, tag: "max7-quick-dial", expires_at: expiresAt }) });
    credentialId = String((typeof createdCredential === "string" ? undefined : createdCredential.data as Record<string, unknown> | undefined)?.id || "");
    if (!credentialId) throw new Error("Telnyx did not return a browser calling credential.");
    await client.query(`INSERT INTO bpo_quick_dial_credentials (bpo_id,credential_id,connection_id,expires_at,updated_at)
      VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (bpo_id) DO UPDATE SET credential_id=EXCLUDED.credential_id,connection_id=EXCLUDED.connection_id,expires_at=EXCLUDED.expires_at,updated_at=NOW()`, [principal.id, credentialId, config.connectionId, expiresAt]);
  }
  const tokenResponse = await telnyx(`/telephony_credentials/${encodeURIComponent(credentialId)}/token`, config.apiKey, { method: "POST" });
  const data = typeof tokenResponse === "string" ? undefined : tokenResponse.data as Record<string, unknown> | undefined;
  const token = (typeof tokenResponse === "string" ? tokenResponse : String(data?.token || data?.jwt || "")).trim().replace(/^"|"$/g, "");
  if (!token) throw new Error("Telnyx did not return a browser access token.");
  return { token, callerNumber: config.callerNumber, retryAfterMs: 0 };
}

async function beginCall(principal: QuickDialPrincipal, phone: string) {
  await recoverStaleCalls(principal.id);
  const pool = await db(), client = await pool.connect(), id = randomUUID();
  try {
    await client.query("BEGIN");
    const account = await client.query("SELECT role,COALESCE(remaining_credits,0)::float8 remaining_credits FROM agents WHERE id=$1 AND role=$2 AND status='APPROVED' FOR UPDATE", [principal.id, principal.portal === "admin" ? "ADMIN" : "BPO"]);
    if (!account.rows[0]) throw new Error(principal.portal === "admin" ? "Your admin account is not active." : "Your BPO workspace is not active.");
    const live = await client.query("SELECT id FROM agent_calls WHERE agent_id=$1 AND call_type='QUICK_DIAL' AND status IN ('INITIATED','RINGING','ANSWERED') LIMIT 1", [principal.id]);
    if (live.rows[0]) throw new Error("A Quick Dial call is already in progress. End it before placing another call.");
    if (principal.portal === "admin") {
      const maxCallDurationSeconds = 14_400;
      await client.query("INSERT INTO agent_calls (id,agent_id,call_type,status,lead_name,lead_number,dialing_source,max_call_duration_seconds,quick_dial_settled,updated_at) VALUES ($1,$2,'QUICK_DIAL','INITIATED','Admin quick dial',$3,'DIRECT',$4,TRUE,NOW())", [id, principal.id, phone, maxCallDurationSeconds]);
      await client.query("COMMIT");
      return { callId: id, maxCallDurationSeconds };
    }
    const pricing = await bpoUsagePricing(client);
    const minutePrice = pricing.minuteUnitPrice, recordingPrice = pricing.recordingUnitPrice;
    if (minutePrice <= 0) throw new Error("Quick Dial per-minute price is not configured yet. Ask the administrator to set it in BPO Plans.");
    const balance = Number(account.rows[0].remaining_credits || 0);
    const firstMinuteEstimate = Number((minutePrice + recordingPrice).toFixed(2));
    if (balance < firstMinuteEstimate) throw new Error(`Quick Dial needs ${firstMinuteEstimate} PKR available for the first minute and recording. Add credits to continue.`);
    const affordableMinutes = minutePrice > 0 ? Math.floor((balance - recordingPrice) / minutePrice) : 240;
    if (affordableMinutes < 1) throw new Error("Your PKR balance does not cover one Quick Dial minute after the recording charge.");
    const maxCallDurationSeconds = Math.min(14_400, affordableMinutes * 60);
    // Keep the amount at zero until the customer has answered and the call has
    // ended. The balance check above is only a pre-flight eligibility check.
    await client.query("INSERT INTO agent_calls (id,agent_id,call_type,status,lead_name,lead_number,dialing_source,max_call_duration_seconds,quick_dial_minute_rate,quick_dial_recording_rate,quick_dial_charge,updated_at) VALUES ($1,$2,'QUICK_DIAL','INITIATED','Quick dial',$3,'DIRECT',$4,$5,$6,0,NOW())", [id, principal.id, phone, maxCallDurationSeconds, minutePrice, recordingPrice]);
    await client.query("COMMIT");
    return { callId: id, maxCallDurationSeconds };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function updateCall(bpoId: string, input: { callId: string; status: typeof updateStatuses[number]; controlId?: string; sessionId?: string; failureReason?: string; endedAt?: Date; connected?: boolean }) {
  const pool = await db(), client = await pool.connect();
  const finished = input.status === "COMPLETED" || input.status === "FAILED";
  const endedAt = input.endedAt ?? new Date();
  const markAnswered = input.status === "ANSWERED" || input.connected === true;
  try {
    await client.query("BEGIN");
    const result = await client.query(`UPDATE agent_calls SET status=CASE WHEN status IN ('COMPLETED','FAILED') THEN status ELSE $1 END,
      telnyx_call_control_id=COALESCE(NULLIF($2,''),telnyx_call_control_id),telnyx_call_session_id=COALESCE(NULLIF($3,''),telnyx_call_session_id),
      answered_at=CASE WHEN $7 AND status NOT IN ('COMPLETED','FAILED') THEN COALESCE(answered_at,NOW()) ELSE answered_at END,
      ended_at=CASE WHEN $4 THEN COALESCE(ended_at,$6::timestamptz) ELSE ended_at END,
      duration_seconds=CASE WHEN $4 AND (answered_at IS NOT NULL OR $7) THEN GREATEST(duration_seconds,FLOOR(EXTRACT(EPOCH FROM ($6::timestamptz-COALESCE(answered_at,CASE WHEN $7 THEN $6::timestamptz ELSE created_at END))))::int) ELSE duration_seconds END,
      failure_reason=CASE WHEN $5<>'' THEN $5 ELSE failure_reason END,updated_at=NOW()
      WHERE id=$8 AND agent_id=$9 AND call_type='QUICK_DIAL'
      RETURNING id,answered_at,duration_seconds,quick_dial_minute_rate::float8 quick_dial_minute_rate,quick_dial_recording_rate::float8 quick_dial_recording_rate,quick_dial_charge::float8 quick_dial_charge,quick_dial_settled`, [input.status, input.controlId || "", input.sessionId || "", finished, input.failureReason || "", endedAt, markAnswered, input.callId, bpoId]);
    const call = result.rows[0];
    if (!call) throw new Error("Quick Dial call not found.");
    if (finished && !call.quick_dial_settled) {
      const minutes = call.answered_at ? Math.max(1, Math.ceil(Number(call.duration_seconds || 0) / 60)) : 0;
      const expected = Number((minutes * Number(call.quick_dial_minute_rate || 0) + (call.answered_at ? Number(call.quick_dial_recording_rate || 0) : 0)).toFixed(2));
      const reserved = Number(call.quick_dial_charge || 0);
      const difference = Number((expected - reserved).toFixed(2));
      let charged = reserved;
      if (difference > 0) {
        const balance = await client.query("SELECT COALESCE(remaining_credits,0)::float8 remaining_credits FROM agents WHERE id=$1 AND role='BPO' FOR UPDATE", [bpoId]);
        const additional = Math.min(difference, Number(balance.rows[0]?.remaining_credits || 0));
        if (additional > 0) {
          await client.query("UPDATE agents SET remaining_credits=remaining_credits-$1,updated_at=NOW() WHERE id=$2", [additional, bpoId]);
          await client.query("INSERT INTO bpo_credit_transactions (id,bpo_id,amount,loaded_by,transaction_type) VALUES ($1,$2,$3,$4,'QD_CHARGE')", [randomUUID(), bpoId, additional, bpoId]);
          charged = Number((charged + additional).toFixed(2));
        }
      } else if (difference < 0) {
        const refund = Math.abs(difference);
        await client.query("UPDATE agents SET remaining_credits=remaining_credits+$1,updated_at=NOW() WHERE id=$2", [refund, bpoId]);
        await client.query("INSERT INTO bpo_credit_transactions (id,bpo_id,amount,loaded_by,transaction_type) VALUES ($1,$2,$3,$4,'QD_REFUND')", [randomUUID(), bpoId, refund, bpoId]);
        charged = expected;
      }
      await client.query("UPDATE agent_calls SET quick_dial_charge=$1,quick_dial_settled=TRUE,updated_at=NOW() WHERE id=$2", [charged, input.callId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function endCall(accountId: string, portal: QuickDialPrincipal["portal"], callId: string, connected = false) {
  const current = await (await db()).query(`SELECT telnyx_call_control_id,telnyx_call_session_id
    FROM agent_calls
    WHERE id=$1 AND agent_id=$2 AND call_type='QUICK_DIAL'
      AND status IN ('INITIATED','RINGING','ANSWERED')
    LIMIT 1`, [callId, accountId]);
  const call = current.rows[0] as { telnyx_call_control_id?: string; telnyx_call_session_id?: string } | undefined;
  if (!call) throw new Error("Quick Dial call not found or already ended.");

  let providerEnded = false;
  let providerFailure = "";
  if (call.telnyx_call_control_id) {
    try {
      const config = await quickDialConfig(accountId, portal);
      await telnyx(`/calls/${encodeURIComponent(call.telnyx_call_control_id)}/actions/hangup`, config.apiKey, {
        method: "POST",
        body: JSON.stringify({ command_id: randomUUID() }),
      });
      providerEnded = true;
    } catch (error) {
      providerFailure = error instanceof Error ? `Remote hangup was not confirmed: ${error.message}` : "Remote hangup was not confirmed.";
    }
  }
  await updateCall(accountId, {
    callId,
    status: "COMPLETED",
    controlId: call.telnyx_call_control_id || "",
    sessionId: call.telnyx_call_session_id || "",
    failureReason: providerFailure,
    connected,
  });
  return { providerEnded };
}

async function recoverStaleCalls(accountId: string) {
  const stale = await (await db()).query(`SELECT id,updated_at
    FROM agent_calls
    WHERE agent_id=$1 AND call_type='QUICK_DIAL'
      AND status IN ('INITIATED','RINGING','ANSWERED')
      AND updated_at < NOW()-INTERVAL '90 seconds'`, [accountId]);
  for (const call of stale.rows) {
    await updateCall(accountId, {
      callId: String(call.id),
      status: "COMPLETED",
      failureReason: "Quick Dial browser session ended without a final call event.",
      endedAt: new Date(call.updated_at),
    });
  }
  return stale.rowCount ?? stale.rows.length;
}

async function uploadRecording(request: Request, bpoId: string) {
  const data = await request.formData(), callId = String(data.get("callId") || ""), recording = data.get("recording");
  if (!callIdSchema.safeParse(callId).success) return Response.json({ message: "Invalid call ID." }, { status: 400 });
  if (!(recording instanceof File) || !recording.type.startsWith("audio/")) return Response.json({ message: "A valid call recording is required." }, { status: 400 });
  if (recording.size > 100 * 1024 * 1024) return Response.json({ message: "Recording must be smaller than 100 MB." }, { status: 400 });
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return Response.json({ message: "Recording storage is not configured." }, { status: 503 });
  const owned = await (await db()).query("SELECT id FROM agent_calls WHERE id=$1 AND agent_id=$2 AND call_type='QUICK_DIAL'", [callId, bpoId]);
  if (!owned.rows[0]) return Response.json({ message: "Quick Dial call not found." }, { status: 404 });
  try {
    const bytes = Buffer.from(await recording.arrayBuffer());
    const upload = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => cloudinary.uploader.upload_stream({ folder: "max7-ai/quick-dial-recordings", public_id: `${bpoId.slice(0, 24)}-${callId}`, resource_type: "video", overwrite: true }, (error, result) => error || !result ? reject(error || new Error("Upload failed")) : resolve(result)).end(bytes));
    await (await db()).query("UPDATE agent_calls SET recording_url=$1,recording_id=$2,recording_size_bytes=$3,recording_active=FALSE,updated_at=NOW() WHERE id=$4", [upload.secure_url, upload.public_id, recording.size, callId]);
    return Response.json({ message: "Recording saved securely.", recordingUrl: upload.secure_url });
  } catch (error) {
    console.error("Quick Dial recording upload failed", error);
    return Response.json({ message: "Recording could not be saved. You can still download it from this call session." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const principal = await requireQuickDialPrincipal(request);
  if (!principal) return Response.json({ message: "You do not have access to Quick Dial." }, { status: 403 });
  try { return Response.json(await dashboard(principal), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { console.error("Quick Dial dashboard failed", error); return Response.json({ message: "Unable to load Quick Dial data." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const principal = await requireQuickDialPrincipal(request);
  if (!principal) return Response.json({ message: "You do not have access to Quick Dial." }, { status: 403 });
  if (request.headers.get("content-type")?.includes("multipart/form-data")) return uploadRecording(request, principal.id);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = String(body?.action || "");
  try {
    if (action === "access-token") return Response.json(await issueAccessToken(principal));
    if (action === "begin-call") {
      const phone = e164Schema.safeParse(body?.number);
      if (!phone.success) return Response.json({ message: phone.error.issues[0]?.message || "Enter a valid phone number." }, { status: 400 });
      return Response.json(await beginCall(principal, e164(phone.data)), { status: 201 });
    }
    if (action === "update-call") {
      const parsed = z.object({ callId: callIdSchema, status: z.enum(updateStatuses), controlId: z.string().max(200).optional(), sessionId: z.string().max(200).optional(), failureReason: z.string().max(500).optional(), connected: z.boolean().optional() }).safeParse(body);
      if (!parsed.success) return Response.json({ message: "Invalid call update." }, { status: 400 });
      await updateCall(principal.id, parsed.data);
      return Response.json({ ok: true });
    }
    if (action === "end-call") {
      const parsed = z.object({ callId: callIdSchema, connected: z.boolean().optional() }).safeParse(body);
      if (!parsed.success) return Response.json({ message: "Invalid Quick Dial call." }, { status: 400 });
      return Response.json(await endCall(principal.id, principal.portal, parsed.data.callId, parsed.data.connected === true));
    }
    if (action === "heartbeat") {
      const parsed = z.object({ callId: callIdSchema }).safeParse(body);
      if (!parsed.success) return Response.json({ message: "Invalid Quick Dial call." }, { status: 400 });
      const updated = await (await db()).query("UPDATE agent_calls SET updated_at=NOW() WHERE id=$1 AND agent_id=$2 AND call_type='QUICK_DIAL' AND status IN ('INITIATED','RINGING','ANSWERED') RETURNING id", [parsed.data.callId, principal.id]);
      if (!updated.rows[0]) return Response.json({ message: "Quick Dial call is no longer active." }, { status: 409 });
      return Response.json({ ok: true });
    }
    if (action === "recording-state") {
      const parsed = z.object({ callId: callIdSchema, active: z.boolean() }).safeParse(body);
      if (!parsed.success) return Response.json({ message: "Invalid recording update." }, { status: 400 });
      const updated = await (await db()).query("UPDATE agent_calls SET recording_active=$1,updated_at=NOW() WHERE id=$2 AND agent_id=$3 AND call_type='QUICK_DIAL' RETURNING id", [parsed.data.active, parsed.data.callId, principal.id]);
      if (!updated.rows[0]) return Response.json({ message: "Quick Dial call not found." }, { status: 404 });
      return Response.json({ ok: true });
    }
    return Response.json({ message: "Invalid Quick Dial action." }, { status: 400 });
  } catch (error) {
    console.error("Quick Dial request failed", error);
    return Response.json({ message: error instanceof Error ? error.message : "Quick Dial is temporarily unavailable." }, { status: 503 });
  }
}
