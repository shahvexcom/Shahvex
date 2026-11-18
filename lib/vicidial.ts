import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import http from "node:http";
export function allowedVoipHost(hostname: string) {
  return (process.env.SHAHVEX_VOIP_ALLOWED_HOSTS || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean).includes(hostname.toLowerCase());
}
export function vicidialURL(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) throw Error("Enter a VICIdial HTTPS server URL without embedded credentials or query parameters");
  if (url.protocol !== "https:" && !allowedVoipHost(url.hostname)) throw Error("HTTP requires an administrator-approved host; use HTTPS");
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/vicidial/non_agent_api.php") ? path : `${path.replace(/\/vicidial$/, "")}/vicidial/non_agent_api.php`;
  return url;
}
export function publicAddress(address: string) {
  if (isIP(address) === 6) { const first = parseInt(address.split(":")[0], 16); return first >= 0x2000 && first <= 0x3fff && !address.toLowerCase().startsWith("2001:db8:"); }
  if (isIP(address) !== 4) return false;
  const [a,b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19].includes(b)));
}
export function verifyVicidialUser(csv: string, username: string) {
  const rows = csv.trim().replace(/^\uFEFF/, "").split(/\r?\n/).map(line => {
    const cells: string[] = []; let cell = "", quoted = false;
    for (let i=0;i<line.length;i++) { const c=line[i]; if(c==='"') { if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }else if(c===","&&!quoted){cells.push(cell.trim());cell="";}else cell+=c; }
    cells.push(cell.trim());return cells;
  });
  if (/ERROR:|<html|<!doctype/i.test(csv) || rows[0]?.join(",") !== "user,full_name,user_group,user_level,active") return false;
  return rows.slice(1).some(row => row[0] === username && row[4] === "Y");
}
/** Read-only authenticated user_details probe. No dialer mutations or media claims. */
export async function vicidialRequest(server: string, username: string, secret: string, fields: Record<string, string>, agentApi = false, timeoutMs = 12000) {
  timeoutMs=Math.max(1000,Math.min(12000,timeoutMs));const started=Date.now();
  const url = vicidialURL(server), host = url.hostname.replace(/^\[|\]$/g, "");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(Error("VICIdial DNS verification timed out")),Math.min(8000,timeoutMs));}),
  ]).finally(()=>clearTimeout(dnsTimer));
  if (!addresses.length || (!allowedVoipHost(url.hostname) && addresses.some(a => !publicAddress(a.address)))) throw Error("VICIdial host is private or reserved and requires server-side approval");
  if (agentApi) url.pathname = url.pathname.replace(/\/vicidial\/non_agent_api\.php$/, "/agc/api.php");
  const selected = addresses[0];
  const data = new URLSearchParams({ ...fields, source: "shahvex", user: username, pass: secret }).toString();
  const body = await new Promise<string>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method: "POST", agent: false, lookup: (_host, options, cb) => {
      if (typeof options === "object" && options.all) (cb as unknown as (e: null, a: typeof addresses) => void)(null, [selected]);
      else cb(null, selected.address, selected.family);
    }, headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(data) } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(Error("VICIdial did not return a successful HTTP response")); return; }
      const parts: Buffer[] = []; let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (bytes > 256000) req.destroy(Error("VICIdial response exceeded its limit")); else parts.push(chunk); });
      response.on("end", () => resolve(Buffer.concat(parts).toString("utf8"))); response.on("error", () => reject(Error("VICIdial response failed")));
    });
    const timer = setTimeout(() => req.destroy(Error("VICIdial verification timed out")), timeoutMs<12000?Math.max(1,timeoutMs-(Date.now()-started)):timeoutMs);
    req.on("close", () => clearTimeout(timer)); req.on("error", () => reject(Error("VICIdial verification failed; check server access, TLS and API permissions")));
    req.end(data);
  });
  return body;
}
export function requireVicidialSuccess(body: string, operation: string) {
  if (!body.trim().startsWith(`SUCCESS: ${operation} `)) throw Error(`VICIdial ${operation} did not confirm success. Check API permissions and dialer logs.`);
  return body;
}
/** Read-only verification never enables remote agents or places calls. */
export async function testVicidial(server: string, username: string, secret: string) {
  const body = await vicidialRequest(server, username, secret, { function: "user_details", agent_user: username, stage: "csv", header: "YES" });
  if (!verifyVicidialUser(body, username)) throw Error("API authentication/permission verification failed. Enable Agent API Access and view reports for a supported API user.");
  return { status: "CONNECTED", message: "Authenticated read-only API verified. SIP/media routing remains unverified." };
}
export async function readVicidialVersion(server:string,username:string,secret:string){
  const body=await vicidialRequest(server,username,secret,{function:'version'});
  const match=/^VERSION:\s*([\w.+-]+)\|BUILD:\s*([\w-]+)/.exec(body.trim());
  if(!match)throw Error('Native API version response is unsupported; engineer verification required');
  return `${match[1]} / ${match[2]}`;
}
