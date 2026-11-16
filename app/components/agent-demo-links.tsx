"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FiMoreHorizontal } from "react-icons/fi";
import "./agent-demo-links.css";
type Link = { id: string; agent_id: string; expires_at: string; revoked_at: string | null; max_sessions: number; used_sessions: number; active_sessions: number };
type State = { links: Link[]; paths: Record<string,string>; busy: boolean; error: string; change: (body: object, agentId?: string) => Promise<void>; report: (message: string) => void };
const LinksContext = createContext<State | null>(null);
export function AgentDemoLinksProvider({ children }: { children: ReactNode }) {
  const [links,setLinks] = useState<Link[]>([]), [paths,setPaths] = useState<Record<string,string>>({}), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const load = async () => { try { const r = await fetch("/api/admin/agent-demo-links", {cache:"no-store"}); const d=await r.json(); if(!r.ok)throw Error(d.error);setLinks(d.links); } catch(e){setError(e instanceof Error?e.message:"Unable to load links");} };
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[]);
  const change = async (body: object, agentId?: string) => {setBusy(true);setError("");try{const r=await fetch("/api/admin/agent-demo-links",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);if(d.path&&agentId)setPaths(old=>({...old,[agentId]:location.origin+d.path}));await load();}catch(e){setError(e instanceof Error?e.message:"Unable to update link");}finally{setBusy(false);}};
  return <LinksContext.Provider value={{links,paths,error,busy,change,report:setError}}>{children}</LinksContext.Provider>;
}
export function AgentDemoLinkActions({ agent, onEdit }: { agent: {id:string;name:string}; onEdit: () => void }) {
  const state=useContext(LinksContext);
  if(!state)return null;
  const {links,paths,error,busy,change,report}=state;
  const link=links.find(l=>l.agent_id===agent.id),valid=link&&!link.revoked_at&&new Date(link.expires_at).getTime()>Date.now();
  return <details className="agent-link-actions"><summary aria-label={`Actions for ${agent.name}`}><FiMoreHorizontal/></summary>
    <div className="agent-link-menu">
      <button type="button" className="admin-outline" onClick={onEdit}>Edit agent</button>
      <button type="button" disabled={busy} className="admin-outline" onClick={()=>void change({action:"generate",agentId:agent.id,hours:24,maxSessions:10},agent.id)}>{link?"Regenerate Link":"Generate Test Link"}</button>
      {valid&&paths[agent.id]&&<button type="button" className="admin-outline" onClick={()=>void navigator.clipboard.writeText(paths[agent.id]).catch(()=>report("Clipboard access failed. Copy the displayed link."))}>Copy Link</button>}
      {valid&&<button type="button" disabled={busy} className="admin-outline" onClick={()=>void change({action:"revoke",id:link.id})}>Revoke Link</button>}
      {link&&<small>{link.revoked_at?"Revoked":!valid?"Expired":link.used_sessions>=link.max_sessions?"Exhausted":"Active"} ? {link.used_sessions}/{link.max_sessions} sessions<br/>Expires: {new Date(link.expires_at).toLocaleString()}<br/>Active sessions: {link.active_sessions}</small>}
      {!link&&<small>New links last 24 hours and allow 10 sessions.</small>}
      {valid&&paths[agent.id]&&<input aria-label={`Test link for ${agent.name}`} readOnly value={paths[agent.id]}/>}
      {error&&<small role="alert">{error}</small>}
    </div>
  </details>;
}
