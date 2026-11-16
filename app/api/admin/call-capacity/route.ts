import { principal } from '@/lib/voip-controller';
import { isSameRequestOrigin } from '@/lib/request-origin';
import { callCapacityRequest } from '@/lib/call-capacity';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function proxy(init:RequestInit={}){
 try{const response=await callCapacityRequest(init);const data=await response.json();return Response.json(data,{status:response.status,headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'Call capacity service is unavailable. Retry after checking the AI adapter.'},{status:503});}
}
export async function GET(){if(!await principal('admin'))return Response.json({error:'Administrator VoIP access required'},{status:403});return proxy();}
export async function POST(request:Request){
 if(!await principal('admin'))return Response.json({error:'Administrator VoIP access required'},{status:403});
 if(!isSameRequestOrigin(request))return Response.json({error:'Same-origin request required'},{status:403});
 const text=await request.text();if(text.length>100)return Response.json({error:'Request too large'},{status:413});
 let limit;try{limit=JSON.parse(text).limit;}catch{return Response.json({error:'Invalid capacity'},{status:400});}
 if(!Number.isInteger(limit)||limit<1||limit>300)return Response.json({error:'Choose a whole number from 1 to 300'},{status:400});
 return proxy({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit})});
}
