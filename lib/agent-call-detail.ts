import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bpoEntitlements, bpoLeadUsage } from "@/lib/bpo-entitlements";
import { db } from "@/lib/database";
import { decryptCredential } from "@/app/api/admin/credentials/route";
import { syncLiveAssistantTranscript } from "@/lib/call-start";

export async function agentCallDetail(id: string, agentId: string) {
  if (!z.string().uuid().safeParse(id).success) return Response.json({ message: "Invalid call ID." }, { status: 400 });
  const client = await db();
  const result = await client.query(`SELECT c.id,c.status,c.conversation_state,c.failure_reason,c.lead_name,c.lead_number,c.recording_url,c.recording_id,c.recording_active,c.on_hold,c.duration_seconds,c.summary,c.notes,c.start_note,c.mid_note,c.final_note,c.outcome,c.transcript,c.conversation_history,c.created_at,c.answered_at,c.ended_at,c.updated_at,a.name agent_name,COALESCE(a.avatar_url,'') agent_avatar,COALESCE(ac.config->>'outboundNumber','') agent_number,COALESCE(tc.label,'Telnyx') telnyx_credential,COALESCE(gc.label,'Not assigned') groq_credential FROM agent_calls c JOIN agents a ON a.id=c.agent_id LEFT JOIN agent_credentials at ON at.agent_id=a.id AND at.provider='TELNYX' LEFT JOIN ai_credentials ac ON ac.id=at.credential_id LEFT JOIN ai_credentials tc ON tc.id=at.credential_id LEFT JOIN agent_credentials ag ON ag.agent_id=a.id AND ag.provider='GROQ' LEFT JOIN ai_credentials gc ON gc.id=ag.credential_id WHERE c.call_type='LEAD' AND c.id=$1 AND c.agent_id=$2`, [id,agentId]);
  const call = result.rows[0];
  if (!call) return Response.json({ message: "Call not found." }, { status: 404 });
  const script = await client.query("SELECT lead_headers,script_text FROM script_assignments WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 1", [agentId]);
  call.script_lead_headers = script.rows[0]?.lead_headers || [];
  call.script_text = script.rows[0]?.script_text || "";
  const assistant = await client.query("SELECT telnyx_ai_conversation_id FROM agent_calls WHERE id=$1 AND agent_id=$2", [id,agentId]);
  call.telnyx_ai_conversation_id = assistant.rows[0]?.telnyx_ai_conversation_id;
  await syncLiveAssistantTranscript(call,client);
  return Response.json({ calls: [call] }, { headers: { "Cache-Control": "private, no-store" } });
}

const commandSchema = z.object({ id: z.string().uuid(), action: z.enum(["hangup","record-start","record-stop","hold","resume"]) });
export async function agentCallCommand(body: unknown, agentId: string) {
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: "Invalid call action." }, { status: 400 });
  const { id, action } = parsed.data;
  const client = await db();
  const result = await client.query(`SELECT c.status,c.telnyx_call_control_id,ac.secret_ciphertext FROM agent_calls c
    JOIN agent_credentials a ON a.agent_id=c.agent_id AND a.provider='TELNYX'
    JOIN ai_credentials ac ON ac.id=a.credential_id WHERE c.id=$1 AND c.agent_id=$2`, [id,agentId]);
  const call = result.rows[0];
  if (!call) return Response.json({ message: "Call not found." }, { status: 404 });
  if (!["INITIATED","RINGING","ANSWERED"].includes(call.status) || !call.telnyx_call_control_id)
    return Response.json({ message: "The call is not available for this action yet." }, { status: 409 });
  if (action !== "hangup" && call.status !== "ANSWERED") return Response.json({ message: "Wait for the customer to answer." }, { status: 409 });
  if (action === "record-start") {
    const owner = await client.query("SELECT bpo_id FROM bpo_created_agents WHERE agent_id=$1", [agentId]);
    const bpoId = String(owner.rows[0]?.bpo_id || "");
    if (bpoId) {
      const [limits, usage] = await Promise.all([bpoEntitlements(client, bpoId), bpoLeadUsage(client, bpoId)]);
      if (!limits.recordings || usage.recordings >= limits.recordings) return Response.json({ message: "Your recording allowance has been reached. Buy more recordings from Plans.", }, { status: 409 });
    }
  }
  const command = { hangup: "hangup", "record-start": "record_start", "record-stop": "record_stop", hold: "hold", resume: "unhold" }[action];
  const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(call.telnyx_call_control_id)}/actions/${command}`, {
    method: "POST", headers: { Authorization: `Bearer ${decryptCredential(call.secret_ciphertext)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ command_id: randomUUID(), ...(action === "record-start" ? { format: "mp3", channels: "dual", recording_track: "both", play_beep: false } : {}) }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return Response.json({ message: "The calling provider could not complete this action." }, { status: 502 });
  // Keep the live status until the signed hangup event confirms the call ended.
  if (action === "hangup") await client.query("UPDATE agent_calls SET conversation_state='ENDING',ending_requested=TRUE,updated_at=NOW() WHERE id=$1 AND agent_id=$2", [id,agentId]);
  if (action === "record-start" || action === "record-stop") await client.query("UPDATE agent_calls SET recording_active=$1,updated_at=NOW() WHERE id=$2 AND agent_id=$3", [action === "record-start",id,agentId]);
  if (action === "hold" || action === "resume") await client.query("UPDATE agent_calls SET on_hold=$1,updated_at=NOW() WHERE id=$2 AND agent_id=$3", [action === "hold",id,agentId]);
  return Response.json({ message: action === "hangup" ? "Ending call. Waiting for confirmation." : "Call updated." });
}

const notesSchema = z.object({ id: z.string().uuid(), notes: z.string().max(10000) });
export async function saveAgentCallNotes(body: unknown, agentId: string) {
  const parsed = notesSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: "Invalid notes." }, { status: 400 });
  const result = await (await db()).query("UPDATE agent_calls SET notes=$1,updated_at=NOW() WHERE id=$2 AND agent_id=$3 RETURNING id", [parsed.data.notes,parsed.data.id,agentId]);
  return result.rowCount ? Response.json({ message: "Notes saved." }) : Response.json({ message: "Call not found." }, { status: 404 });
}
