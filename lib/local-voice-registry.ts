import "server-only";
import { db } from "./database";
export type LocalVoice = {id:string;name:string;gender:string;language:string;accent:string;selectable:boolean;serviceReady?:boolean;transcript_verified?:boolean};
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
    for(const voice of backend.voices.filter(v=>["emma","olivia"].includes(v.id))) await c.query(`INSERT INTO local_voice_registry(id,name,gender,language,accent,status,service_trusted,is_global)
      VALUES($1,$2,$3,'English',$4,'ACTIVE',TRUE,TRUE) ON CONFLICT(id) DO NOTHING`,[voice.id,voice.name,voice.gender,voice.accent||"English"]);
    await c.query("COMMIT");
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  const rows=await pool.query(`SELECT id,name,gender,language,accent FROM local_voice_registry
    WHERE status='ACTIVE' AND (service_trusted=TRUE OR (rights_verified=TRUE AND transcript_verified=TRUE))
    AND language='English' AND (is_global=TRUE OR owner_id=$1)`,[owner]);
  const enabled=new Set(backend.voices.map(v=>v.id));
  // An offline independent engine must not erase an approved saved clone.
  // Approval and ownership are still enforced by the registry query above.
  const voices=rows.rows.filter(v=>enabled.has(v.id)||["lissa","emma","olivia"].includes(v.id))
    .map(v=>({...v,selectable:true,serviceReady:enabled.has(v.id)})) as LocalVoice[];
  return {defaultVoice:voices.some(v=>v.id===backend.defaultVoice)?backend.defaultVoice:voices[0]?.id||"",voices};
}

/** Saved, approved clones remain configurable while the synthesis service is offline. */
export async function savedVoiceCatalog(owner?: string) {
  const rows = await (await db()).query(`SELECT id,name,gender,language,accent FROM local_voice_registry
    WHERE id=ANY($2::text[]) AND status='ACTIVE' AND language='English'
    AND (service_trusted=TRUE OR (rights_verified=TRUE AND transcript_verified=TRUE))
    AND (is_global=TRUE OR owner_id=$1) ORDER BY name`, [owner || null, ["lissa", "emma", "olivia"]]);
  const voices = rows.rows.map(voice => ({...voice, selectable:true})) as LocalVoice[];
  return {defaultVoice:voices.some(voice=>voice.id==='lissa')?'lissa':voices[0]?.id||'',voices};
}
