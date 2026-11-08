import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

const voiceFields = z.object({
  name: z.string().trim().min(2).max(80),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  accent: z.string().trim().min(2).max(80),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  telnyxCredentialId: z.string().min(1).nullable(),
  groqCredentialId: z.string().min(1).nullable(),
  bpoIds: z.array(z.string().min(1)).max(500).transform(ids => [...new Set(ids)]),
}).refine(value => value.telnyxCredentialId || value.groqCredentialId, {
  message: "Select at least one Telnyx or Groq credential.",
});

const createSchema = voiceFields;
const updateSchema = voiceFields.and(z.object({ id: z.string().min(1) }));

async function requireAdmin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return session?.role === "ADMIN" ? session : null;
}

const voiceQuery = `SELECT v.id,v.name,v.gender,v.accent,v.status,v.telnyx_credential_id,v.groq_credential_id,
  v.created_at,v.updated_at,tc.label telnyx_label,gc.label groq_label,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'email',a.email) ORDER BY a.name)
    FROM bpo_voice_assignments x JOIN agents a ON a.id=x.bpo_id WHERE x.voice_id=v.id),'[]'::jsonb) assigned_bpos
  FROM admin_voices v
  LEFT JOIN ai_credentials tc ON tc.id=v.telnyx_credential_id
  LEFT JOIN ai_credentials gc ON gc.id=v.groq_credential_id`;

async function validateReferences(client: Awaited<ReturnType<typeof db>>, value: z.infer<typeof voiceFields>) {
  const credentials = [["TELNYX", value.telnyxCredentialId], ["GROQ", value.groqCredentialId]] as const;
  for (const [provider, id] of credentials) {
    if (!id) continue;
    const found = await client.query("SELECT id FROM ai_credentials WHERE id=$1 AND provider=$2", [id, provider]);
    if (!found.rows[0]) throw new Error(`Selected ${provider} credential is not available.`);
  }
  if (value.bpoIds.length) {
    const found = await client.query("SELECT id FROM agents WHERE role='BPO' AND id=ANY($1::text[])", [value.bpoIds]);
    if (found.rowCount !== value.bpoIds.length) throw new Error("One or more selected BPO users are not available.");
  }
}

async function replaceAssignments(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, voiceId: string, bpoIds: string[]) {
  await client.query("DELETE FROM bpo_voice_assignments WHERE voice_id=$1", [voiceId]);
  for (const bpoId of bpoIds) {
    await client.query("INSERT INTO bpo_voice_assignments (bpo_id,voice_id) VALUES ($1,$2)", [bpoId, voiceId]);
  }
  await client.query("UPDATE bpo_voice_preferences p SET auto_voice_id=NULL,updated_at=NOW() WHERE auto_voice_id=$1 AND NOT EXISTS (SELECT 1 FROM bpo_voice_assignments x WHERE x.bpo_id=p.bpo_id AND x.voice_id=$1)", [voiceId]);
  await client.query("UPDATE bpo_voice_preferences p SET manual_voice_id=NULL,updated_at=NOW() WHERE manual_voice_id=$1 AND NOT EXISTS (SELECT 1 FROM bpo_voice_assignments x WHERE x.bpo_id=p.bpo_id AND x.voice_id=$1)", [voiceId]);
}

export async function GET() {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  const [voices, bpoUsers, credentials] = await Promise.all([
    client.query(`${voiceQuery} ORDER BY v.updated_at DESC`),
    client.query("SELECT id,name,email,status FROM agents WHERE role='BPO' ORDER BY name"),
    client.query("SELECT id,provider,label,config FROM ai_credentials ORDER BY provider,label"),
  ]);
  return Response.json({ voices: voices.rows, bpoUsers: bpoUsers.rows, credentials: credentials.rows });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid voice details." }, { status: 400 });
  const value = parsed.data, pool = await db(), client = await pool.connect(), id = randomUUID();
  try {
    await validateReferences(pool, value);
    await client.query("BEGIN");
    await client.query(`INSERT INTO admin_voices (id,name,gender,accent,status,telnyx_credential_id,groq_credential_id,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, value.name, value.gender, value.accent, value.status, value.telnyxCredentialId, value.groqCredentialId, admin.agentId]);
    await replaceAssignments(client, id, value.bpoIds);
    await client.query("COMMIT");
    const voice = await pool.query(`${voiceQuery} WHERE v.id=$1`, [id]);
    return Response.json({ message: "Admin voice created and assigned.", voice: voice.rows[0] }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return Response.json({ message: error instanceof Error ? error.message : "Unable to create admin voice." }, { status: 400 });
  } finally {
    client.release();
  }
}

export async function PATCH(request: Request) {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid voice details." }, { status: 400 });
  const value = parsed.data, pool = await db(), client = await pool.connect();
  try {
    await validateReferences(pool, value);
    await client.query("BEGIN");
    const updated = await client.query(`UPDATE admin_voices SET name=$1,gender=$2,accent=$3,status=$4,
      telnyx_credential_id=$5,groq_credential_id=$6,updated_at=NOW() WHERE id=$7 RETURNING id`,
      [value.name, value.gender, value.accent, value.status, value.telnyxCredentialId, value.groqCredentialId, value.id]);
    if (!updated.rows[0]) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Admin voice not found." }, { status: 404 });
    }
    await replaceAssignments(client, value.id, value.bpoIds);
    await client.query("COMMIT");
    const voice = await pool.query(`${voiceQuery} WHERE v.id=$1`, [value.id]);
    return Response.json({ message: "Admin voice updated.", voice: voice.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return Response.json({ message: error instanceof Error ? error.message : "Unable to update admin voice." }, { status: 400 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ message: "Admin voice id is required." }, { status: 400 });
  const deleted = await (await db()).query("DELETE FROM admin_voices WHERE id=$1 RETURNING id", [id]);
  return deleted.rows[0]
    ? Response.json({ message: "Admin voice deleted.", deletedId: id })
    : Response.json({ message: "Admin voice not found." }, { status: 404 });
}
