import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

const permissions = ["dashboard", "quickdial", "agents", "scripts", "documents", "credentials", "voip", "queue", "reports", "live", "settings"] as const;
const permissionSchema = z.array(z.enum(permissions)).min(1);
const profileSchema = z.object({ action: z.literal("profile"), name: z.string().trim().min(2).max(80), username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/), email: z.string().trim().toLowerCase().email().max(254).or(z.literal("")), avatar_url: z.string().trim().url().max(2048).or(z.literal("")), currentPassword: z.string().optional().default(""), newPassword: z.preprocess(value => value === "" ? undefined : value, z.string().min(8).max(128).optional()) }).refine(v => !v.newPassword || !!v.currentPassword, { message: "Enter your current password to set a new password." });
const roleSchema = z.object({ action: z.literal("role"), name: z.string().trim().min(2).max(80), permissions: permissionSchema });
const roleUpdateSchema = z.object({ action: z.literal("role-update"), id: z.string().min(1), name: z.string().trim().min(2).max(80), permissions: permissionSchema });
const adminFields = { name: z.string().trim().min(2).max(80), username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/), email: z.string().trim().email().max(254).or(z.literal("")), roleName: z.string().trim().min(2).max(80), avatar_url: z.string().url().max(500) };
const adminSchema = z.object({ action: z.literal("admin"), ...adminFields, password: z.string().min(8).max(128) });
const adminUpdateSchema = z.object({ action: z.literal("admin-update"), ...adminFields, id: z.string().min(1), password: z.string().min(8).max(128).optional() });
const preferencesSchema = z.object({ action: z.literal("preferences"), notificationsEnabled: z.boolean(), interfaceSoundsEnabled: z.boolean(), backgroundSoundEnabled: z.boolean() });
async function currentAdmin() { const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value); if (!session || session.role !== "ADMIN") return null; const result = await (await db()).query("SELECT id,name,username,email,avatar_url,admin_role,admin_permissions FROM agents WHERE id=$1 AND role='ADMIN' LIMIT 1", [session.agentId]); return result.rows[0] ?? null; }
const isSuper = (admin: { admin_role: string }) => admin.admin_role === "SUPER_ADMIN";

export async function GET() {
  const admin = await currentAdmin(); if (!admin) return Response.json({ message: "Unauthenticated" }, { status: 401 }); const client = await db();
  const [roles, admins, preference, kpis] = await Promise.all([
    isSuper(admin) ? client.query("SELECT id,name,permissions FROM admin_roles ORDER BY name") : Promise.resolve({ rows: [] }),
    isSuper(admin) ? client.query("SELECT id,name,username,COALESCE(email,'') email,admin_role,admin_permissions,COALESCE(avatar_url,'') avatar_url FROM agents WHERE role='ADMIN' AND id <> $1 ORDER BY created_at DESC", [admin.id]) : Promise.resolve({ rows: [] }),
    client.query("SELECT notifications_enabled,interface_sounds_enabled,background_sound_enabled FROM admin_preferences WHERE admin_id=$1", [admin.id]),
    isSuper(admin) ? client.query("SELECT (SELECT COUNT(*)::int FROM admin_roles) roles,(SELECT COUNT(*)::int FROM agents WHERE role='ADMIN' AND admin_role <> 'SUPER_ADMIN') sub_admins,(SELECT COUNT(*)::int FROM agents WHERE role='ADMIN' AND avatar_url IS NOT NULL) avatars,(SELECT COUNT(*)::int FROM agents WHERE role='ADMIN' AND created_at >= date_trunc('month',NOW())) created_this_month") : Promise.resolve({ rows: [] }),
  ]);
  return Response.json({ profile: { ...admin, name: admin.name ?? "", username: admin.username ?? "", email: admin.email ?? "", avatar_url: admin.avatar_url ?? "", permissions: admin.admin_permissions ?? [] }, isSuperAdmin: isSuper(admin), roles: roles.rows, admins: admins.rows, preferences: preference.rows[0] ?? { notifications_enabled: true, interface_sounds_enabled: true, background_sound_enabled: false }, kpis: kpis.rows[0] ?? null });
}

