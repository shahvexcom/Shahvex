module.exports=[54799,(e,r,t)=>{r.exports=e.x("crypto",()=>require("crypto"))},70406,(e,r,t)=>{r.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},18622,(e,r,t)=>{r.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},20635,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/action-async-storage.external.js",()=>require("next/dist/server/app-render/action-async-storage.external.js"))},24725,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},56704,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},59043,(e,r,t)=>{r.exports=e.x("next/dist/server/runtime-reacts.external.js",()=>require("next/dist/server/runtime-reacts.external.js"))},93695,(e,r,t)=>{r.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},66680,(e,r,t)=>{r.exports=e.x("node:crypto",()=>require("node:crypto"))},81111,(e,r,t)=>{r.exports=e.x("node:stream",()=>require("node:stream"))},23862,e=>e.a(async(r,t)=>{try{var i=await e.y("pg-587764f78a6c7a9c");e.n(i),t()}catch(e){t(e)}},!0),20387,e=>{e.v(r=>Promise.all(["server/chunks/[root-of-the-server]__0taq3vq._.js"].map(r=>e.l(r))).then(()=>r(66436)))},98328,e=>{"use strict";async function r(e,r){let t=(await e.query(`
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
  `,[r])).rows[0]||{};return{agents:Number(t.agents||0),calls:Number(t.calls||0),minutes:Number(t.minutes||0),recordings:Number(t.recordings||0)}}async function t(e,r){let t=(await e.query(`
    SELECT
      COUNT(*)::int AS calls,
      COALESCE(CEIL(SUM(CASE WHEN c.status IN ('INITIATED','RINGING','ANSWERED')
        THEN EXTRACT(EPOCH FROM (NOW()-COALESCE(c.answered_at,c.created_at)))
        ELSE c.duration_seconds END)/60.0),0)::int AS minutes,
      COUNT(*) FILTER (WHERE c.recording_url <> '' OR c.recording_active=TRUE)::int AS recordings
    FROM agent_calls c
    JOIN bpo_created_agents b ON b.agent_id=c.agent_id
    WHERE b.bpo_id=$1 AND c.call_type='LEAD'
  `,[r])).rows[0]||{};return{calls:Number(t.calls||0),minutes:Number(t.minutes||0),recordings:Number(t.recordings||0)}}async function i(e){let r=(await e.query(`SELECT agent_unit_price::float8 agent_unit_price,call_unit_price::float8 call_unit_price,
    minute_unit_price::float8 minute_unit_price,recording_unit_price::float8 recording_unit_price,
    storage_unit_price::float8 storage_unit_price,storage_unit
    FROM bpo_usage_pricing WHERE id=1`)).rows[0]||{};return{agentUnitPrice:Number(r.agent_unit_price||0),callUnitPrice:Number(r.call_unit_price||0),minuteUnitPrice:Number(r.minute_unit_price||0),recordingUnitPrice:Number(r.recording_unit_price||0),storageUnitPrice:Number(r.storage_unit_price||0),storageUnit:"MB"===r.storage_unit?"MB":"GB"}}e.s(["bpoEntitlements",0,r,"bpoLeadUsage",0,t,"bpoUsagePricing",0,i])},34757,e=>e.a(async(r,t)=>{try{var i=e.i(93458),n=e.i(58574),s=e.i(93759),a=r([n]);async function o(){let e=await (0,s.readSession)((await (0,i.cookies)()).get(s.BPO_SESSION_COOKIE)?.value);return e&&"BPO"===e.role&&(await (await (0,n.db)()).query("SELECT id FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED'",[e.agentId])).rows[0]?e:null}[n]=a.then?(await a)():a,e.s(["requireApprovedBpo",0,o]),t()}catch(e){t(e)}},!1),23073,e=>{e.v(r=>Promise.all(["server/chunks/lib_local-voice-registry_ts_1fx20_1._.js"].map(r=>e.l(r))).then(()=>r(70599)))},56854,e=>{e.v(r=>Promise.all(["server/chunks/lib_pc-ai-engine_ts_17_-w_3._.js"].map(r=>e.l(r))).then(()=>r(79902)))},5732,e=>{e.v(r=>Promise.all(["server/chunks/lib_1m7jidi._.js","server/chunks/[root-of-the-server]__16avfw-._.js"].map(r=>e.l(r))).then(()=>r(88080)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__1t_e-_j._.js.map