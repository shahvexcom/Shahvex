import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, AGENT_SESSION_COOKIE, BPO_SESSION_COOKIE, readSession } from "@/lib/session";
import { isRegularAgent, requireRegularAgent } from "@/lib/regular-agent";
import { compare, hash } from "bcryptjs";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  accent: z.string().trim().min(2).max(80),
  avatar_url: z.string().url().max(500).or(z.literal("")),
  currentPassword: z.string().min(1).optional().or(z.literal("")),
  newPassword: z.string().min(8).max(128).optional(),
}).refine((data) => !data.newPassword || !!data.currentPassword, { message: "Enter your current password to set a new password.", path: ["currentPassword"] });

export async function GET(request: Request) {
  const portal = new URL(request.url).searchParams.get("portal");
  const cookie = portal === "admin" ? ADMIN_SESSION_COOKIE : portal === "bpo" ? BPO_SESSION_COOKIE : AGENT_SESSION_COOKIE;
  const session = await readSession((await cookies()).get(cookie)?.value);
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  if (portal !== "admin" && portal !== "bpo" && !(await isRegularAgent(session.agentId))) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  try { const result = await (await db()).query("SELECT name,email,username,gender,accent,status,role,COALESCE(avatar_url,'') avatar_url,COALESCE(two_factor_enabled,FALSE) two_factor_enabled,COALESCE(remaining_credits,0)::float8 remaining_credits,admin_role,admin_permissions FROM agents WHERE id=$1 LIMIT 1", [session.agentId]); const agent = result.rows[0]; if (!agent) return Response.json({ message: "Agent not found" }, { status: 404 }); return Response.json({ agent }, { headers: { "Cache-Control": "no-store, max-age=0" } }); }
  catch { return Response.json({ message: "Unable to load agent profile" }, { status: 503 }); }
}

export async function PATCH(request: Request) {
  const session = await requireRegularAgent();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Please check your profile details." }, { status: 400 });
  try {
    const client = await db();
    const current = await client.query("SELECT password_hash FROM agents WHERE id = $1 LIMIT 1", [session.agentId]);
    if (!current.rows[0]) return Response.json({ message: "Agent not found" }, { status: 404 });
    if (parsed.data.newPassword && !(await compare(parsed.data.currentPassword!, current.rows[0].password_hash))) return Response.json({ message: "Your current password is incorrect." }, { status: 400 });
    const passwordHash = parsed.data.newPassword ? await hash(parsed.data.newPassword, 12) : current.rows[0].password_hash;
    const { name, username, gender, accent, avatar_url } = parsed.data;
    const result = await client.query("UPDATE agents SET name=$1, username=$2, gender=$3, accent=$4, avatar_url=$5, password_hash=$6, updated_at=NOW() WHERE id=$7 RETURNING name, username, gender, accent, status, COALESCE(avatar_url, '') AS avatar_url", [name, username, gender, accent, avatar_url || null, passwordHash, session.agentId]);
    return Response.json({ message: "Profile saved successfully.", agent: result.rows[0] });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") return Response.json({ message: "That name or username is already in use." }, { status: 409 });
    return Response.json({ message: "Unable to save your profile right now." }, { status: 503 });
  }
}


