import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { closeRelay, createRelay, relays, voiceMaintenance, lockDeploymentMaintenance } from "@/lib/local-voice-relay";
import { issueLocalIdleProof } from "@/lib/issue-local-idle-proof";
import { GET as exportAgent } from "@/app/api/admin/agents/gateway-export/route";
import { sessionScript } from "../../../../gateway/test-script.cjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function browserOrigin(request: Request) {
  const url = new URL(request.url);
  // Direct loopback dev server only. Never trust X-Forwarded-Host/Origin here.
  const host = request.headers.get("host") || url.host;
  if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)) return null;
  try { const direct = new URL(`${url.protocol}//${host}`); return direct.origin; } catch { return null; }
}
function gate(request: Request) {
  const url = new URL(request.url);
  const directOrigin = browserOrigin(request);
  const checks = {
    optedIn: process.env.SHAHVEX_LOCAL_VOICE_TEST === "1",
    development: process.env.NODE_ENV === "development",
    notHosted: !process.env.VERCEL && !process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_ENVIRONMENT_ID && !process.env.RAILWAY_PROJECT_ID,
    loopback: ["localhost", "127.0.0.1"].includes(url.hostname),
    sameOrigin: directOrigin !== null && request.headers.get("origin") === directOrigin &&
      !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") || ""),
    gatewayUrlPresent: Boolean(process.env.SHAHVEX_GATEWAY_URL),
    gatewayTokenPresent: Boolean(process.env.SHAHVEX_GATEWAY_TOKEN),
    gatewayTokenValidLength: (process.env.SHAHVEX_GATEWAY_TOKEN?.length || 0) >= 32,
  };
  const reasons: string[] = [];
  if (!checks.optedIn) reasons.push("The running Next.js process does not have SHAHVEX_LOCAL_VOICE_TEST=1.");
  if (!checks.development) reasons.push("The running Next.js process is not in development mode.");
  if (!checks.notHosted) reasons.push("Vercel or Railway environment detected; local voice is disabled.");
  if (!checks.loopback) reasons.push("Open the local backend using localhost or 127.0.0.1.");
  if (!checks.sameOrigin) reasons.push("Browser Origin does not match the backend request origin; use one hostname consistently.");
  const enabled = reasons.length === 0;
  if (!checks.gatewayUrlPresent) reasons.push("SHAHVEX_GATEWAY_URL is missing from the running Next.js process.");
  if (!checks.gatewayTokenPresent) reasons.push("SHAHVEX_GATEWAY_TOKEN is missing from the running Next.js process.");
  else if (!checks.gatewayTokenValidLength) reasons.push("The configured Gateway token is too short; provide the existing token privately.");
  return { enabled, configured: checks.gatewayUrlPresent && checks.gatewayTokenValidLength, checks, reasons };
}
async function owner() { const s = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value); return s?.role === "ADMIN" ? s.agentId : null; }
export async function POST(request: Request) {
  const access = gate(request);
  if (!access.enabled) return Response.json({ error: access.reasons[0] }, { status: 403 });
  const user = await owner(); if (!user) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  try {
    const url = new URL(request.url), id = url.searchParams.get("id");
    if(url.searchParams.get('deploymentProof')==='1'){
      voiceMaintenance(true);
      const headers=new Headers(request.headers);headers.set('sec-fetch-site','same-origin');
      const response=await GET(new Request(`${url.origin}/api/admin/local-voice?gatewayHealth=1`,{headers}));
      const snapshot=await response.json();
      if(!response.ok || snapshot.authenticated!==true || snapshot.ready!==true || snapshot.maintenance!==true || snapshot.activeSessions!==0 || snapshot.queue?.active!==0 || snapshot.queue?.pending!==0 || snapshot.activeRelays!==0 || snapshot.startingRelays!==0)
        return Response.json({error:'Maintenance enabled, but Gateway is not authenticated, ready and drained'},{status:409});
      lockDeploymentMaintenance();
      const proof=await issueLocalIdleProof(snapshot);
      return Response.json(proof,{headers:{'Cache-Control':'no-store'}});
    }
    if (url.searchParams.has('maintenance')) {
      const setting=url.searchParams.get('maintenance');
      if (setting!=='1' && setting!=='0') return new Response(null,{status:400});
      return Response.json(voiceMaintenance(setting==='1'),{headers:{'Cache-Control':'no-store'}});
    }
    if (!id) {
      if (voiceMaintenance().maintenance) return Response.json({error:'Local voice maintenance; new sessions disabled'},{status:503});
      if (!process.env.SHAHVEX_GATEWAY_URL || !process.env.SHAHVEX_GATEWAY_TOKEN || process.env.SHAHVEX_GATEWAY_TOKEN.length < 32)
        return Response.json({ error: "Local backend Gateway URL/token configuration is missing" }, { status: 503 });
      const agentId = url.searchParams.get("agentId"); if (!agentId) return new Response(null, { status: 400 });
      const exported = await exportAgent(new Request(`${url.origin}/api/admin/agents/gateway-export?agentId=${encodeURIComponent(agentId)}`));
      if (!exported.ok) return exported;
      let options: { customScript?: unknown } = {};
      if (request.body) {
        let text = ''; const reader = request.body.getReader();
        const decoder = new TextDecoder(); let bytes = 0;
        try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 64000) { await reader.cancel(); return new Response(null, { status: 413 }); } text += decoder.decode(value, { stream: true }); } text += decoder.decode(); options = JSON.parse(text); }
        catch { return Response.json({ error: "Invalid test configuration" }, { status: 400 }); }
        if (!options || typeof options !== 'object' || Array.isArray(options)) return new Response(null, { status: 400 });
      }
      const config = await exported.json();
      try { config.script = sessionScript(config.script, options.customScript); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid test script' }, { status: 400 }); }
      return Response.json({ id: await createRelay(user, config), scriptMode: options.customScript === undefined ? 'assigned' : 'custom' });
    }
    const relay = relays.get(id);
    // Disconnect/deadline cleanup may already have removed this opaque handle.
    if (!relay && url.searchParams.get("stop") === "1") return Response.json({ closed: true });
    if (!relay || relay.owner !== user) return new Response(null, { status: 404 });
    if (url.searchParams.get("stop") === "1") { await closeRelay(id); return Response.json({ closed: true }); }
    if (Number(request.headers.get("content-length") || 0) > 6400) return new Response(null, { status: 413 });
    const chunks: Uint8Array[] = []; let size = 0;
    if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 6400) return new Response(null, { status: 413 }); chunks.push(chunk); }
    if (!size || size % 640) return new Response(null, { status: 400 });
    if (relay.request.writableLength > 64000) { await closeRelay(id); return new Response(null, { status: 429 }); }
    relay.request.write(Buffer.concat(chunks)); return Response.json({ accepted: true });
  } catch { return Response.json({ error: "Local voice test failed; check gateway logs" }, { status: 503 }); }
}
export async function GET(request: Request) {
  // EventSource sends no Origin on some browsers; require same-origin fetch metadata instead.
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || request.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "Availability requires a same-origin local browser request." }, { status: 403 });
  const user = await owner();
  if (!user) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const headers = new Headers(request.headers);
  if (!headers.has("origin")) headers.set("origin", browserOrigin(request) || "null");
  const access = gate(new Request(request.url, { headers }));
  if (url.searchParams.get("status") === "1") return Response.json(access, { headers: { "Cache-Control": "no-store" } });
  if (!access.enabled) return Response.json({ error: access.reasons[0] }, { status: 403 });
  if (url.searchParams.get('gatewayHealth')==='1') {
    if (!access.configured) return Response.json({ error:'Next.js Gateway credentials are not configured',authenticated:false },{status:503});
    try {
      const target=new URL(process.env.SHAHVEX_GATEWAY_URL!);
      if (target.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.username || target.password) throw Error('Invalid local endpoint');
      const health=await fetch(new URL('/health',target),{headers:{Authorization:`Bearer ${process.env.SHAHVEX_GATEWAY_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(5000),cache:'no-store'});
      if (!health.ok) { await health.body?.cancel(); return Response.json({authenticated:false,gatewayStatus:health.status,...voiceMaintenance()},{status:502}); }
      const data=await health.json();
      const valid=typeof data.ready==='boolean' && Number.isInteger(data.activeSessions) && Number.isInteger(data.queue?.active) && Number.isInteger(data.queue?.pending);
      if(!valid)throw Error('Invalid health response');
      return Response.json({authenticated:true,gatewayStatus:health.status,ready:data.ready,activeSessions:data.activeSessions,queue:{active:data.queue.active,pending:data.queue.pending},...voiceMaintenance()},{headers:{'Cache-Control':'no-store'}});
    }catch{return Response.json({authenticated:false,error:'Gateway unreachable or invalid health response',...voiceMaintenance()},{status:503});}
  }
  if (url.searchParams.has('scriptAgentId')) return exportAgent(new Request(`${url.origin}/api/admin/agents/gateway-export?agentId=${encodeURIComponent(url.searchParams.get('scriptAgentId') || '')}`));
  const id = url.searchParams.get("id") || "", relay = relays.get(id);
  if (!user || !relay || relay.owner !== user || relay.listener) return new Response(null, { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      relay.listener = data => {
        if ((controller.desiredSize ?? 0) < -100) { void closeRelay(id).catch(() => {}); return; }
        try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { void closeRelay(id).catch(() => {}); }
      };
      relay.events.splice(0).forEach(data => relay.listener?.(data));
      request.signal.addEventListener("abort", () => { void closeRelay(id).catch(() => {}); }, { once: true });
    },
    cancel() { void closeRelay(id).catch(() => {}); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
