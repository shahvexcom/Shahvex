import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, AGENT_SESSION_COOKIE, readSession } from "@/lib/session";

async function getSession(portal: unknown) {
  const cookie = portal === "admin" ? ADMIN_SESSION_COOKIE : AGENT_SESSION_COOKIE;
  return readSession((await cookies()).get(cookie)?.value);
}

export async function GET(request: Request) {
  const session = await getSession(new URL(request.url).searchParams.get("portal"));
  if (!session) return Response.json({ notifications: [] }, { status: 401 });
  try { const result = await (await db()).query("SELECT id, title, message, category, is_read, created_at FROM notifications WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50", [session.agentId]); return Response.json({ notifications: result.rows }); }
  catch { return Response.json({ notifications: [], message: "Notifications are unavailable" }, { status: 503 }); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({})); const session = await getSession(body.portal); if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 }); const action = body.action === "archive" ? "ARCHIVED" : body.action === "unarchive" ? "INBOX" : null; try { if (action) await (await db()).query("UPDATE notifications SET category = $1 WHERE id = $2 AND agent_id = $3", [action, body.id, session.agentId]); else await (await db()).query("UPDATE notifications SET is_read = TRUE WHERE id = $1 AND agent_id = $2", [body.id, session.agentId]); return Response.json({ ok: true }); } catch { return Response.json({ message: "Unable to update notification" }, { status: 503 }); }
}

export async function DELETE(request: Request) { const body = await request.json().catch(() => ({})); const session = await getSession(body.portal); if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 }); try { await (await db()).query("DELETE FROM notifications WHERE id = $1 AND agent_id = $2", [body.id, session.agentId]); return Response.json({ ok: true }); } catch { return Response.json({ message: "Unable to delete notification" }, { status: 503 }); } }
