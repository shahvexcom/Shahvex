"use client";
import "./live-call-workspace.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EndedCalls } from "./ended-calls";
import {
  FiClock,
  FiCalendar,
  FiDownload,
  FiExternalLink,
  FiGrid,
  FiList,
  FiPhoneOff,
  FiPause,
  FiPlay,
  FiRadio,
  FiSearch,
  FiSave,
  FiUserCheck,
  FiUserX,
  FiX,
} from "react-icons/fi";

type Call = {
  id: string;
  agent_id?: string;
  updated_at?: string;
  status: string;
  agent_name: string;
  agent_number: string;
  lead_name: string;
  lead_number: string;
  telnyx_credential: string;
  groq_credential: string;
  summary: string;
  created_at: string;
  answered_at?: string;
  on_hold?: boolean;
  recording_active?: boolean;
  recording_url?: string;
  transcript?: string;
};

type ReadyAgent = {
  id: string;
  name: string;
  outbound_number: string;
  lead_name: string;
  lead_number: string;
  telnyx_credential: string;
  groq_credential: string;
};

type CallMetrics = { calls_today?: number; completed?: number };
type AgentSchedule = { isEnabled: boolean; startTime: string; endTime: string; isActive?: boolean };
type RosterAgent = { deleted_at?:string;local_voice_id?:string;local_voice_name?:string;extension_route?:string;remote_user?:string;campaign_name?:string;campaign_category?:string; telephony_provider?:string; is_queued?:boolean; id: string; name: string; avatar_url?: string; status?: string; telnyx_credential?: string; groq_credential?: string; outbound_number?: string; lead_name?: string; lead_number?: string; dialed_calls?: number; is_running?: boolean; is_ready?: boolean; schedule?: AgentSchedule };

type AgentCard = {
  local_voice_name?:string;extension_route?:string;remote_user?:string;campaign_name?:string;campaign_category?:string;
  telephony_provider?:string;
  is_queued?:boolean;
  id: string;
  kind: "running" | "ready" | "idle";
  name: string;
  outbound_number: string;
  lead_name: string;
  lead_number: string;
  telnyx_credential: string;
  groq_credential: string;
  status: string;
  avatar_url?: string;
  dialed_calls?: number;
  callId?: string;
  schedule: AgentSchedule;
};

const activeStates = ["INITIATED", "RINGING", "ANSWERED"];

