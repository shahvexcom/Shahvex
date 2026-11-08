import type { PoolClient } from "pg";

type QueryClient = Pick<PoolClient, "query">;

export type BpoEntitlements = {
  agents: number;
  calls: number;
  minutes: number;
  recordings: number;
};

const number = (value: unknown) => Number(value || 0);

/** Combined regular-plan and separately purchased BPO allowances. */
export async function bpoEntitlements(client: QueryClient, bpoId: string): Promise<BpoEntitlements> {
  const result = await client.query(`
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
  `, [bpoId]);
  const row = result.rows[0] || {};
  return { agents: number(row.agents), calls: number(row.calls), minutes: number(row.minutes), recordings: number(row.recordings) };
}

export async function bpoLeadUsage(client: QueryClient, bpoId: string) {
  const result = await client.query(`
    SELECT
      COUNT(*)::int AS calls,
      COALESCE(CEIL(SUM(CASE WHEN c.status IN ('INITIATED','RINGING','ANSWERED')
        THEN EXTRACT(EPOCH FROM (NOW()-COALESCE(c.answered_at,c.created_at)))
        ELSE c.duration_seconds END)/60.0),0)::int AS minutes,
      COUNT(*) FILTER (WHERE c.recording_url <> '' OR c.recording_active=TRUE)::int AS recordings
    FROM agent_calls c
    JOIN bpo_created_agents b ON b.agent_id=c.agent_id
    WHERE b.bpo_id=$1 AND c.call_type='LEAD'
  `, [bpoId]);
  const row = result.rows[0] || {};
  return { calls: number(row.calls), minutes: number(row.minutes), recordings: number(row.recordings) };
}

export type BpoUsagePricing = {
  agentUnitPrice: number;
  callUnitPrice: number;
  minuteUnitPrice: number;
  recordingUnitPrice: number;
  storageUnitPrice: number;
  storageUnit: "MB" | "GB";
};

export async function bpoUsagePricing(client: QueryClient): Promise<BpoUsagePricing> {
  const result = await client.query(`SELECT agent_unit_price::float8 agent_unit_price,call_unit_price::float8 call_unit_price,
    minute_unit_price::float8 minute_unit_price,recording_unit_price::float8 recording_unit_price,
    storage_unit_price::float8 storage_unit_price,storage_unit
    FROM bpo_usage_pricing WHERE id=1`);
  const row = result.rows[0] || {};
  return {
    agentUnitPrice: number(row.agent_unit_price),
    callUnitPrice: number(row.call_unit_price),
    minuteUnitPrice: number(row.minute_unit_price),
    recordingUnitPrice: number(row.recording_unit_price),
    storageUnitPrice: number(row.storage_unit_price),
    storageUnit: row.storage_unit === "MB" ? "MB" : "GB",
  };
}
