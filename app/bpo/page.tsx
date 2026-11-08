import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/database";
import { BPO_SESSION_COOKIE, readSession } from "@/lib/session";
import BpoWorkspace from "@/app/components/bpo-workspace";

export default async function BpoPage() {
  const session = await readSession((await cookies()).get(BPO_SESSION_COOKIE)?.value);
  if (!session || session.role !== "BPO") redirect("/bpo/login");
  const client = await db();
  // Keep older databases usable while the lazy schema migration is applied.
  await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS two_factor_secret TEXT");
  const result = await client.query("SELECT name,email,phone,username,avatar_url,status,COALESCE(two_factor_enabled,FALSE) two_factor_enabled,COALESCE(remaining_credits,0)::float8 remaining_credits FROM agents WHERE id=$1 AND role='BPO'", [session.agentId]);
  const user = result.rows[0];
  if (!user || user.status !== "APPROVED") redirect("/bpo/blocked");
  // BPO history is shared across the authenticated workspace.
  return <BpoWorkspace user={user} />;
}
