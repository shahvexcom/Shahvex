import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "./database";
import { ADMIN_SESSION_COOKIE, readSession } from "./session";
import { requireApprovedBpo } from "./bpo-session";
import { decryptCredential } from "./credential-crypto";
import { vicidialLiveConfig } from "./vicidial-config";
import { liveAudioProxy } from "./live-audio-proxy";
import { principal } from "./voip-controller";
import { localBridgeURL } from "./local-monitor-connection";
import { bridgeSignature } from "./vicidial-bridge";

export async function liveCallListen(portal: "admin" | "bpo", request: Request, local = false) {
  const id = new URL(request.url).searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success) return Response.json({ message: "Invalid call ID." }, { status: 400 });
  try {
    if (local) {
      const owner = await principal(portal);
      if (!owner) return Response.json({ message: "Unauthenticated" }, { status: 401 });
      const row = (await (await db()).query("SELECT local_url,local_secret_ciphertext FROM live_monitor_settings WHERE owner_id=$1", [owner])).rows[0];
      if (!row?.local_url || !row.local_secret_ciphertext) return Response.json({ message: "Local bridge not connected." }, { status: 409 });
      const base = localBridgeURL(row.local_url), secret = decryptCredential(row.local_secret_ciphertext), stamp = String(Date.now());
      const response = await fetch(base + "/local-monitor", { redirect: "error", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]), headers: { "x-shahvex-timestamp": stamp, "x-shahvex-signature": bridgeSignature(secret, stamp, "GET", "/local-monitor", Buffer.alloc(0)) } });
      const data = await response.json();
      if (!response.ok || data.testOnly !== true || !Array.isArray(data.calls) || !data.calls.some((c: {id: string; status: string}) => c.id === id && c.status === "ANSWERED")) return Response.json({ message: "Live local call not found." }, { status: 404 });
      return await liveAudioProxy(base, secret, id!, request, true);
    }
    const session = portal === "bpo" ? await requireApprovedBpo() : await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
    if (!session || session.role !== (portal === "bpo" ? "BPO" : "ADMIN")) return Response.json({ message: "Unauthenticated" }, { status: 401 });
    const scope = portal === "bpo" ? "EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id AND b.bpo_id=$2)" : "NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=c.agent_id)";
    const call = (await (await db()).query(`SELECT v.live_config,v.bridge_secret_ciphertext FROM agent_calls c JOIN agents a ON a.id=c.agent_id JOIN voip_connections v ON v.id=c.voip_connection_id WHERE c.id=$1 AND a.deleted_at IS NULL AND c.status='ANSWERED' AND NOT c.ai_leg_released AND c.telephony_provider IN ('VICIDIAL','AUDIOSOCKET') AND ${scope}`, portal === "bpo" ? [id, session.agentId] : [id])).rows[0];
    if (!call) return Response.json({ message: "Live call not found." }, { status: 404 });
    const live = vicidialLiveConfig.parse(call.live_config);
    return await liveAudioProxy(live.bridgeUrl, decryptCredential(call.bridge_secret_ciphertext), id!, request);
  } catch { return Response.json({ message: "Live listening could not connect. Check the call and try again." }, { status: 503 }); }
}
