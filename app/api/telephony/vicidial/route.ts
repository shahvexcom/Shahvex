import { vicidialCallback } from "@/lib/vicidial-callback";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request) {
  try {return await vicidialCallback(request);}catch(error) {console.error("VICIdial callback failed",error instanceof Error?error.message:"Unknown failure");return Response.json({error:"VICIdial event could not be processed; retry or inspect server logs"},{status:503});}
}
