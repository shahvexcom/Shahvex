import "server-only";

/** Server-only transport. Never accepts a caller-provided upstream URL. */
export async function pcAiEngine(port: number, path: string, init: RequestInit = {}) {
  const allowed: Record<number, string[]> = {
    11434: ["/api/chat"], 8766: ["/transcribe"],
    8767: ["/voices", "/health", "/synthesize", "/stream"],
  };
  if (!allowed[port]?.includes(path)) throw Error("Unsupported PC AI operation");
  return pcAiRequest(`/engine/${port}${path}`, init);
}

export async function pcAiRequest(path: string, init: RequestInit = {}, owner?: string) {
  if (!/^\/engine\/(?:11434\/api\/chat|8766\/transcribe|8767\/(?:voices|health|synthesize|stream))$/.test(path) && !/^\/tester\/(?:start|turn|interrupt|stop|ping)$/.test(path)) throw Error("Unsupported PC AI operation");
  const base = new URL(process.env.SHAHVEX_PC_AI_URL || "");
  const key = process.env.SHAHVEX_PC_AI_SECRET;
  const clientId = process.env.SHAHVEX_CF_CLIENT_ID;
  const clientSecret = process.env.SHAHVEX_CF_CLIENT_SECRET;
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !key || key.length < 32 || !clientId || !clientSecret) throw Error("Secure PC AI connection is not configured");
  const headers = new Headers();
  // Do not forward cookies, user authorization or arbitrary caller headers.
  const contentType = new Headers(init.headers).get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("x-shahvex-ai-key", key);
  headers.set("CF-Access-Client-Id", clientId);
  headers.set("CF-Access-Client-Secret", clientSecret);
  if (owner) headers.set("x-shahvex-owner", owner);
  // Session handles and turn IDs are separate, validated gateway headers.
  for (const name of ["x-shahvex-session", "x-shahvex-turn"]) {
    const value = new Headers(init.headers).get(name);
    if (value && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) headers.set(name, value);
  }
  const upstream = await fetch(new URL(path, base), {
    ...init, headers, redirect: "error", cache: "no-store",
    signal: AbortSignal.any([init.signal || new AbortController().signal, AbortSignal.timeout(120_000)]),
  });
  // fetch decodes Cloudflare gzip/br bodies but retains wire-format headers.
  // Reusing those headers makes the browser decode the already decoded body again.
  const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  for (const name of ["content-type", "x-audio-format", "x-sample-rate", "x-channels"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
