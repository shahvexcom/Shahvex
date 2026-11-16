import { z } from "zod";
import { db } from "./database";
import { principal } from "./voip-controller";
import { defaultInitialScript } from "./agent-script-details";

const schema = z.object({ initialScript: z.string().trim().min(10).max(16000) }).strict();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function monitorSettings(portal: "admin" | "bpo", request?: Request) {
  const owner = await principal(portal);
  if (!owner) return json({ error: "VoIP access is not authorized." }, 403);
  const client = await db();
  if (request) {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Enter an initial script between 10 and 16,000 characters." }, 400);
    await client.query(`INSERT INTO live_monitor_settings(owner_id,initial_script) VALUES($1,$2)
      ON CONFLICT(owner_id) DO UPDATE SET initial_script=EXCLUDED.initial_script,updated_at=NOW()`, [owner, parsed.data.initialScript]);
    return json({ initialScript: parsed.data.initialScript, message: "Initial script saved. Click Connect localhost to apply it to the next local call." });
  }
  const result = await client.query("SELECT initial_script FROM live_monitor_settings WHERE owner_id=$1", [owner]);
  return json({ initialScript: result.rows[0]?.initial_script || defaultInitialScript });
}
