import { localMonitorConnection } from "@/lib/local-monitor-connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return localMonitorConnection("admin"); }
export async function POST(request: Request) { return localMonitorConnection("admin", request); }
