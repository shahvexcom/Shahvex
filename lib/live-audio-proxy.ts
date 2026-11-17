import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { Readable } from "node:stream";
import { bridgeSignature } from "./vicidial-bridge";
import { allowedVoipHost, publicAddress, vicidialURL } from "./vicidial";

/** Only signed GET audio is proxied. Browser audio/microphone data is never accepted. */
export async function liveAudioProxy(base: string, secret: string, id: string, request: Request, localOnly = false) {
  const url = new URL(base);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw Error("Invalid audio origin");
  if (localOnly) {
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) throw Error("Invalid local bridge");
  } else vicidialURL(url.origin);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addresses.length || (!localOnly && !allowedVoipHost(url.hostname) && addresses.some(a => !publicAddress(a.address)))) throw Error("Unapproved audio host");
  const selected = addresses[0]; url.pathname = `/listen/${id}.pcm`;
  const stamp = String(Date.now());
  const upstream = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method: "GET", agent: false, signal: request.signal,
      headers: { "x-shahvex-timestamp": stamp, "x-shahvex-signature": bridgeSignature(secret, stamp, "GET", url.pathname, Buffer.alloc(0)) },
      lookup: (_host, options, cb) => { if (typeof options === "object" && options.all) (cb as unknown as (e: null, a: typeof addresses) => void)(null, [selected]); else cb(null, selected.address, selected.family); },
    }, resolve);
    req.setTimeout(10000, () => req.destroy(Error("Live audio timed out"))); req.on("error", reject); req.end();
  });
  if (upstream.statusCode !== 200 || upstream.headers["content-type"] !== "application/octet-stream") {
    upstream.destroy();
    return Response.json({ message: "Live audio is unavailable. The call may have ended or reached its listener limit." }, { status: upstream.statusCode === 429 ? 429 : 409 });
  }
  return new Response(Readable.toWeb(upstream) as ReadableStream<Uint8Array>, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no", "X-Audio-Sample-Rate": "8000", "X-Audio-Channels": "2" } });
}
