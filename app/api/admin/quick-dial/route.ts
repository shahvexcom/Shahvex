import { GET as quickDialGet, POST as quickDialPost } from "@/app/api/bpo/quick-dial/route";

export const runtime = "nodejs";

const quickDialAvailable = () => false;
export async function GET(request: Request) {
  if(!quickDialAvailable())return Response.json({message:"Quick Dial is not available."},{status:410});
  return quickDialGet(request);
}

export async function POST(request: Request) {
  if(!quickDialAvailable())return Response.json({message:"Quick Dial is not available."},{status:410});
  return quickDialPost(request);
}
