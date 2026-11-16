import { campaignOperationFailure } from "@/lib/campaign-operation-error";
import { getCampaigns,postCampaigns } from "@/lib/campaign-controller";
export const runtime='nodejs';export const maxDuration=300;
export async function GET(request:Request){try{return await getCampaigns(request,'bpo');}catch{return Response.json({error:'Unable to load campaigns'},{status:503});}}
export async function POST(request:Request){try{return await postCampaigns(request,'bpo');}catch(error){return campaignOperationFailure(error);}}
