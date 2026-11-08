import "server-only";
import { randomUUID } from "node:crypto";
import { backendClient } from "../gateway/backend-client.cjs";

type Relay = { owner: string; request: ReturnType<ReturnType<typeof backendClient>["stream"]>["request"]; session: { id: string; sessionToken: string }; client: ReturnType<typeof backendClient>; events: string[]; listener?: (data: string) => void; timer: ReturnType<typeof setTimeout>; closed: boolean };
const state = globalThis as unknown as { localVoiceRelays?: Map<string, Relay>; localVoiceMaintenance?: boolean; localVoiceDeploymentLockUntil?: number };
state.localVoiceMaintenance ??= process.env.SHAHVEX_LOCAL_VOICE_MAINTENANCE === "1";
export const relays = state.localVoiceRelays ??= new Map<string, Relay>();
const starting = new Set<string>();
export function voiceMaintenance(enabled?: boolean) {
  if(enabled===false && (state.localVoiceDeploymentLockUntil || 0)>Date.now())throw Error('Deployment proof is armed; maintenance cannot be released yet');
  if (enabled !== undefined) state.localVoiceMaintenance = enabled;
  return { maintenance: state.localVoiceMaintenance === true, activeRelays: relays.size, startingRelays: starting.size };
}
export function lockDeploymentMaintenance(){state.localVoiceMaintenance=true;state.localVoiceDeploymentLockUntil=Date.now()+180000;return voiceMaintenance();}
export async function closeRelay(id: string) {
  const r = relays.get(id); if (!r || r.closed) return;
  r.closed = true; clearTimeout(r.timer); relays.delete(id); r.request.destroy();
  r.listener?.(JSON.stringify({ type: "closed" })); await r.client.close(r.session);
}
export async function createRelay(owner: string, config: object) {
  if (state.localVoiceMaintenance) throw Error("Local voice maintenance; new sessions disabled");
  if (starting.has(owner) || [...relays.values()].some(r => r.owner === owner)) throw Error("Stop your existing voice test first");
  starting.add(owner);
  try {
  const client = backendClient({ baseUrl: process.env.SHAHVEX_GATEWAY_URL || "http://127.0.0.1:8787", token: process.env.SHAHVEX_GATEWAY_TOKEN, timeoutMs: 600000 });
  const session = await client.create(config); const id = randomUUID();
  const stream = client.stream(session, (event: object) => {
    const r = relays.get(id); if (!r) return;
    const data = JSON.stringify(event);
    if (r.listener) r.listener(data);
    else if (r.events.length < 50) r.events.push(data);
    else void closeRelay(id).catch(() => {});
  });
  const timer = setTimeout(() => { void closeRelay(id).catch(() => {}); }, 600000);
  relays.set(id, { owner, client, session, request: stream.request, events: [], timer, closed: false });
  stream.request.flushHeaders();
  void stream.done.then(() => closeRelay(id), () => closeRelay(id)).catch(() => {});
  return id;
  } finally { starting.delete(owner); }
}
