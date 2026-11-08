import { cookies } from "next/headers";
import path from "node:path";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

export async function GET() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (session?.role !== "ADMIN") return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const result = await (await db()).query("SELECT s.id,s.agent_id,a.name agent_name,s.lead_file_name,s.script_file_name,COALESCE(s.lead_file_url,'') lead_file_url,COALESCE(s.script_file_url,'') script_file_url,COALESCE(s.lead_file_type,'') lead_file_type,COALESCE(s.script_file_type,'') script_file_type,s.lead_headers,s.lead_rows,s.script_text,s.created_at FROM script_assignments s JOIN agents a ON a.id=s.agent_id WHERE NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=s.agent_id) ORDER BY s.created_at DESC");
  const documents = result.rows.flatMap((row) => [
    { id: `${row.id}-lead`, assignmentId: row.id, kind: "Lead sheet", name: row.lead_file_name, url: row.lead_file_url || `/script-files/${encodeURIComponent(path.basename(row.lead_file_name))}`, type: row.lead_file_type || path.extname(row.lead_file_name).slice(1).toUpperCase(), agent: row.agent_name, createdAt: row.created_at, preview: { headers: row.lead_headers, rows: row.lead_rows } },
    { id: `${row.id}-script`, assignmentId: row.id, kind: "Script sheet", name: row.script_file_name, url: row.script_file_url || `/script-files/${encodeURIComponent(path.basename(row.script_file_name))}`, type: row.script_file_type || path.extname(row.script_file_name).slice(1).toUpperCase(), agent: row.agent_name, createdAt: row.created_at, preview: { text: row.script_text } },
  ]);
  return Response.json({ documents });
}
