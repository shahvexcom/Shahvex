"use client";
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
type RosterAgent = { id: string; name: string; avatar_url?: string; status?: string; telnyx_credential?: string; groq_credential?: string; outbound_number?: string; lead_name?: string; lead_number?: string; dialed_calls?: number; is_running?: boolean; is_ready?: boolean; schedule?: AgentSchedule };

type AgentCard = {
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
  const rosterCards: AgentCard[] = (allAgents || []).map((agent) => {
    const readyAgent = ready.find((item) => item.id === agent.id);
    const isRunning = Boolean(agent.is_running);
    const schedule = agent.schedule || { isEnabled: false, startTime: "09:00", endTime: "17:00", isActive: false };
    const isReady = Boolean(agent.is_ready) && (!schedule.isEnabled || Boolean(schedule.isActive));
    const runningCall = calls.find((call) => call.agent_name === agent.name && activeStates.includes(call.status));
    return {
      id: agent.id,
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
  return [...rosterCards, ...runningExtras].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function LiveCalls({ onAction, onLiveCount }: { onAction: (message: string, kind?: "success" | "error") => void; onLiveCount: (count: number) => void }) {
  const router = useRouter();
  const [calls, setCalls] = useState<Call[]>([]), [ready, setReady] = useState<ReadyAgent[]>([]), [allAgents, setAllAgents] = useState<RosterAgent[]>([]), [metrics, setMetrics] = useState<CallMetrics>({});
  const [busy, setBusy] = useState(false), [startingId, setStartingId] = useState(""), [loading, setLoading] = useState(true), [view, setView] = useState<"grid" | "list" | "table">("grid");
  const [query, setQuery] = useState(""), [searchOpen, setSearchOpen] = useState(false), [filter, setFilter] = useState<"all" | "running" | "ready">("all");
  const [now, setNow] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState(""), [scheduleAgent, setScheduleAgent] = useState<AgentCard | null>(null), [savingSchedule, setSavingSchedule] = useState(false);
  const scheduleCheckRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/calls", { cache: "no-store", signal: AbortSignal.timeout(15000) }), d = await r.json();
      if (r.ok) {
        setCalls(d.calls || []);
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
      setLoading(false);
    }
  }, [onAction, onLiveCount]);

  useEffect(() => {
    const refresh = window.setInterval(() => { void load(); }, 5000);
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

  useEffect(() => {
    const run = async () => {
      if (scheduleCheckRunning.current) return;
      scheduleCheckRunning.current = true;
      try {
        const response = await fetch("/api/admin/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run-schedules" }) });
        const result = await response.json();
        if (response.ok && result.started?.length) await load();
      } catch { /* The regular refresh keeps the controller usable if a schedule check fails. */ }
      finally { scheduleCheckRunning.current = false; }
    };
    const boot = window.setTimeout(() => { void run(); }, 1200);
    const timer = window.setInterval(() => { void run(); }, 15000);
    return () => { window.clearTimeout(boot); window.clearInterval(timer); };
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

  const saveSchedule = async (schedule: AgentSchedule) => {
    if (!scheduleAgent) return;
    setSavingSchedule(true);
    try {
      const response = await fetch("/api/admin/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-schedule", agentId: scheduleAgent.id, ...schedule }) });
      const result = await response.json();
      onAction(result.message || (response.ok ? "Schedule saved." : "Schedule could not be saved."), response.ok ? "success" : "error");
      if (response.ok) { setScheduleAgent(null); await load(); }
    } catch { onAction("Unable to save the agent schedule.", "error"); }
    finally { setSavingSchedule(false); }
  };

  const live = calls.filter((c) => activeStates.includes(c.status));
  const readyAgents = useMemo(() => allAgents.filter((agent) => Boolean(agent.is_ready) && !agent.is_running && (!agent.schedule?.isEnabled || agent.schedule.isActive)), [allAgents]);
  const agents = useMemo(() => {
    const candidate = buildAgentCards(calls, ready, allAgents);
    const searchValue = query.trim().toLowerCase();
    return candidate.filter((agent) => {
      const matchesFilter = filter === "all" || agent.kind === filter;
      const matchesQuery = !searchValue || [agent.name, agent.lead_name, agent.lead_number, agent.outbound_number, agent.telnyx_credential, agent.groq_credential, String(agent.dialed_calls || 0)].join(" ").toLowerCase().includes(searchValue);
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
    <>
      <div className="admin-page-head">
        <div>
          <p>REAL-TIME MONITORING</p>
          <h1>Live calls</h1>
          <small className="live-pakistan-clock">Pakistan time {currentTime || "--:--"}</small>
        </div>
        <button className="admin-outline danger-outline" disabled={busy || loading || !live.length} onClick={() => command({ action: "hangup-all" })}>
          <FiPhoneOff />
          <span>End all active ({live.length})</span>
        </button>
        <button className="admin-primary live-start-all" disabled={busy || loading || !readyAgents.length} onClick={() => command({ action: "start-all" })}>
          <FiPlay />
          <span>{busy ? "Starting..." : `Start all ready agents (${readyAgents.length})`}</span>
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
              <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Table</button>
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
          <ReadyAgents agents={agents} view={view} busy={busy} startingId={startingId} start={(id) => { setStartingId(id); void command({ action: "start-agent", agentId: id }).finally(() => setStartingId("")); }} viewCall={(id) => router.push(`/controler/calls/${id}?from=live`)} editSchedule={setScheduleAgent} />
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
      {scheduleAgent && <ScheduleModal agent={scheduleAgent} saving={savingSchedule} onClose={() => setScheduleAgent(null)} onSave={saveSchedule} />}
    </>
  );
}

function ReadyAgents({ agents, view, busy, startingId, start, viewCall, editSchedule }: { agents: AgentCard[]; view: string; busy: boolean; startingId: string; start: (id: string) => void; viewCall: (id: string) => void; editSchedule: (agent: AgentCard) => void }) {
  return (
    <div className={`ready-agent-grid ${view}`}>
      {agents.map((agent) => (
        <article key={`${agent.kind}-${agent.id}`} className={`agent-card ${agent.kind}`}>
          <div className="agent-header-row">
            <div className="agent-avatar-wrap">
              {agent.avatar_url ? (
                <span
                  className="agent-avatar"
                  aria-label={agent.name}
                  data-tooltip={agent.name}
                  style={{
                    backgroundImage: `url(${agent.avatar_url})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                    color: "transparent",
                  }}
                >
                  {agent.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <span className="agent-avatar initials" aria-label={agent.name} data-tooltip={agent.name}>{agent.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <div className="agent-card-meta">
              <div className="agent-topline">
                <span className={`agent-badge ${agent.kind}`}>{agent.kind === "running" ? "Running" : agent.kind === "ready" ? "Ready agent" : "Agent not ready"}</span>
                <span className="agent-calls">{agent.dialed_calls || 0} calls</span>
              </div>
              <b>{agent.name}</b>
              <small>From: {agent.outbound_number}</small>
              <small>Client: {agent.lead_name} · {agent.lead_number}</small>
              <small>AI: {agent.groq_credential} · SIP: {agent.telnyx_credential}</small>
              {agent.schedule.isEnabled && <small className={`agent-schedule-status ${agent.schedule.isActive ? "active" : "waiting"}`}><FiClock /> {agent.schedule.startTime}–{agent.schedule.endTime} PKT · {agent.schedule.isActive ? "Active" : "Waiting"}</small>}
            </div>
          </div>
          <button type="button" className={`admin-outline agent-schedule-button ${agent.schedule.isEnabled ? "enabled" : ""}`} disabled={busy} onClick={() => editSchedule(agent)}><FiCalendar /><span>{agent.schedule.isEnabled ? "Edit schedule" : "Set schedule"}</span></button>
          {agent.kind === "ready" ? (
            <button className="admin-primary live-agent-start" disabled={busy || Boolean(startingId) || !agent.lead_number} onClick={() => start(agent.id)}>
              <FiPlay />
              <span>{startingId === agent.id ? "Calling..." : "Start call"}</span>
            </button>
          ) : agent.kind === "running" ? (
            <button className="admin-primary live-agent-start live-view-button" type="button" onClick={() => agent.callId && viewCall(agent.callId)} disabled={!agent.callId}>
              <FiExternalLink />
              <span>Live view</span>
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ScheduleModal({ agent, saving, onClose, onSave }: { agent: AgentCard; saving: boolean; onClose: () => void; onSave: (schedule: AgentSchedule) => Promise<void> }) {
  const [form, setForm] = useState<AgentSchedule>({ isEnabled: agent.schedule.isEnabled, startTime: agent.schedule.startTime || "09:00", endTime: agent.schedule.endTime || "17:00" });
  return <div className="agent-modal-backdrop schedule-modal-backdrop" onMouseDown={onClose}><section className="agent-modal agent-schedule-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="schedule-title"><header><div><p>OPTIONAL AUTO CALLING</p><h2 id="schedule-title">Schedule {agent.name}</h2></div><button type="button" onClick={onClose} aria-label="Close schedule"><FiX /></button></header><p className="schedule-help">When enabled, this agent automatically starts the next eligible lead call inside the selected Pakistan-time window. A call already in progress can finish after the end time.</p><label className="schedule-enable"><span><b>Use call schedule</b><small>Turn this off to keep normal manual calling.</small></span><input type="checkbox" checked={form.isEnabled} onChange={(event) => setForm(current => ({ ...current, isEnabled: event.target.checked }))} /></label><div className="schedule-time-grid"><label>Start time<input type="time" value={form.startTime} onChange={(event) => setForm(current => ({ ...current, startTime: event.target.value }))} /></label><label>End time<input type="time" value={form.endTime} onChange={(event) => setForm(current => ({ ...current, endTime: event.target.value }))} /></label></div><small className="schedule-note"><FiClock /> Pakistan Standard Time (PKT). Overnight windows such as 22:00–06:00 are supported.</small><footer><button type="button" className="admin-outline" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="admin-primary" disabled={saving || !form.startTime || !form.endTime || (form.isEnabled && form.startTime === form.endTime)} onClick={() => void onSave(form)}><FiSave /> {saving ? "Saving..." : "Save schedule"}</button></footer></section></div>;
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
