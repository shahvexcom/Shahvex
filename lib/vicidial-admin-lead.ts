import 'server-only';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import {allowedVoipHost,publicAddress,vicidialURL} from './vicidial';

const decode=(s:string)=>s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,entity:string)=>{
 if(entity[0]==='#'){const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));if(n<0||n>0x10ffff)throw Error('Invalid native HTML entity');return String.fromCodePoint(n);}
 return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '} as Record<string,string>)[entity.toLowerCase()];
});
function attributes(tag:string){const values:Record<string,string>={};for(const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))values[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);return values;}
export function parseAdminLead(html:string,leadId:string){
 const forms=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)].filter(m=>attributes(m[1]).action?.split('?')[0]==='/vicidial/admin_modify_lead.php');
 if(forms.length!==1)throw Error('Native admin lead form not verified');
 const result:Record<string,string>={};
 for(const m of forms[0][2].matchAll(/<input\b[^>]*>/gi)){const a=attributes(m[0]);if(a.name){if(a.name in result)throw Error('Duplicate native lead field');result[a.name]=a.value||'';}}
 for(const m of forms[0][2].matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea\s*>/gi)){const a=attributes(m[1]);if(a.name){if(a.name in result)throw Error('Duplicate native lead field');result[a.name]=decode(m[2].replace(/^\r?\n/,''));}}
 if(result.lead_id!==leadId||!/^\d+$/.test(result.list_id||'')||!Object.hasOwn(result,'comments')||!Object.hasOwn(result,'phone_number'))throw Error('Native admin lead identity or fields not verified');
 return result;
}
/** Authenticated read-only fallback. Never submits the lead form or modifies call/agent state. */
export async function readAdminLead(server:string,user:string,password:string,leadId:string){
 if(!/^\d{1,12}$/.test(leadId))throw Error('Invalid native lead ID');
 const url=vicidialURL(server);url.pathname='/vicidial/admin_modify_lead.php';url.search=new URLSearchParams({lead_id:leadId}).toString();
 const addresses=await lookup(url.hostname,{all:true});
 if(!addresses.length||(!allowedVoipHost(url.hostname)&&addresses.some(a=>!publicAddress(a.address))))throw Error('Native admin host not allowed');
 const selected=addresses[0];
 const html=await new Promise<string>((resolve,reject)=>{
  const req=(url.protocol==='https:'?https:http).request(url,{method:'GET',agent:false,headers:{Authorization:'Basic '+Buffer.from(user+':'+password).toString('base64')},lookup:(_host,options,cb)=>{
   if(typeof options==='object'&&options.all)(cb as unknown as (e:null,a:typeof addresses)=>void)(null,[selected]);else cb(null,selected.address,selected.family);
  }},res=>{if(res.statusCode!==200){res.resume();reject(Error('Native admin read failed'));return;}let bytes=0;const chunks:Buffer[]=[];res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2000000)req.destroy(Error('Native admin response too large'));else chunks.push(chunk)});res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',reject);});
  const timer=setTimeout(()=>req.destroy(Error('Native admin read timed out')),12000);req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(Error('Native admin connection failed')));req.end();
 });
 return parseAdminLead(html,leadId);
}
