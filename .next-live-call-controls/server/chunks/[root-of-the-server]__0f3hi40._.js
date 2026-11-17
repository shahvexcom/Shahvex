module.exports=[54799,(e,t,i)=>{t.exports=e.x("crypto",()=>require("crypto"))},20387,e=>{e.v(t=>Promise.all(["server/chunks/[root-of-the-server]__0taq3vq._.js"].map(t=>e.l(t))).then(()=>t(66436)))},98328,e=>{"use strict";async function t(e,t){let i=(await e.query(`
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
  `,[t])).rows[0]||{};return{agents:Number(i.agents||0),calls:Number(i.calls||0),minutes:Number(i.minutes||0),recordings:Number(i.recordings||0)}}async function i(e,t){let i=(await e.query(`
    SELECT
      COUNT(*)::int AS calls,
      COALESCE(CEIL(SUM(CASE WHEN c.status IN ('INITIATED','RINGING','ANSWERED')
        THEN EXTRACT(EPOCH FROM (NOW()-COALESCE(c.answered_at,c.created_at)))
        ELSE c.duration_seconds END)/60.0),0)::int AS minutes,
      COUNT(*) FILTER (WHERE c.recording_url <> '' OR c.recording_active=TRUE)::int AS recordings
    FROM agent_calls c
    JOIN bpo_created_agents b ON b.agent_id=c.agent_id
    WHERE b.bpo_id=$1 AND c.call_type='LEAD'
  `,[t])).rows[0]||{};return{calls:Number(i.calls||0),minutes:Number(i.minutes||0),recordings:Number(i.recordings||0)}}async function r(e){let t=(await e.query(`SELECT agent_unit_price::float8 agent_unit_price,call_unit_price::float8 call_unit_price,
    minute_unit_price::float8 minute_unit_price,recording_unit_price::float8 recording_unit_price,
    storage_unit_price::float8 storage_unit_price,storage_unit
    FROM bpo_usage_pricing WHERE id=1`)).rows[0]||{};return{agentUnitPrice:Number(t.agent_unit_price||0),callUnitPrice:Number(t.call_unit_price||0),minuteUnitPrice:Number(t.minute_unit_price||0),recordingUnitPrice:Number(t.recording_unit_price||0),storageUnitPrice:Number(t.storage_unit_price||0),storageUnit:"MB"===t.storage_unit?"MB":"GB"}}e.s(["bpoEntitlements",0,t,"bpoLeadUsage",0,i,"bpoUsagePricing",0,r])},23073,e=>{e.v(t=>Promise.all(["server/chunks/lib_local-voice-registry_ts_1fx20_1._.js"].map(t=>e.l(t))).then(()=>t(70599)))},56854,e=>{e.v(t=>Promise.all(["server/chunks/lib_pc-ai-engine_ts_17_-w_3._.js"].map(t=>e.l(t))).then(()=>t(79902)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0f3hi40._.js.map