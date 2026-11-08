import { NextRequest } from "next/server";
import { db } from "@/lib/database";

export async function GET(request: NextRequest) {
  const field = request.nextUrl.searchParams.get("field"); const value = request.nextUrl.searchParams.get("value")?.trim();
  if ((field !== "name" && field !== "username") || !value) return Response.json({ available: false }, { status: 400 });
  try { const column = field === "name" ? "name" : "username"; const result = await (await db()).query(`SELECT id FROM agents WHERE ${column} = $1 LIMIT 1`, [field === "username" ? value.toLowerCase() : value]); return Response.json({ available: result.rowCount === 0 }); }
  catch { return Response.json({ available: false, message: "Database is not reachable yet." }, { status: 503 }); }
}
