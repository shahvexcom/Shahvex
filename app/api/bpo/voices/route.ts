import { localVoices } from "@/lib/agent-test";
import { db } from "@/lib/database";
import { requireApprovedBpo } from "@/lib/bpo-session";
import { z } from "zod";

const activitySchema = z.object({ voiceId: z.string().uuid(), isActive: z.boolean() });

export async function GET() {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  const result = await client.query(`SELECT v.id,v.name,v.gender,v.accent,v.status,x.is_active,
    tc.label telnyx_label,gc.label groq_label,
    x.assigned_at
    FROM bpo_voice_assignments x
    JOIN admin_voices v ON v.id=x.voice_id
    LEFT JOIN ai_credentials tc ON tc.id=v.telnyx_credential_id
    LEFT JOIN ai_credentials gc ON gc.id=v.groq_credential_id
    WHERE x.bpo_id=$1
    ORDER BY x.is_active DESC,(v.status='ACTIVE') DESC,v.name`, [session.agentId]);
  const local = await localVoices(session.agentId).catch(() => null);
  const shared = (local?.voices || []).map(voice => ({...voice, status: "ACTIVE", is_active: true, is_local: true, telnyx_label: null, groq_label: null, assigned_at: null}));
  const localIds = new Set(shared.map(voice => voice.id));
  return Response.json({ voices: [...result.rows.filter(voice => !localIds.has(voice.id)), ...shared], localVoiceError: local && local.serviceReady !== false ? null : "Shared voices are temporarily unavailable. Refresh when the voice service is ready." }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = activitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Select a valid assigned voice." }, { status: 400 });
  const client = await db();
  const updated = await client.query(`UPDATE bpo_voice_assignments x SET is_active=$1
    FROM admin_voices v
    WHERE x.bpo_id=$2 AND x.voice_id=$3 AND v.id=x.voice_id AND v.status='ACTIVE'
    RETURNING x.voice_id,x.is_active`, [parsed.data.isActive, session.agentId, parsed.data.voiceId]);
  if (!updated.rows[0]) return Response.json({ message: "This voice is inactive or is no longer assigned to your account." }, { status: 403 });
  if (!parsed.data.isActive) await client.query("UPDATE bpo_voice_preferences SET auto_voice_id=NULL,manual_voice_id=NULL,updated_at=NOW() WHERE bpo_id=$1 AND (auto_voice_id=$2 OR manual_voice_id=$2)", [session.agentId, parsed.data.voiceId]);
  return Response.json({ message: parsed.data.isActive ? "Voice is now active and can be assigned to agents." : "Voice is now inactive.", voiceId: parsed.data.voiceId, isActive: parsed.data.isActive });
}
