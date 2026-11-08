import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { BPO_SESSION_COOKIE, readSession } from "@/lib/session";

export async function requireApprovedBpo() {
  const session = await readSession((await cookies()).get(BPO_SESSION_COOKIE)?.value);
  if (!session || session.role !== "BPO") return null;
  const account = await (await db()).query(
    "SELECT id FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED'",
    [session.agentId],
  );
  return account.rows[0] ? session : null;
}
