import "server-only";
import https from "node:https";
import { Readable } from "node:stream";

export class ShahvexError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function shahvexConfigured() { return Boolean(process.env.SHAHVEX_API_URL?.trim()); }
/** Closed destination/path set. Callers never supply URLs or authentication headers. */
export async function shahvexApi(path: string, options: { method?: "GET" | "POST" | "DELETE"; form?: FormData; signal?: AbortSignal } = {}) {
  if (!/^\/(?:health|conversation(?:\/stream)?|sessions\/[a-f0-9]{32})$/.test(path)) throw new ShahvexError(400, "Unsupported AI operation");
  let base: URL;
  try { base = new URL(process.env.SHAHVEX_API_URL || ""); } catch { throw new ShahvexError(503, "AI connection is not configured"); }
  const clientId = process.env.SHAHVEX_CF_CLIENT_ID, secret = process.env.SHAHVEX_CF_CLIENT_SECRET;
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !clientId || !secret) throw new ShahvexError(503, "Secure AI connection is not configured");
  const url = new URL(path, base);
  const headers: Record<string,string|number> = { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": secret, "Cache-Control": "no-store" };
  let body: Buffer | undefined;
  if (options.form) {
    const encoded = new Request(url, { method: "POST", body: options.form, cache: "no-store" });
    body = Buffer.from(await encoded.arrayBuffer());
    if (body.length > 2_100_000) throw new ShahvexError(413, "Recording is too large");
    headers["Content-Type"] = encoded.headers.get("content-type")!; headers["Content-Length"] = body.length;
  }
  const control = new AbortController(), signal = AbortSignal.any([control.signal, options.signal || new AbortController().signal]);
  const total = setTimeout(() => control.abort(), path === "/health" ? 10_000 : 240_000);
  let connect: ReturnType<typeof setTimeout> | undefined, firstResponse: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { clearTimeout(total); clearTimeout(connect); clearTimeout(firstResponse); };
  try {
    return await new Promise<Response>((resolve,reject) => {
      // Built-in HTTPS honors TLS verification; redirects are never followed.
      const request = https.request(url, { method: options.method || "GET", headers, signal }, response => {
        clearTimeout(connect); clearTimeout(firstResponse);
        const status = response.statusCode || 502;
        if (status < 200 || status >= 300) {
          response.destroy(); cleanup();
          const mapped = status === 401 || status === 403 ? 503 : [404,409,413,422,429].includes(status) ? status : 502;
          reject(new ShahvexError(mapped, status === 401 || status === 403 ? "AI service authentication failed" : status === 409 ? "AI session is still processing. Try again shortly." : status === 404 ? "AI agent or session is unavailable" : "AI service could not complete the request")); return;
        }
        response.once("end", cleanup); response.once("close", cleanup); response.once("error", cleanup);
        const safeHeaders = new Headers();
        for (const name of ["content-type","x-session-id","x-agent-id","x-voice-id","x-audio-format","x-sample-rate","x-channels"]) {
          const value = response.headers[name]; if (typeof value === "string") safeHeaders.set(name,value);
        }
        const source = Readable.toWeb(response) as ReadableStream<Uint8Array>, reader = source.getReader();
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) { try { const part=await reader.read(); if(part.done){controller.close();return;}controller.enqueue(part.value); } catch { cleanup(); controller.error(new Error("AI response stream ended unexpectedly")); } },
          async cancel() { control.abort(); cleanup(); await reader.cancel().catch(()=>{}); },
        });
        resolve(new Response(stream, {status,headers:safeHeaders}));
      });
      request.once("socket", socket => {
        if (socket.connecting) { connect = setTimeout(()=>control.abort(),10_000); socket.once("secureConnect",()=>clearTimeout(connect)); }
      });
      firstResponse = setTimeout(()=>control.abort(),path === "/health" ? 10_000 : 110_000);
      request.once("error",()=>{cleanup();reject(new ShahvexError(signal.aborted ? 504 : 503, signal.aborted ? "AI request timed out or was cancelled" : "AI service is unavailable"));});
      request.end(body);
    });
  } catch (error) { cleanup(); if(error instanceof ShahvexError)throw error;throw new ShahvexError(503,"AI service is unavailable"); }
}
export const shahvexHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export const shahvexJson = (data: unknown, status=200) => Response.json(data,{status,headers:shahvexHeaders});
export function shahvexFailure(error: unknown) { return shahvexJson({error:error instanceof ShahvexError?error.message:"AI request could not be completed",...(error instanceof ShahvexError&&error.status===409&&/still processing/.test(error.message)?{code:"BUSY"}:{})}, error instanceof ShahvexError?error.status:503); }
export async function smallJson(response: Response) {
  const reader=response.body?.getReader(); if(!reader)throw new ShahvexError(502,"Invalid AI response");
  let text="",size=0;const decoder=new TextDecoder();
  try { while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384)throw new ShahvexError(502,"Invalid AI response");text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode()); }
  catch {await reader.cancel().catch(()=>{});throw new ShahvexError(502,"Invalid AI response");} finally {reader.releaseLock();}
}
