import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { AdminControlCenter } from "@/app/components/admin-control-center";

export const metadata = {
  title: "Control center",
  robots: { index: false, follow: false },
};

export default async function ControlerPage() {
  const session = await readSession(
    (await cookies()).get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (!session || session.role !== "ADMIN") redirect("/controler/login");
  const client = await db();
  const result =
    await client.query(`SELECT a.id, a.name, a.username, a.gender, a.accent, a.status, COALESCE(a.avatar_url, '') avatar_url,
    COALESCE(a.call_limit_minutes, 0) call_limit_minutes, a.daily_call_limit, a.created_at,
    (SELECT c.label FROM agent_credentials ac JOIN ai_credentials c ON c.id = ac.credential_id WHERE ac.agent_id = a.id AND ac.provider = 'GROQ') groq_credential_label,
    (SELECT c.label FROM agent_credentials ac JOIN ai_credentials c ON c.id = ac.credential_id WHERE ac.agent_id = a.id AND ac.provider = 'TELNYX') telnyx_credential_label,
    (SELECT COUNT(*)::int FROM agent_calls c WHERE c.agent_id = a.id AND c.call_type = 'LEAD') dialed_calls,
    (SELECT COUNT(*)::int FROM leads l WHERE l.agent_id = a.id) total_leads
    FROM agents a
    WHERE a.role = 'AGENT'
      AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)
    ORDER BY a.created_at DESC`);
  return (
    <AdminControlCenter
      agents={result.rows.map((row) => ({
        ...row,
        created_at: String(row.created_at),
      }))}
    />
  );
}
