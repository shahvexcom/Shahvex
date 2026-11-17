import { localMonitorControl } from "@/lib/local-monitor-controls";
export const runtime = "nodejs";
export async function GET(request: Request) { return localMonitorControl("bpo", request); }
export async function POST(request: Request) { return localMonitorControl("bpo", request); }
