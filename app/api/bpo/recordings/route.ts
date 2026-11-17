import { recordingLookup } from "@/lib/recording-lookup";
export const runtime = "nodejs";
export async function GET(request: Request) { return recordingLookup("bpo", request); }
