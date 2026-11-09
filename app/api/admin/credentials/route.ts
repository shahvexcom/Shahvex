import { randomUUID } from "node:crypto";
import { encryptCredential as encrypt } from "@/lib/credential-crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

const providerSchema = z.enum(["GROQ", "TELNYX"]);
const detailsSchema = z.object({
  provider: providerSchema,
  label: z.string().trim().min(2).max(80),
  apiKey: z.string().trim().min(8).max(2000).optional(),
  ttsModel: z.string().trim().max(100).optional(),
  sttModel: z.string().trim().max(100).optional(),
  chatModel: z.string().trim().max(100).optional(),
  connectionId: z.string().trim().max(200).optional(),
  outboundNumber: z.string().trim().max(40).optional(),
  assistantId: z.string().trim().regex(/^assistant-[a-z0-9-]+$/i, "Enter the Telnyx AI Assistant ID (assistant-...).").max(200).optional().or(z.literal("")),
}).superRefine((data, context) => {
  if (data.provider === "TELNYX" && !data.assistantId) context.addIssue({ code: "custom", path: ["assistantId"], message: "Telnyx AI Assistant ID is required for live AI calls." });
});
const createSchema = detailsSchema.refine((data) => !!data.apiKey, { message: "API key is required." });
const updateSchema = detailsSchema.extend({ id: z.string().min(1) });

type CredentialConfig = { ttsModel?: string; sttModel?: string; chatModel?: string; connectionId?: string; outboundNumber?: string; assistantId?: string };

export { decryptCredential } from "@/lib/credential-crypto";
function maskSecret(secret: string) { return secret.length < 8 ? "••••••••" : `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`; }
function configFor(data: z.infer<typeof detailsSchema>): CredentialConfig {
  return data.provider === "GROQ" ? { ttsModel: data.ttsModel || "", sttModel: data.sttModel || "", chatModel: data.chatModel || "" } : { connectionId: data.connectionId || "", outboundNumber: data.outboundNumber || "", assistantId: data.assistantId || "" };
}

async function currentAdmin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || session.role !== "ADMIN") return null;
  const result = await (await db()).query("SELECT id,admin_role,admin_permissions FROM agents WHERE id=$1 AND role='ADMIN' LIMIT 1", [session.agentId]);
  const admin = result.rows[0] as { id: string; admin_role: string; admin_permissions: string[] } | undefined;
  return admin?.admin_role === "SUPER_ADMIN" || admin?.admin_permissions?.includes("credentials") ? admin : null;
}
const listQuery = `SELECT id,provider,label,config,created_at,updated_at FROM ai_credentials ORDER BY provider,updated_at DESC`;

export async function GET() {
  if (!await currentAdmin()) return Response.json({ message: "You do not have access to AI credentials." }, { status: 403 });
  const client = await db();
  const [credentials, counts] = await Promise.all([
    client.query(listQuery),
    client.query("SELECT COUNT(*) FILTER (WHERE provider='GROQ')::int groq, COUNT(*) FILTER (WHERE provider='TELNYX')::int telnyx, COUNT(*)::int total, COUNT(*) FILTER (WHERE updated_at >= date_trunc('month', NOW()))::int updated_this_month FROM ai_credentials"),
  ]);
  return Response.json({ credentials: credentials.rows, kpis: counts.rows[0] });
}

export async function POST(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return Response.json({ message: "You do not have access to AI credentials." }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid credential details." }, { status: 400 });
  const value = parsed.data;
  const result = await (await db()).query("INSERT INTO ai_credentials (id,provider,label,secret_ciphertext,config,created_by,updated_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$6) RETURNING id,provider,label,config,created_at,updated_at", [randomUUID(), value.provider, value.label, encrypt(value.apiKey!), JSON.stringify(configFor(value)), admin.id]);
  return Response.json({ message: "Credential saved securely.", credential: result.rows[0], maskedKey: maskSecret(value.apiKey!) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return Response.json({ message: "You do not have access to AI credentials." }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid credential details." }, { status: 400 });
  const value = parsed.data, client = await db();
  const existing = await client.query("SELECT id,secret_ciphertext FROM ai_credentials WHERE id=$1", [value.id]);
  if (!existing.rows[0]) return Response.json({ message: "Credential not found." }, { status: 404 });
  const result = await client.query("UPDATE ai_credentials SET provider=$1,label=$2,secret_ciphertext=$3,config=$4::jsonb,updated_by=$5,updated_at=NOW() WHERE id=$6 RETURNING id,provider,label,config,created_at,updated_at", [value.provider, value.label, value.apiKey ? encrypt(value.apiKey) : existing.rows[0].secret_ciphertext, JSON.stringify(configFor(value)), admin.id, value.id]);
  return Response.json({ message: "Credential updated.", credential: result.rows[0] });
}

export async function DELETE(request: Request) {
  if (!await currentAdmin()) return Response.json({ message: "You do not have access to AI credentials." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ message: "Credential id is required." }, { status: 400 });
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    // A credential may be assigned to one or more agents. Remove those
    // assignments first so the foreign-key constraint cannot block deletion.
    await client.query("DELETE FROM agent_credentials WHERE credential_id=$1", [id]);
    const deleted = await client.query("DELETE FROM ai_credentials WHERE id=$1 RETURNING id", [id]);
    if (!deleted.rows[0]) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Credential not found." }, { status: 404 });
    }
    await client.query("COMMIT");
    return Response.json({ message: "Credential deleted and removed from assigned agents." });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return Response.json({ message: "Unable to delete credential. Please try again." }, { status: 500 });
  } finally {
    client.release();
  }
}
