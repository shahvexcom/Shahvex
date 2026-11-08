type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const MB = 1024 * 1024;
const GB = 1024 * MB;
const number = (value: unknown) => Number(value || 0);

export type BpoStorageSummary = {
  limitBytes: number;
  usedBytes: number;
  remainingBytes: number;
  scriptBytes: number;
  recordingBytes: number;
  hasActivePlan: boolean;
};

async function remoteFileSize(url: string) {
  try {
    let response = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(3_000) });
    let size = Number(response.headers.get("content-length") || 0);
    if (!Number.isFinite(size) || size <= 0) {
      response = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store", signal: AbortSignal.timeout(3_000) });
      const range = response.headers.get("content-range") || "";
      const total = /\/(\d+)$/.exec(range)?.[1];
      size = Number(total || response.headers.get("content-length") || 0);
    }
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

export async function backfillBpoRecordingSizes(client: QueryClient, bpoId: string) {
  const callScope = `(c.agent_id=$1 OR EXISTS (SELECT 1 FROM script_assignments sa WHERE sa.agent_id=c.agent_id AND sa.created_by=$1))`;
  const recordings = await client.query(`SELECT c.id,c.recording_url FROM agent_calls c
    WHERE c.recording_url IS NOT NULL AND c.recording_url<>'' AND COALESCE(c.recording_size_bytes,0)=0 AND ${callScope}
    ORDER BY c.updated_at DESC LIMIT 25`, [bpoId]);
  await Promise.all(recordings.rows.map(async recording => {
    const size = await remoteFileSize(String(recording.recording_url || ""));
    if (size > 0) await client.query("UPDATE agent_calls SET recording_size_bytes=$1,updated_at=NOW() WHERE id=$2 AND COALESCE(recording_size_bytes,0)=0", [size, recording.id]);
  }));
}

export async function getBpoStorageSummary(client: QueryClient, bpoId: string): Promise<BpoStorageSummary> {
  const callScope = `(c.agent_id=$1 OR EXISTS (SELECT 1 FROM script_assignments sa WHERE sa.agent_id=c.agent_id AND sa.created_by=$1))`;
  const [purchase, files, recordings] = await Promise.all([
    client.query(`SELECT
      (SELECT COUNT(*)::int FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE) AS active_plans,
      (COALESCE((SELECT SUM(storage_amount * CASE WHEN storage_unit='GB' THEN ${GB} ELSE ${MB} END)
        FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE),0)
       + COALESCE((SELECT SUM(quantity * CASE WHEN storage_unit='GB' THEN ${GB} ELSE ${MB} END)
        FROM bpo_usage_addon_purchases WHERE bpo_id=$1 AND product_type='STORAGE'),0))::float8 AS storage_bytes`, [bpoId]),
    client.query(`SELECT
      COALESCE(SUM(CASE WHEN COALESCE(script_file_size,0)>0 THEN script_file_size ELSE octet_length(COALESCE(script_text,'')) END),0)::float8 script_bytes,
      COALESCE(SUM(CASE WHEN COALESCE(lead_file_size,0)>0 THEN lead_file_size ELSE octet_length(COALESCE(lead_rows::text,'[]')) END),0)::float8 lead_bytes
      FROM script_assignments WHERE agent_id=$1`, [bpoId]),
    client.query(`SELECT COALESCE(SUM(COALESCE(c.recording_size_bytes,0)),0)::float8 recording_bytes
      FROM agent_calls c WHERE c.recording_url IS NOT NULL AND c.recording_url<>'' AND ${callScope}`, [bpoId]),
  ]);
  const plan = purchase.rows[0];
  const limitBytes = number(plan?.storage_bytes);
  const scriptBytes = number(files.rows[0]?.script_bytes) + number(files.rows[0]?.lead_bytes);
  const recordingBytes = number(recordings.rows[0]?.recording_bytes);
  const usedBytes = scriptBytes + recordingBytes;
  return {
    limitBytes,
    usedBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    scriptBytes,
    recordingBytes,
    hasActivePlan: number(plan?.active_plans) > 0 || limitBytes > 0,
  };
}
