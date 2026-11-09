import "server-only";
import { db } from "./database";
export type LocalVoice = {id:string;name:string;gender:string;language:string;accent:string;selectable:boolean;transcript_verified?:boolean};
export async function registeredVoices(owner: string, backend: {defaultVoice:string;voices:LocalVoice[]}) {
  if(!backend.voices.some(v=>v.language==="English"||/^en(?:-|$)/i.test(v.language)))throw Error("No selectable English backend voices are available");
  const pool=await db(), c=await pool.connect();
  try{
    await c.query("BEGIN");
    const initialized=await c.query("INSERT INTO local_voice_bootstrap(id) VALUES('existing-backend') ON CONFLICT DO NOTHING RETURNING id");
    if(initialized.rows.length)for(const v of backend.voices.filter(v=>v.language==="English"||/^en(?:-|$)/i.test(v.language)))await c.query(`INSERT INTO local_voice_registry(id,name,gender,language,accent,status,service_trusted,is_global)
      VALUES($1,$2,$3,'English',$4,'ACTIVE',TRUE,TRUE) ON CONFLICT(id) DO NOTHING`,[v.id,v.name,v.gender,"American English"]);
    const confirmed=await c.query("INSERT INTO local_voice_bootstrap(id) VALUES('existing-american-english-v1') ON CONFLICT DO NOTHING RETURNING id");
    if(confirmed.rows.length)await c.query("UPDATE local_voice_registry SET language='English',accent='American English',updated_at=NOW() WHERE service_trusted=TRUE");
    await c.query("COMMIT");
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  const rows=await pool.query(`SELECT id,name,gender,language,accent FROM local_voice_registry
    WHERE status='ACTIVE' AND (service_trusted=TRUE OR (rights_verified=TRUE AND transcript_verified=TRUE))
    AND language='English' AND (is_global=TRUE OR owner_id=$1)`,[owner]);
  const enabled=new Set(backend.voices.map(v=>v.id));
  const voices=rows.rows.filter(v=>enabled.has(v.id)).map(v=>({...v,selectable:true})) as LocalVoice[];
  return {defaultVoice:voices.some(v=>v.id===backend.defaultVoice)?backend.defaultVoice:voices[0]?.id||"",voices};
}
