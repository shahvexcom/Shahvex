import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

async function requireAdmin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return session?.role === "ADMIN" ? session : null;
}

export async function GET() {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  return Response.json({ message: "BPO calling-agent history is available only in the BPO workspace." }, { status: 403 });
}
