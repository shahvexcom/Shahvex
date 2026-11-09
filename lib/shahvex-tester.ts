import "server-only";
import { boundedRequest, createShahvexSession, ownedShahvexSession, shahvexAgent, shahvexBinding, shahvexPrincipal, shahvexRate } from "./shahvex-access";
import { shahvexFailure, shahvexJson, ShahvexError } from "./shahvex-api";
import { shahvexSession } from "./shahvex-routes";

export async function getShahvexTester(request:Request) {
  try {
    const s=await shahvexPrincipal("admin");await shahvexRate(s.agentId);
    const a=await shahvexAgent(s,new URL(request.url).searchParams.get("agentId")||"");
    await shahvexBinding(a);
    return shahvexJson({transport:"shahvex",agent:{name:a.name,avatarUrl:a.avatar_url||"",accent:a.accent,language:a.language},
      voices:[{id:a.local_voice_id,name:"Assigned voice",accent:a.accent}],defaultVoice:a.local_voice_id,
      config:{name:a.name,voice:a.local_voice_id,first:a.speaks_first,goal:"",task:"",instructions:"",script:a.script,knowledge:"",style:a.conversation_style}});
  }catch(e){return shahvexFailure(e);}
}
export async function postShahvexTester(request:Request) {
  try {
    const s=await shahvexPrincipal("admin");await shahvexRate(s.agentId);
    const url=new URL(request.url),action=url.searchParams.get("action"),id=url.searchParams.get("id")||"";
    if(action==="start"){
      let body;try{body=JSON.parse((await boundedRequest(request,70000)).toString());}catch(e){if(e instanceof ShahvexError)throw e;throw new ShahvexError(400,"Invalid session request");}
      if(typeof body.agentId!=="string"||Object.keys(body).some(k=>k!=="agentId"))throw new ShahvexError(400,"Remote testing uses only the saved agent configuration");
      return shahvexJson({id:await createShahvexSession(s,body.agentId)});
    }
    if(action==="stop")return shahvexSession(request,id,true);
    if(action==="interrupt"){
      await ownedShahvexSession(s,id);
      // Browser aborts its original streaming request. No fictitious upstream interrupt API.
      return shahvexJson({clientCancellation:true});
    }
    throw new ShahvexError(409,"The connected gateway does not support configuration extraction, voice preview or this tester operation");
  }catch(e){return shahvexFailure(e);}
}
