module.exports=[70406,(e,r,t)=>{r.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},18622,(e,r,t)=>{r.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},20635,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/action-async-storage.external.js",()=>require("next/dist/server/app-render/action-async-storage.external.js"))},24725,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},56704,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},59043,(e,r,t)=>{r.exports=e.x("next/dist/server/runtime-reacts.external.js",()=>require("next/dist/server/runtime-reacts.external.js"))},93695,(e,r,t)=>{r.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},66680,(e,r,t)=>{r.exports=e.x("node:crypto",()=>require("node:crypto"))},81111,(e,r,t)=>{r.exports=e.x("node:stream",()=>require("node:stream"))},23862,e=>e.a(async(r,t)=>{try{var n=await e.y("pg-587764f78a6c7a9c");e.n(n),t()}catch(e){t(e)}},!0),98328,e=>{"use strict";async function r(e,r){let t=(await e.query(`
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
  `,[r])).rows[0]||{};return{calls:Number(t.calls||0),minutes:Number(t.minutes||0),recordings:Number(t.recordings||0)}}async function n(e){let r=(await e.query(`SELECT agent_unit_price::float8 agent_unit_price,call_unit_price::float8 call_unit_price,
    minute_unit_price::float8 minute_unit_price,recording_unit_price::float8 recording_unit_price,
    storage_unit_price::float8 storage_unit_price,storage_unit
    FROM bpo_usage_pricing WHERE id=1`)).rows[0]||{};return{agentUnitPrice:Number(r.agent_unit_price||0),callUnitPrice:Number(r.call_unit_price||0),minuteUnitPrice:Number(r.minute_unit_price||0),recordingUnitPrice:Number(r.recording_unit_price||0),storageUnitPrice:Number(r.storage_unit_price||0),storageUnit:"MB"===r.storage_unit?"MB":"GB"}}e.s(["bpoEntitlements",0,r,"bpoLeadUsage",0,t,"bpoUsagePricing",0,n])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0jv_8sm._.js.map