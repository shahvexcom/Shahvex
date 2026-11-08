import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, AGENT_SESSION_COOKIE, BPO_SESSION_COOKIE, readSession } from "@/lib/session";

export async function POST(request: Request) {
  const body = request.headers.get("content-type")?.includes("application/json")
    ? await request.json().catch(() => ({}))
    : Object.fromEntries((await request.formData()).entries());
  const portal = body.portal === "admin" ? "admin" : body.portal === "bpo" ? "bpo" : "agent";
  const cookie = portal === "admin" ? ADMIN_SESSION_COOKIE : portal === "bpo" ? BPO_SESSION_COOKIE : AGENT_SESSION_COOKIE;
  const token = (await cookies()).get(cookie)?.value;
  const session = await readSession(token);

  if (session) {
    try {
      await (await db()).query(
        "INSERT INTO notifications (id, agent_id, title, message, category) VALUES ($1,$2,$3,$4,$5)",
        [randomUUID(), session.agentId, "Signed out", `Your ${portal} session was ended.`, "INBOX"],
      );
    } catch {
      // Session clearing should still succeed if the notification cannot be saved.
    }
  }

  const redirectPath = portal === "admin" ? "/controler/login" : portal === "bpo" ? "/bpo/login" : "/login";
  // A 303 deliberately changes the form POST into a normal GET for the login page.
  const response = NextResponse.redirect(new URL(redirectPath, request.url), 303);
  response.headers.append("Set-Cookie", `${cookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
