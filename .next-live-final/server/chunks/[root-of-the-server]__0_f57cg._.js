module.exports=[70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},20635,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/action-async-storage.external.js",()=>require("next/dist/server/app-render/action-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},59043,(e,t,r)=>{t.exports=e.x("next/dist/server/runtime-reacts.external.js",()=>require("next/dist/server/runtime-reacts.external.js"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},66680,(e,t,r)=>{t.exports=e.x("node:crypto",()=>require("node:crypto"))},81111,(e,t,r)=>{t.exports=e.x("node:stream",()=>require("node:stream"))},23862,e=>e.a(async(t,r)=>{try{var a=await e.y("pg-587764f78a6c7a9c");e.n(a),r()}catch(e){r(e)}},!0),98328,e=>{"use strict";async function t(e,t){let r=(await e.query(`
    SELECT
      COALESCE((SELECT SUM(agent_limit) FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE),0)::int
        + COALESCE(SUM(quantity) FILTER (WHERE product_type='AGENT'),0)::int AS agents,
      COALESCE((SELECT SUM(call_limit) FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE),0)::int
        + COALESCE(SUM(quantity) FILTER (WHERE product_type='CALL'),0)::int AS calls,
      COALESCE((SELECT SUM(total_minutes) FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE),0)::int
        + COALESCE(SUM(quantity) FILTER (WHERE product_type='MINUTE'),0)::int AS minutes,
      COALESCE(SUM(quantity) FILTER (WHERE product_type='RECORDING'),0)::int AS recordings
    FROM bpo_usage_addon_purchases
    WHERE bpo_id=$1
  `,[t])).rows[0]||{};return{agents:Number(r.agents||0),calls:Number(r.calls||0),minutes:Number(r.minutes||0),recordings:Number(r.recordings||0)}}async function r(e,t){let r=(await e.query(`
    SELECT
      COUNT(*)::int AS calls,
      COALESCE(CEIL(SUM(CASE WHEN c.status IN ('INITIATED','RINGING','ANSWERED')
        THEN EXTRACT(EPOCH FROM (NOW()-COALESCE(c.answered_at,c.created_at)))
        ELSE c.duration_seconds END)/60.0),0)::int AS minutes,
      COUNT(*) FILTER (WHERE c.recording_url <> '' OR c.recording_active=TRUE)::int AS recordings
    FROM agent_calls c
    JOIN bpo_created_agents b ON b.agent_id=c.agent_id
    WHERE b.bpo_id=$1 AND c.call_type='LEAD'
  `,[t])).rows[0]||{};return{calls:Number(r.calls||0),minutes:Number(r.minutes||0),recordings:Number(r.recordings||0)}}async function a(e){let t=(await e.query(`SELECT agent_unit_price::float8 agent_unit_price,call_unit_price::float8 call_unit_price,
    minute_unit_price::float8 minute_unit_price,recording_unit_price::float8 recording_unit_price,
    storage_unit_price::float8 storage_unit_price,storage_unit
    FROM bpo_usage_pricing WHERE id=1`)).rows[0]||{};return{agentUnitPrice:Number(t.agent_unit_price||0),callUnitPrice:Number(t.call_unit_price||0),minuteUnitPrice:Number(t.minute_unit_price||0),recordingUnitPrice:Number(t.recording_unit_price||0),storageUnitPrice:Number(t.storage_unit_price||0),storageUnit:"MB"===t.storage_unit?"MB":"GB"}}e.s(["bpoEntitlements",0,t,"bpoLeadUsage",0,r,"bpoUsagePricing",0,a])},34757,e=>e.a(async(t,r)=>{try{var a=e.i(93458),i=e.i(58574),n=e.i(93759),s=t([i]);async function c(){let e=await (0,n.readSession)((await (0,a.cookies)()).get(n.BPO_SESSION_COOKIE)?.value);return e&&"BPO"===e.role&&(await (await (0,i.db)()).query("SELECT id FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED'",[e.agentId])).rows[0]?e:null}[i]=s.then?(await s)():s,e.s(["requireApprovedBpo",0,c]),r()}catch(e){r(e)}},!1),29954,e=>{"use strict";async function t(e){try{let t=await fetch(e,{method:"HEAD",cache:"no-store",signal:AbortSignal.timeout(3e3)}),r=Number(t.headers.get("content-length")||0);if(!Number.isFinite(r)||r<=0){let a=(t=await fetch(e,{headers:{Range:"bytes=0-0"},cache:"no-store",signal:AbortSignal.timeout(3e3)})).headers.get("content-range")||"",i=/\/(\d+)$/.exec(a)?.[1];r=Number(i||t.headers.get("content-length")||0)}return Number.isFinite(r)&&r>0?r:0}catch{return 0}}async function r(e,r){let a=await e.query(`SELECT c.id,c.recording_url FROM agent_calls c
    WHERE c.recording_url IS NOT NULL AND c.recording_url<>'' AND COALESCE(c.recording_size_bytes,0)=0 AND (c.agent_id=$1 OR EXISTS (SELECT 1 FROM script_assignments sa WHERE sa.agent_id=c.agent_id AND sa.created_by=$1))
    ORDER BY c.updated_at DESC LIMIT 25`,[r]);await Promise.all(a.rows.map(async r=>{let a=await t(String(r.recording_url||""));a>0&&await e.query("UPDATE agent_calls SET recording_size_bytes=$1,updated_at=NOW() WHERE id=$2 AND COALESCE(recording_size_bytes,0)=0",[a,r.id])}))}async function a(e,t){let[r,a,i]=await Promise.all([e.query(`SELECT
      (SELECT COUNT(*)::int FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE) AS active_plans,
      (COALESCE((SELECT SUM(storage_amount * CASE WHEN storage_unit='GB' THEN 1073741824 ELSE 1048576 END)
        FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE),0)
       + COALESCE((SELECT SUM(quantity * CASE WHEN storage_unit='GB' THEN 1073741824 ELSE 1048576 END)
        FROM bpo_usage_addon_purchases WHERE bpo_id=$1 AND product_type='STORAGE'),0))::float8 AS storage_bytes`,[t]),e.query(`SELECT
      COALESCE(SUM(CASE WHEN COALESCE(script_file_size,0)>0 THEN script_file_size ELSE octet_length(COALESCE(script_text,'')) END),0)::float8 script_bytes,
      COALESCE(SUM(CASE WHEN COALESCE(lead_file_size,0)>0 THEN lead_file_size ELSE octet_length(COALESCE(lead_rows::text,'[]')) END),0)::float8 lead_bytes
      FROM script_assignments WHERE agent_id=$1`,[t]),e.query(`SELECT COALESCE(SUM(COALESCE(c.recording_size_bytes,0)),0)::float8 recording_bytes
      FROM agent_calls c WHERE c.recording_url IS NOT NULL AND c.recording_url<>'' AND (c.agent_id=$1 OR EXISTS (SELECT 1 FROM script_assignments sa WHERE sa.agent_id=c.agent_id AND sa.created_by=$1))`,[t])]),n=r.rows[0],s=Number(n?.storage_bytes||0),c=Number(a.rows[0]?.script_bytes||0)+Number(a.rows[0]?.lead_bytes||0),E=Number(i.rows[0]?.recording_bytes||0),o=c+E;return{limitBytes:s,usedBytes:o,remainingBytes:Math.max(0,s-o),scriptBytes:c,recordingBytes:E,hasActivePlan:Number(n?.active_plans||0)>0||s>0}}e.s(["backfillBpoRecordingSizes",0,r,"getBpoStorageSummary",0,a])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0_f57cg._.js.map