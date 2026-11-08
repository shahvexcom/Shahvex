import { GET as quickDialGet, POST as quickDialPost } from "@/app/api/bpo/quick-dial/route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return quickDialGet(request);
}

export async function POST(request: Request) {
  return quickDialPost(request);
}