export async function POST(request: Request) {
  const admin = await currentAdmin(); if (!admin) return Response.json({ message: "Unauthenticated" }, { status: 401 }); const parsed = z.discriminatedUnion("action", [profileSchema, roleSchema, roleUpdateSchema, adminSchema, adminUpdateSchema, preferencesSchema]).safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 }); const client = await db();
  try {
    if (parsed.data.action === "profile") { if (!isSuper(admin)) return Response.json({ message: "Sub-admin profiles are view-only." }, { status: 403 }); const password = await client.query("SELECT password_hash FROM agents WHERE id=$1", [admin.id]); if (parsed.data.newPassword && !(await compare(parsed.data.currentPassword, password.rows[0].password_hash))) return Response.json({ message: "Current password is incorrect." }, { status: 400 }); const result = await client.query("UPDATE agents SET name=$1,username=$2,email=$3,avatar_url=$4,password_hash=$5,updated_at=NOW() WHERE id=$6 RETURNING id,name,username,email,COALESCE(avatar_url,'') avatar_url,admin_role,admin_permissions", [parsed.data.name, parsed.data.username, parsed.data.email, parsed.data.avatar_url || null, parsed.data.newPassword ? await hash(parsed.data.newPassword, 12) : password.rows[0].password_hash, admin.id]); return Response.json({ message: "Profile updated.", profile: result.rows[0] }); }
    if (!isSuper(admin)) return Response.json({ message: "Only the super admin can manage these settings." }, { status: 403 });
    if (parsed.data.action === "preferences") { await client.query("INSERT INTO admin_preferences (admin_id,notifications_enabled,interface_sounds_enabled,background_sound_enabled,updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (admin_id) DO UPDATE SET notifications_enabled=EXCLUDED.notifications_enabled,interface_sounds_enabled=EXCLUDED.interface_sounds_enabled,background_sound_enabled=EXCLUDED.background_sound_enabled,updated_at=NOW()", [admin.id, parsed.data.notificationsEnabled, parsed.data.interfaceSoundsEnabled, parsed.data.backgroundSoundEnabled]); return Response.json({ message: "Preferences saved." }); }
    if (parsed.data.action === "role") { const result = await client.query("INSERT INTO admin_roles (id,name,permissions,created_by) VALUES ($1,$2,$3::jsonb,$4) RETURNING id,name,permissions", [randomUUID(), parsed.data.name, JSON.stringify(parsed.data.permissions), admin.id]); return Response.json({ message: "Role created.", role: result.rows[0] }, { status: 201 }); }
    if (parsed.data.action === "role-update") { const previous = await client.query("SELECT name FROM admin_roles WHERE id=$1", [parsed.data.id]); if (!previous.rows[0]) return Response.json({ message: "Role not found." }, { status: 404 }); const result = await client.query("UPDATE admin_roles SET name=$1,permissions=$2::jsonb WHERE id=$3 RETURNING id,name,permissions", [parsed.data.name, JSON.stringify(parsed.data.permissions), parsed.data.id]); await client.query("UPDATE agents SET admin_role=$1,admin_permissions=$2::jsonb WHERE role='ADMIN' AND admin_role=$3", [parsed.data.name, JSON.stringify(parsed.data.permissions), previous.rows[0].name]); return Response.json({ message: "Role updated.", role: result.rows[0] }); }
    const role = await client.query("SELECT name,permissions FROM admin_roles WHERE name=$1 LIMIT 1", [parsed.data.roleName]); if (!role.rows[0]) return Response.json({ message: "Select a valid role." }, { status: 400 });
    if (parsed.data.action === "admin-update") { const existing = await client.query("SELECT password_hash FROM agents WHERE id=$1 AND role='ADMIN' AND admin_role <> 'SUPER_ADMIN'", [parsed.data.id]); if (!existing.rows[0]) return Response.json({ message: "Sub-admin not found." }, { status: 404 }); await client.query("UPDATE agents SET name=$1,username=$2,email=$3,avatar_url=$4,password_hash=$5,admin_role=$6,admin_permissions=$7::jsonb,updated_at=NOW() WHERE id=$8", [parsed.data.name, parsed.data.username, parsed.data.email || null, parsed.data.avatar_url, parsed.data.password ? await hash(parsed.data.password, 12) : existing.rows[0].password_hash, role.rows[0].name, JSON.stringify(role.rows[0].permissions), parsed.data.id]); return Response.json({ message: "Sub-admin updated." }); }
    const result = await client.query("INSERT INTO agents (id,name,username,email,avatar_url,password_hash,gender,accent,status,role,admin_role,admin_permissions,approved_at) VALUES ($1,$2,$3,$4,$5,$6,'OTHER','Professional','APPROVED','ADMIN',$7,$8::jsonb,NOW()) RETURNING id,name,username,email,COALESCE(avatar_url,'') avatar_url,admin_role,admin_permissions", [randomUUID(), parsed.data.name, parsed.data.username, parsed.data.email || null, parsed.data.avatar_url, await hash(parsed.data.password, 12), role.rows[0].name, JSON.stringify(role.rows[0].permissions)]); return Response.json({ message: "Sub-admin created.", admin: result.rows[0] }, { status: 201 });
  } catch (error: unknown) { if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") return Response.json({ message: "That email, username or role already exists." }, { status: 409 }); return Response.json({ message: "Unable to save changes." }, { status: 503 }); }
}
export async function DELETE(request: Request) {
 const admin=await currentAdmin();
 if(!admin||!isSuper(admin))return Response.json({message:"Only the super admin can delete this."},{status:403});
 if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({message:"Same-origin request required."},{status:403});
 const url=new URL(request.url),adminId=url.searchParams.get("adminId"),roleId=url.searchParams.get("roleId"),pool=await db();
 if(adminId===admin.id)return Response.json({message:"You cannot delete your own signed-in account."},{status:409});
 const tx=await pool.connect();
 try{
  await tx.query("BEGIN");
  if(adminId){
   const target=await tx.query("SELECT id FROM agents WHERE id=$1 AND role='ADMIN' FOR UPDATE",[adminId]);
   if(!target.rows[0]){await tx.query("ROLLBACK");return Response.json({message:"Admin not found."},{status:404});}
   // Preserve audit and role records that would otherwise block deletion or cascade away.
   const refs=await tx.query(`SELECT ns.nspname schema_name,t.relname table_name,a.attname column_name FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1] WHERE c.contype='f' AND c.confrelid='agents'::regclass AND array_length(c.conkey,1)=1 AND (c.confdeltype IN ('a','r') OR a.attname='created_by')`);
   const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
   for(const ref of refs.rows)await tx.query(`UPDATE ${quote(ref.schema_name)}.${quote(ref.table_name)} SET ${quote(ref.column_name)}=$1 WHERE ${quote(ref.column_name)}=$2`,[admin.id,adminId]);
   await tx.query("DELETE FROM agents WHERE id=$1 AND role='ADMIN'",[adminId]);
   await tx.query("COMMIT");return Response.json({message:"Admin deleted. Shared records have been retained."});
  }
  if(!roleId){await tx.query("ROLLBACK");return Response.json({message:"Role is required."},{status:400});}
  const role=await tx.query("SELECT name FROM admin_roles WHERE id=$1 FOR UPDATE",[roleId]);
  if(!role.rows[0]){await tx.query("ROLLBACK");return Response.json({message:"Role not found."},{status:404});}
  const used=await tx.query("SELECT id FROM agents WHERE role='ADMIN' AND admin_role=$1 LIMIT 1",[role.rows[0].name]);
  if(used.rows[0]){await tx.query("ROLLBACK");return Response.json({message:"Reassign admins before deleting this role."},{status:409});}
  await tx.query("DELETE FROM admin_roles WHERE id=$1",[roleId]);await tx.query("COMMIT");return Response.json({message:"Role deleted."});
 }catch(error){await tx.query("ROLLBACK");return Response.json({message:typeof error==='object'&&error&&'code' in error&&error.code==='23503'?"This admin still owns linked records. Reassign them before deleting.":"Unable to delete. Please try again."},{status:409});}finally{tx.release();}
}
