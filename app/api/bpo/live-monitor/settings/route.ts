import { monitorSettings } from "@/lib/live-monitor-settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return monitorSettings("bpo"); }
export async function POST(request: Request) { return monitorSettings("bpo", request); }
