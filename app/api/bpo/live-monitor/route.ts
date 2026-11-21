import { liveCallMonitor } from "@/lib/live-call-monitor";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return liveCallMonitor("bpo", new URL(request.url).searchParams); }
