import { getVoip, postVoip } from "@/lib/voip-controller";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => getVoip(request,"admin");
export const POST = (request: Request) => postVoip(request,"admin");
