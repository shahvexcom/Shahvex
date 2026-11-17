import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { allowedVoipHost, vicidialURL, publicAddress } from "./vicidial";
import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import { Readable } from "node:stream";

/** Private AI-leg recording; native human-call recordings are never proxied here. */
export async function bridgeRecordingResponse(base:string,secret:string,id:string,request:Request,reference?:string) {
  if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({message:"Invalid AI recording"},{status:400});
  const url=new URL(base);vicidialURL(url.origin);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid bridge origin');
  const addresses=await lookup(url.hostname,{all:true});
  if(!addresses.length||(!allowedVoipHost(url.hostname)&&addresses.some(a=>!publicAddress(a.address))))throw Error('Unapproved audio bridge');
  url.pathname=`/recordings/${id}.wav`;
  const timestamp=String(Date.now()),headers:Record<string,string>={'x-shahvex-timestamp':timestamp,'x-shahvex-signature':bridgeSignature(secret,timestamp,'GET',url.pathname,Buffer.alloc(0))};
  const range=request.headers.get('range');if(range&&/^bytes=\d+-\d*$/.test(range))headers.Range=range;
  const selected=addresses[0];
  const upstream=await new Promise<http.IncomingMessage>((resolve,reject)=>{
    const transport=url.protocol==='https:'?https:http;
    const req=transport.request(url,{method:'GET',agent:false,headers,signal:request.signal,lookup:(_host,options,cb)=>{
      if(typeof options==='object'&&options.all)(cb as unknown as (e:null,a:typeof addresses)=>void)(null,[selected]);else cb(null,selected.address,selected.family);
    }},resolve);req.setTimeout(30000,()=>req.destroy(Error('AI recording timed out')));req.on('error',reject);req.end();
  });
  if(![200,206].includes(upstream.statusCode||0)||!String(upstream.headers['content-type']).startsWith('audio/')){upstream.resume();return Response.json({message:"AI recording is not ready"},{status:404});}
  const out=new Headers({'content-type':'audio/wav','cache-control':'private, no-store','content-disposition':`${new URL(request.url).searchParams.get('inline')==='1'?'inline':'attachment'}; filename="${reference ? `recording-${reference}` : `ai-call-${id}`}.wav"`});
  if(reference)out.set('X-Recording-Serial',reference);
  for(const key of ['content-length','content-range','accept-ranges']){const value=upstream.headers[key];if(typeof value==='string')out.set(key,value);}
  return new Response(Readable.toWeb(upstream) as ReadableStream<Uint8Array>,{status:upstream.statusCode,headers:out});
}

export function bridgeSignature(secret: string, timestamp: string, method: string, path: string, body: Uint8Array) {
  return createHmac("sha256", secret).update(`${timestamp}\n${method}\n${path}\n`).update(body).digest("hex");
}
export function verifyBridgeSignature(secret: string, timestamp: string, signature: string, method: string, path: string, body: Uint8Array) {
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60_000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(bridgeSignature(secret, timestamp, method, path, body), "hex"));
}
/** Pinned, bounded transport; never forwards credentials on redirects. */
export async function requestBridge(base: string, secret: string, path: "/health" | "/prepare" | "/command", value?: unknown) {
  const url = new URL(base);
  vicidialURL(`${url.origin}/`); // Same explicit private-host/HTTP policy as the dialer.
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("Use the audio bridge origin URL without a path");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || (!allowedVoipHost(url.hostname) && addresses.some(a => !publicAddress(a.address)))) throw Error("Audio bridge host requires server-side approval");
  url.pathname = path;
  const body = Buffer.from(value === undefined ? "" : JSON.stringify(value)), method = value === undefined ? "GET" : "POST", timestamp = String(Date.now());
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const selected = addresses[0], transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method, agent: false, lookup: (_host, options, cb) => {
      if (typeof options === "object" && options.all) (cb as unknown as (e: null, a: typeof addresses) => void)(null, [selected]); else cb(null, selected.address, selected.family);
    }, headers: { "content-type": "application/json", "content-length": body.length, "x-shahvex-timestamp": timestamp, "x-shahvex-signature": bridgeSignature(secret, timestamp, method, path, body) } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        const reason = response.statusCode === 401 ? "Audio bridge rejected authentication; verify the matching shared secret"
          : response.statusCode === 400 ? "Audio bridge rejected the connection ID or remote user; verify the production bridge configuration"
          : response.statusCode === 409 ? "Audio bridge rejected the call mode or unprepared line; verify production campaign routing"
          : response.statusCode === 429 ? "Audio bridge has reached its configured capacity"
          : "Audio bridge did not confirm the request";
        reject(Error(reason)); return;
      }
      const chunks: Buffer[] = []; let length = 0;
      response.on("data", chunk => { length += chunk.length; if (length > 64000) req.destroy(Error("Invalid bridge response")); else chunks.push(chunk); });
      response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(Error("Invalid bridge response")); } });
      response.on("error", () => reject(Error("Audio bridge response failed")));
    });
    const timer = setTimeout(() => req.destroy(Error("Audio bridge timed out")), 12000);
    req.on("close", () => clearTimeout(timer)); req.on("error", () => reject(Error("Audio bridge unavailable; check the URL, secret and firewall"))); req.end(body);
  });
}