function duration(call: Call, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(call.answered_at || call.created_at).getTime()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function buildAgentCards(calls: Call[], ready: ReadyAgent[], allAgents: RosterAgent[]) {
  const rosterCards: AgentCard[] = (allAgents || []).filter(agent=>!agent.deleted_at).map((agent) => {
    const readyAgent = ready.find((item) => item.id === agent.id);
    const runningCall = calls.find((call) => (call.agent_id?call.agent_id===agent.id:call.agent_name===agent.name) && activeStates.includes(call.status));
    const isRunning = Boolean(runningCall);
    const schedule = agent.schedule || { isEnabled: false, startTime: "09:00", endTime: "17:00", isActive: false };
    const isReady = Boolean(agent.is_ready);
    return {
      id: agent.id,
      local_voice_name:agent.local_voice_name||agent.local_voice_id,extension_route:agent.extension_route,remote_user:agent.remote_user,campaign_name:agent.campaign_name,campaign_category:agent.campaign_category,
      is_queued: agent.is_queued,
      telephony_provider: agent.telephony_provider,
      kind: isRunning ? "running" : isReady ? "ready" : "idle",
      name: agent.name,
      outbound_number: agent.outbound_number || "Number not configured",
      lead_name: isRunning ? runningCall?.lead_name || "Unknown lead" : agent.lead_name || (readyAgent?.lead_name || "No uncalled lead"),
      lead_number: isRunning ? runningCall?.lead_number || "No client number" : agent.lead_number || (readyAgent?.lead_number || "No uncalled number"),
      telnyx_credential: agent.telnyx_credential || "Telnyx",
      groq_credential: agent.groq_credential || "Not assigned",
      status: isRunning ? "RUNNING" : isReady ? "READY" : String(agent.status || "PENDING"),
      avatar_url: agent.avatar_url,
      dialed_calls: Number(agent.dialed_calls || 0),
      callId: runningCall?.id,
      schedule,
    };
  });

  const runningExtras: AgentCard[] = (calls || [])
    .filter((call) => activeStates.includes(call.status))
    .filter((call) => !rosterCards.some((agent) => agent.name === call.agent_name))
    .map((call) => ({
      id: call.id,
      kind: "running",
      name: call.agent_name,
      outbound_number: call.agent_number,
      lead_name: call.lead_name || "Unknown lead",
      lead_number: call.lead_number || "No number",
      telnyx_credential: call.telnyx_credential || "Telnyx",
      groq_credential: call.groq_credential || "Not assigned",
      status: call.status,
      dialed_calls: 0,
      callId: call.id,
      schedule: { isEnabled: false, startTime: "09:00", endTime: "17:00", isActive: false },
    }));

  const seen = new Set<string>();
  return [...rosterCards, ...runningExtras].sort((a,b)=>(Number(a.remote_user)||999999)-(Number(b.remote_user)||999999)||a.name.localeCompare(b.name)).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function LiveCalls({ onAction, onLiveCount }: { onAction: (message: string, kind?: "success" | "error") => void; onLiveCount: (count: number) => void }) {
  const router = useRouter();
  const [calls, setCalls] = useState<Call[]>([]), [ready, setReady] = useState<ReadyAgent[]>([]), [allAgents, setAllAgents] = useState<RosterAgent[]>([]), [metrics, setMetrics] = useState<CallMetrics>({});
  const [busy, setBusy] = useState(false), [startingId, setStartingId] = useState(""), [loading, setLoading] = useState(true), [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState(""), [searchOpen, setSearchOpen] = useState(false), [filter, setFilter] = useState<"all" | "running" | "ready">("all");
  const [now, setNow] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState("");

  const fullLoadBusy=useRef(false);
  const load = useCallback(async () => {
    if(fullLoadBusy.current)return;fullLoadBusy.current=true;
    try {
      const r = await fetch("/api/admin/calls", { cache: "no-store", signal: AbortSignal.timeout(15000) }), d = await r.json();
      if (r.ok) {
        setCalls(previous=>{const prior=new Map(previous.map(c=>[c.id,c]));return (d.calls||[]).map((c:Call)=>{const old=prior.get(c.id);return old&&Date.parse(old.updated_at||'')>Date.parse(c.updated_at||'')?{...c,...old}:c;});});
        setReady(d.readyAgents || []);
        setAllAgents(d.allAgents || []);
        setMetrics(d.metrics || {});
        setCurrentTime(d.currentTime || "");
        onLiveCount((d.calls || []).filter((c: Call) => activeStates.includes(c.status)).length);
      } else {
        onAction(d.message || "Unable to load live calls.", "error");
      }
    } catch {
      onAction("Unable to load live calls.", "error");
    } finally {
      fullLoadBusy.current=false;setLoading(false);
    }
  }, [onAction, onLiveCount]);

  useEffect(() => {
    const refresh = window.setInterval(() => { void load(); }, 30000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const boot = window.setTimeout(() => {
      void load();
      setNow(Date.now());
    }, 0);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(clock);
      window.clearTimeout(boot);
    };
  }, [load]);



  const command = async (body: object) => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), d = await r.json();
      onAction(d.message || (r.ok ? "Call action completed." : "Call action failed."), r.ok ? "success" : "error");
      await load();
    } catch {
      onAction("Unable to contact the call service.", "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
    const refresh=async()=>{try{
      const response=await fetch('/api/admin/calls?updates=1',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
      if(!response.ok)return;const data=await response.json();if(stopped)return;
      setCalls(previous=>{const old=new Map(previous.map(c=>[c.id,c]));return (data.calls||[]).map((c:Call)=>{const prior=old.get(c.id);return prior&&Date.parse(prior.updated_at||'')>Date.parse(c.updated_at||'')?prior:{...prior,...c};});});
      setMetrics(data.metrics||{});setCurrentTime(data.currentTime||'');onLiveCount((data.calls||[]).filter((c:Call)=>activeStates.includes(c.status)).length);
    }catch{/* Existing status stays visible while the next poll reconnects. */}finally{if(!stopped)timer=setTimeout(refresh,1000);}};
    void refresh();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
  },[onLiveCount]);

  const live = calls.filter(c=>activeStates.includes(c.status));
  const readyAgents = useMemo(() => allAgents.filter((agent) => Boolean(agent.is_ready) && !agent.is_running && !agent.deleted_at), [allAgents]);
  const agents = useMemo(() => {
    const candidate = buildAgentCards(calls, ready, allAgents);
    const searchValue = query.trim().toLowerCase();
    return candidate.filter((agent) => {
      const matchesFilter = filter === "all" || agent.kind === filter;
      const matchesQuery = !searchValue || [agent.name, agent.lead_name, agent.lead_number, agent.outbound_number, agent.telnyx_credential, agent.groq_credential,agent.extension_route,agent.remote_user,agent.campaign_name, String(agent.dialed_calls || 0)].join(" ").toLowerCase().includes(searchValue);
      return matchesFilter && matchesQuery;
    });
  }, [calls, ready, allAgents, query, filter]);

  const download = (c: Call) => {
    const text = `Call summary\n\nAgent: ${c.agent_name}\nClient: ${c.lead_name || "Unknown"} (${c.lead_number})\nStatus: ${c.status}\n\n${c.summary || "Summary will be generated when the call completes."}`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-summary-${c.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="live-workspace">
      <div className="admin-page-head">
        <div>
          <p>REAL-TIME MONITORING</p>
          <h1>Live calls</h1>
          <a href="/controler/live-monitor" className="admin-outline">Open live conversation monitor</a>
          <small className="live-pakistan-clock">Pakistan time {currentTime || "--:--"}</small>
        </div>
        <button className="admin-outline" disabled={busy || loading} onClick={() => command({ action: "pause-all" })} title="Stop new VICIdial calls while current calls continue">
          <FiPause /><span>Pause new calls</span>
        </button>
        <button className="admin-outline danger-outline" disabled={busy || loading || !live.length} onClick={() => command({ action: "hangup-all" })}>
          <FiPhoneOff />
          <span>End all active ({live.length})</span>
        </button>
        <button className="admin-primary live-start-all" disabled={busy || loading || !readyAgents.length} onClick={() => command({ action: "start-all" })}>
          <FiPlay />
          <span>{busy ? "Working..." : `Start all ready agents (${readyAgents.length})`}</span>
        </button>
      </div>

      <div className="live-kpis">
        {loading ? (
          <KpiSkeleton />
        ) : (
          <>
            <Kpi icon={<FiRadio />} tone="purple" label="Live calls" value={live.length} />
            <Kpi icon={<FiUserCheck />} tone="green" label="Ready agents" value={readyAgents.length} />
            <Kpi icon={<FiPlay />} tone="orange" label="Calls today" value={Number(metrics.calls_today || 0)} />
            <Kpi icon={<FiPhoneOff />} tone="blue" label="Completed" value={Number(metrics.completed || 0)} />
          </>
        )}
      </div>

      <section className="admin-card ready-agents">
        <div className="card-heading">
          <div>
            <h2>Agent roster</h2>
            <p>Running calls and all assigned agents.</p>
          </div>
          <div className="ready-tools">
            <div className="view-switch" aria-label="Ready agent layout">
              <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><FiGrid /></button>
              <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><FiList /></button>
            </div>
            <div className="agent-filter" aria-label="Agent filter">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
              <button className={filter === "running" ? "active" : ""} onClick={() => setFilter("running")}>Running</button>
              <button className={filter === "ready" ? "active" : ""} onClick={() => setFilter("ready")}>Ready</button>
            </div>
            <button className="mobile-agent-search-toggle" aria-label="Open agent search" data-tooltip="Search agents" onClick={() => setSearchOpen(!searchOpen)}><FiSearch /></button><label className={`agent-search ${searchOpen ? "mobile-search-open" : ""}`} aria-label="Search agents">
              <FiSearch />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agent or client" />
            </label>
          </div>
        </div>

        {loading ? (
          <ReadySkeleton />
        ) : agents.length ? (
          <ReadyAgents agents={agents} view={view} busy={busy} startingId={startingId} start={(id) => { setStartingId(id); void command({ action: "start-agent", agentId: id }).finally(() => setStartingId("")); }} viewCall={(id) => router.push(`/controler/calls/${id}?from=live`)} stopQueue={(id)=>void command({action:"stop-agent",agentId:id})} />
        ) : (
          <div className="agent-empty-state">
            <FiUserX />
            <h3>No agents found</h3>
            <p>There are no matching agents for this search or filter.</p>
          </div>
        )}
      </section>

      <section className="admin-card live-chart">
        <div>
          <h2>Live call activity</h2>
          <p>Current connections and completed calls</p>
        </div>
        <svg viewBox="0 0 320 88" role="img" aria-label="Live call activity chart">
          <path d={`M0 72 C40 70 55 28 95 52 S150 72 188 30 S250 64 320 ${live.length ? 16 : 70} L320 88 L0 88 Z`} fill="rgba(232, 82, 10,0.08)"></path>
          <path d={`M0 72 C40 70 55 28 95 52 S150 72 188 30 S250 64 320 ${live.length ? 16 : 70}`} fill="none" stroke="#e96016" strokeWidth="3" strokeLinecap="round"></path>
        </svg>
      </section>

      <section className="live-visual-grid">
        <LiveHeatmap calls={calls} />
        <LiveDonut active={live.length} ready={readyAgents.length} completed={Number(metrics.completed || 0)} />
        <LiveBars agents={allAgents} />
      </section>

      <section className="admin-card running-calls">
        <div className="card-heading">
          <div>
            <h2>Running calls</h2>
            <p>Active conversations currently in progress.</p>
          </div>
          <span className="live-count">{live.length} ACTIVE</span>
        </div>

        {live.length ? (
          <div className="running-call-grid">
            {live.map((call) => (
              <article key={call.id} className="running-call">
                <div className="running-call-head">
                  <span className="pulse-dot" />
                  <strong>{call.agent_name}</strong>
                  <small>{call.status}</small>
                </div>
                <div className="running-person">
                  <strong>{call.lead_name || "Unknown lead"}</strong>
                  <span>{call.lead_number || "No client number"}</span>
                </div>
                <div className="running-info">
                  <div>
                    <span>From</span>
                    <b>{call.agent_number || "Not configured"}</b>
                  </div>
                  <div>
                    <span>Duration</span>
                    <b>{duration(call, now)}</b>
                  </div>
                </div>
                <div className="running-actions">
                  <button className="admin-primary live-view-button" onClick={() => router.push(`/controler/calls/${call.id}?from=live`)}>
                    <FiExternalLink />
                    <span>Live view</span>
                  </button>
                  <button className="admin-primary" onClick={() => download(call)}>
                    <FiDownload />
                    <span>Download note</span>
                  </button>
                  <button className="admin-outline" disabled={busy} onClick={() => command({ action: call.recording_active ? "record-stop" : "record-start", id: call.id })}>
                    <FiRadio />
                    <span>{call.recording_active ? "Recording" : "Record"}</span>
                  </button>
                  <button className="admin-outline" disabled={busy} onClick={() => command({ action: "hangup", id: call.id })}>
                    <FiPhoneOff />
                    <span>End</span>
                  </button>
                  <button className="admin-outline" disabled={busy} onClick={() => command({ action: call.on_hold ? "resume" : "hold", id: call.id })}>
                    {call.on_hold ? <FiPlay /> : <FiClock />}
                    <span>{call.on_hold ? "Resume" : "Hold"}</span>
                  </button>
                </div>
                {call.recording_url && (
                  <div className="call-audio-player">
                    <audio controls preload="metadata" src={call.recording_url} />
                    <a className="admin-outline small-btn" href={call.recording_url} target="_blank" rel="noreferrer" download>
                      <FiDownload />
                      <span>Download audio</span>
                    </a>
                  </div>
                )}
                <div className="running-transcript" aria-live="polite">
                  <b>Live conversation</b>
                  <p>{call.transcript || "Waiting for Telnyx conversation updates…"}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-running">
            <FiRadio />
            <b>No calls are running</b>
            <p>As soon as an agent starts dialing, the active call will appear here.</p>
          </div>
        )}
      </section>

      <EndedCalls calls={calls.filter((c) => c.status === "COMPLETED")} />
    </div>
  );
}

function ReadyAgents({ agents, view, busy, startingId, start, viewCall, stopQueue }: { agents: AgentCard[]; view: string; busy: boolean; startingId: string; start: (id: string) => void; viewCall: (id: string) => void; stopQueue: (id:string)=>void }) {
 const groups=[...new Set(agents.map(a=>a.campaign_category||a.campaign_name||'Unassigned agents'))].sort((a,b)=>Math.min(...agents.filter(x=>(x.campaign_category||x.campaign_name||'Unassigned agents')===a).map(x=>Number(x.remote_user)||999999))-Math.min(...agents.filter(x=>(x.campaign_category||x.campaign_name||'Unassigned agents')===b).map(x=>Number(x.remote_user)||999999))||a.localeCompare(b));
 return <div className="call-agent-groups">{groups.map(group=><section className="call-agent-group" key={group}><header className="call-agent-group-title"><div><span>Campaign team</span><h3>{group}</h3></div><b>{agents.filter(a=>(a.campaign_category||a.campaign_name||'Unassigned agents')===group).length} agents</b></header><div className={`ready-agent-grid ${view}`}>{agents.filter(a=>(a.campaign_category||a.campaign_name||'Unassigned agents')===group).sort((a,b)=>(Number(a.remote_user)||999999)-(Number(b.remote_user)||999999)||a.name.localeCompare(b.name)).map(agent=><article key={agent.id} className={`call-agent-card ${agent.kind}`}>
  <header className="call-agent-heading"><div className="call-agent-avatar">{agent.avatar_url?<img src={agent.avatar_url} alt=""/>:agent.name.split(' ').map(p=>p[0]).join('').slice(0,2)}</div><div className="call-agent-identity"><span className="call-agent-state"><i/>{agent.kind==='running'?'On a call':agent.kind==='ready'?'Ready to call':agent.is_queued?'Waiting for a call':agent.extension_route?'Not ready':'Route needed'}</span><h3>{agent.name}</h3><p>{agent.campaign_category||agent.campaign_name||'No campaign assigned'}{agent.outbound_number&&agent.campaign_name?` · ${agent.outbound_number}`:''}</p></div></header>
  <div className="call-agent-routing"><div><span>Extension route</span><strong>{agent.extension_route||'Not assigned'}</strong></div><div><span>Remote agent</span><strong>{agent.remote_user||'Not assigned'}</strong></div></div>
  <div className="call-agent-detail"><span>Voice <b>{agent.local_voice_name||'Not selected'}</b></span><span><b>{agent.dialed_calls||0}</b> calls</span></div>
  {agent.kind==='running'&&<p className="call-agent-customer">{agent.lead_name} <span>{agent.lead_number}</span></p>}
  <footer>{agent.kind==='running'?<button className="admin-primary" onClick={()=>agent.callId&&viewCall(agent.callId)}><FiExternalLink/>Open live call</button>:agent.is_queued?<button className="admin-outline" disabled={busy} onClick={()=>stopQueue(agent.id)}><FiPhoneOff/>Stop queue</button>:agent.kind==='ready'?<button className="admin-primary" disabled={busy||Boolean(startingId)} onClick={()=>start(agent.id)}><FiPlay/>{startingId===agent.id?'Starting…':'Start agent'}</button>:<span className="call-agent-setup">{agent.extension_route?'Complete calling setup to start':'Assign a route in VoIP to receive calls'}</span>}</footer>
 </article>)}</div></section>)}</div>;
}


function Kpi({ icon, tone, label, value }: { icon: React.ReactNode; tone: string; label: string; value: number }) {
  return (
    <section className={`live-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>Live update</small>
    </section>
  );
}

function LiveHeatmap({ calls }: { calls: Call[] }) { const cells = Array.from({ length: 24 }, (_, i) => calls.filter(c => new Date(c.created_at).getHours() === i).length); const max = Math.max(...cells, 1); return <section className="admin-card live-chart-card"><div className="card-heading"><div><h2>Activity heatmap</h2><p>Calls by hour today</p></div><FiActivityIcon /></div><div className="live-heatmap">{cells.map((value, i) => <i key={i} data-tooltip={`${i}:00 · ${value} calls`} style={{ opacity: .18 + value / max * .82 }} />)}</div><div className="chart-axis"><span>00:00</span><span>12:00</span><span>23:00</span></div></section> }
function LiveDonut({ active, ready, completed }: { active: number; ready: number; completed: number }) { const total = Math.max(active + ready + completed, 1), activePct = active / total * 100, readyPct = ready / total * 100; return <section className="admin-card live-chart-card"><div className="card-heading"><div><h2>Live pipeline</h2><p>Current agent status</p></div></div><div className="live-donut" style={{ background: `conic-gradient(#e96016 0 ${activePct}%, #159a68 ${activePct}% ${activePct + readyPct}%, #f0a34a ${activePct + readyPct}% 100%)` }}><strong>{active + ready + completed}</strong><small>Total</small></div><div className="chart-legend"><span><i className="blue-dot" /> Active {active}</span><span><i className="green-dot" /> Ready {ready}</span><span><i className="orange-dot" /> Completed {completed}</span></div></section> }
function LiveBars({ agents }: { agents: Array<{ name: string; dialed_calls?: number }> }) { const [showAll, setShowAll] = useState(false); const rows = agents.slice().sort((a, b) => Number(b.dialed_calls || 0) - Number(a.dialed_calls || 0)), visible = showAll ? rows : rows.slice(0, 4), max = Math.max(...rows.map(a => Number(a.dialed_calls || 0)), 1), colors = ["#e96016", "#159a68", "#e08b2d", "#c84646", "#eb6216", "#df5211"]; const chart = (items: typeof rows) => <div className="live-bars">{items.length ? items.map((agent, index) => <div key={agent.name}><span data-tooltip={agent.name}>{agent.name.split(" ")[0]}</span><b style={{ width: `${Number(agent.dialed_calls || 0) / max * 100}%`, background: colors[index % colors.length] }}>{agent.dialed_calls || 0}</b></div>) : <p className="empty-state">No agent call data yet.</p>}</div>; return <section className="admin-card live-chart-card"><div className="card-heading"><div><h2>Agent calls</h2><p>Dialled calls by agent</p></div>{rows.length > 4 && <button className="chart-more-button" onClick={() => setShowAll(true)}>View all</button>}</div>{chart(visible)}{showAll && <div className="chart-modal-backdrop" onMouseDown={() => setShowAll(false)}><section className="chart-modal" onMouseDown={e => e.stopPropagation()}><header><div><p>AGENT PERFORMANCE</p><h2>All agent calls</h2></div><button onClick={() => setShowAll(false)}>×</button></header>{chart(rows)}</section></div>}</section> }
function FiActivityIcon() { return <FiRadio /> }

function KpiSkeleton() {
  return <>{[1, 2, 3, 4].map((x) => <section className="live-kpi live-skeleton" key={x}><i /><b /><strong /><em /></section>)}</>;
}

function ReadySkeleton() {
  return (
    <div className="ready-agent-grid">
      {[1, 2, 3].map((x) => (
        <article className="ready-skeleton" key={x}>
          <i />
          <div>
            <b />
            <small />
            <small />
          </div>
        </article>
      ))}
    </div>
  );
}
