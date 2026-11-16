import { localMonitorConnection } from "@/lib/local-monitor-connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return localMonitorConnection("bpo"); }
export async function POST(request: Request) { return localMonitorConnection("bpo", request); }
