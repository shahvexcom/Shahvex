import { liveCallListen } from "@/lib/live-call-listen";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return liveCallListen("admin", request, true); }
