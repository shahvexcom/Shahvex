"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiCheck, FiClock, FiFileText, FiMic, FiPhoneCall, FiPlay, FiRadio, FiRefreshCw, FiSave, FiSettings, FiUsers } from "react-icons/fi";
import "./bpo-dialing-workspace.css";

type DialingAgent = { is_queued?:boolean; id: string; name: string; avatar_url?: string; dialing_mode: "AUTO" | "MANUAL" | "BOTH"; customer_sheet_name: string; script_name: string; calls_made: number; live_call: { id: string; status: string } | null; next_customer: { name: string; number: string } | null; ready: boolean; blocked_reason: string };
type Usage = { calls: number; minutes: number; limits: { calls: number; minutes: number }; remaining: { calls: number; minutes: number } };
type AutoSettings = { isEnabled: boolean; startTime: string; endTime: string; maxCallDurationMinutes: number };
type CallProgress = { id: string; status: string; customer_name: string; customer_number: string; duration_seconds: number; created_at: string; progress: { collected: number; total: number; percent: number } };
const emptyUsage: Usage = { calls: 0, minutes: 0, limits: { calls: 0, minutes: 0 }, remaining: { calls: 0, minutes: 0 } };
const defaultSettings: AutoSettings = { isEnabled: false, startTime: "09:00", endTime: "17:00", maxCallDurationMinutes: 0 };
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "AI";
const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}m ${Math.max(0, seconds) % 60}s`;

export default function BpoDialingWorkspace({ mode }: { mode: "MANUAL" | "AUTO" }) {
  const router = useRouter();
  const [agents, setAgents] = useState<DialingAgent[]>([]), [callProgress, setCallProgress] = useState<CallProgress[]>([]), [usage, setUsage] = useState<Usage>(emptyUsage);
  const [autoSettings, setAutoSettings] = useState<AutoSettings>(defaultSettings), [scheduleActive, setScheduleActive] = useState(false), [currentTime, setCurrentTime] = useState("");
  const [loading, setLoading] = useState(true), [startingId, setStartingId] = useState(""), [savingSettings, setSavingSettings] = useState(false), [autoTicking, setAutoTicking] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const autoTickingRef = useRef(false);
  const autoSettingsDirtyRef = useRef(false);
  const isManual = mode === "MANUAL";

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(`/api/bpo/calls?view=dialing&mode=${mode}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load dialing agents.");
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      setCallProgress(Array.isArray(data.callProgress) ? data.callProgress : []);
      setUsage({ calls: Number(data.usage?.calls || 0), minutes: Number(data.usage?.minutes || 0), limits: { calls: Number(data.usage?.limits?.calls || 0), minutes: Number(data.usage?.limits?.minutes || 0) }, remaining: { calls: Number(data.usage?.remaining?.calls || 0), minutes: Number(data.usage?.remaining?.minutes || 0) } });
      if (data.autoSettings && !autoSettingsDirtyRef.current) setAutoSettings({ isEnabled: Boolean(data.autoSettings.isEnabled), startTime: String(data.autoSettings.startTime || "09:00"), endTime: String(data.autoSettings.endTime || "17:00"), maxCallDurationMinutes: Number(data.autoSettings.maxCallDurationMinutes || 0) });
      setScheduleActive(Boolean(data.scheduleActive));
      setCurrentTime(String(data.currentTime || ""));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load dialing agents."); }
    finally { if (showLoading) setLoading(false); }
  }, [mode]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(true); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [load]);
  const hasLiveAutoCall = callProgress.some(call => ["INITIATED", "RINGING", "ANSWERED"].includes(call.status));

  const triggerAutoDialer = useCallback(async (quiet = true) => {
    if (autoTickingRef.current) return;
    autoTickingRef.current = true;
    setAutoTicking(true);
    try {
      const response = await fetch("/api/bpo/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auto-tick" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Auto dialer could not be updated.");
      if (!quiet && data.message) setMessage(data.message);
      if (Number(data.started || 0) > 0 || Number(data.timedOut || 0) > 0) setMessage(data.message || "Auto dialer updated.");
      await load();
    } catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : "Auto dialer could not be updated."); }
    finally { autoTickingRef.current = false; setAutoTicking(false); }
  }, [load]);

  useEffect(() => {
    if (isManual || (!autoSettings.isEnabled && !hasLiveAutoCall)) return;
    void triggerAutoDialer();
    const timer = window.setInterval(() => void triggerAutoDialer(), 15000);
    return () => window.clearInterval(timer);
  }, [isManual, autoSettings.isEnabled, hasLiveAutoCall, triggerAutoDialer]);

  const start = async (agent: DialingAgent) => {
    setStartingId(agent.id); setMessage(""); setError("");
    try {
      const response = await fetch("/api/bpo/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start-agent", agentId: agent.id }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to start this call.");
      setMessage(data.message || "Call started.");
      if (data.callId) router.push(`/bpo/calls/${data.callId}`); else await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start this call."); await load(); }
    finally { setStartingId(""); }
  };

  const changeAutoSettings = (change: (current: AutoSettings) => AutoSettings) => {
    autoSettingsDirtyRef.current = true;
    setAutoSettings(change);
  };

  const saveAutoSettings = async () => {
    setSavingSettings(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/bpo/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-auto-settings", ...autoSettings }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to save auto dialer settings.");
      autoSettingsDirtyRef.current = false;
      if (data.autoSettings) setAutoSettings(data.autoSettings);
      setMessage(data.message || "Auto dialer settings saved.");
      await load();
      if (autoSettings.isEnabled) void triggerAutoDialer();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save auto dialer settings."); }
    finally { setSavingSettings(false); }
  };

  const totals = useMemo(() => ({ ready: agents.filter(agent => agent.ready).length, live: agents.filter(agent => agent.live_call).length }), [agents]);
  const title = isManual ? "Manual dialing" : "Auto dialing";
  const kpis = isManual ? [
    { icon: <FiUsers />, label: "Manual agents", value: agents.length, tone: "purple" }, { icon: <FiCheck />, label: "Ready agents", value: totals.ready, tone: "green" }, { icon: <FiPhoneCall />, label: "Calls remaining", value: `${usage.remaining.calls} / ${usage.limits.calls}`, tone: "blue" }, { icon: <FiClock />, label: "Minutes remaining", value: `${usage.remaining.minutes} / ${usage.limits.minutes}`, tone: "orange" },
  ] : [
    { icon: <FiUsers />, label: "Auto agents", value: agents.length, tone: "purple" }, { icon: <FiRadio />, label: "Schedule", value: scheduleActive ? "Live" : "Off window", tone: "green" }, { icon: <FiPhoneCall />, label: "Calls remaining", value: `${usage.remaining.calls} / ${usage.limits.calls}`, tone: "blue" }, { icon: <FiClock />, label: "Minutes remaining", value: `${usage.remaining.minutes} / ${usage.limits.minutes}`, tone: "orange" },
  ];

  if (loading) return <main className="bpo-dial-page"><div className="bpo-dial-title-skeleton bpo-dial-shimmer" /><section className="bpo-dial-kpis">{[1, 2, 3, 4].map(item => <i className="bpo-dial-shimmer" key={item} />)}</section><section className="bpo-dial-grid">{[1, 2].map(item => <i className="bpo-dial-shimmer" key={item} />)}</section></main>;

  return <main className="bpo-dial-page">
    <div className="bpo-dial-heading"><div><p className="bpo-eyebrow">{isManual ? "MANUAL DIALING · AGENT CONTROL" : "AUTO DIALING · SCHEDULED CALLING"}</p><h1>{title}</h1><a href="/bpo/live-monitor">Open live conversation monitor →</a><p>{isManual ? "Start a ready agent to receive answered calls from its assigned VICIdial campaign and follow its calling script. Numbers stay on VICIdial." : "Set a schedule and the auto dialer will start every ready Auto or Both agent during that window, while enforcing your combined plan call and minute allowance."}</p></div><button type="button" onClick={() => void load(true)}><FiRefreshCw /> Refresh</button></div>
    <section className="bpo-dial-kpis" aria-label={`${title} overview`}>{kpis.map(item => <Kpi {...item} key={item.label} />)}</section>
    {message && <p className="bpo-dial-message success"><FiCheck /> {message}</p>}{error && <p className="bpo-dial-message error">{error}</p>}
    {!isManual && <section className="bpo-auto-settings"><header><div><span><FiSettings /></span><div><p className="bpo-eyebrow">AUTO DIALER SETTINGS</p><h2>Schedule and call timer</h2><small>Pakistan time · current time {currentTime || "--:--"}</small></div></div><button type="button" role="switch" aria-label="Enable auto dialer" aria-checked={autoSettings.isEnabled} className={autoSettings.isEnabled ? "active" : ""} onClick={() => changeAutoSettings(current => ({ ...current, isEnabled: !current.isEnabled }))}><i />{autoSettings.isEnabled ? "Auto dialer on" : "Auto dialer off"}</button></header><div className="bpo-auto-setting-grid"><label>Start time<input type="time" value={autoSettings.startTime} onChange={event => changeAutoSettings(current => ({ ...current, startTime: event.target.value }))} /></label><label>End time<input type="time" value={autoSettings.endTime} onChange={event => changeAutoSettings(current => ({ ...current, endTime: event.target.value }))} /></label><label className="bpo-call-duration"><span>Call duration</span><div><button type="button" aria-pressed={!autoSettings.maxCallDurationMinutes} className={!autoSettings.maxCallDurationMinutes ? "selected" : ""} onClick={() => changeAutoSettings(current => ({ ...current, maxCallDurationMinutes: 0 }))}>Unlimited</button><button type="button" aria-pressed={Boolean(autoSettings.maxCallDurationMinutes)} className={autoSettings.maxCallDurationMinutes ? "selected" : ""} onClick={() => changeAutoSettings(current => ({ ...current, maxCallDurationMinutes: current.maxCallDurationMinutes || 5 }))}>Timer</button><input aria-label="Maximum call minutes" disabled={!autoSettings.maxCallDurationMinutes} type="number" min="1" max="240" value={autoSettings.maxCallDurationMinutes || ""} onChange={event => changeAutoSettings(current => ({ ...current, maxCallDurationMinutes: Math.max(0, Math.min(240, Number(event.target.value || 0))) }))} placeholder="min" /><small>minutes per answered call</small></div></label></div><footer><p>{scheduleActive ? "The current schedule window is active. Ready agents are checked every 15 seconds." : autoSettings.isEnabled ? "Schedule is enabled and will automatically run during the selected time window." : "Save and turn on the schedule when you are ready to begin auto dialing."}</p><div><button type="button" disabled={autoTicking || !autoSettings.isEnabled} onClick={() => void triggerAutoDialer(false)}><FiPlay /> {autoTicking ? "Checking..." : "Check now"}</button><button type="button" disabled={savingSettings} onClick={() => void saveAutoSettings()}><FiSave /> {savingSettings ? "Saving..." : "Save settings"}</button></div></footer></section>}
    <section className="bpo-dial-section"><header><div><h2>{isManual ? "Manual dialing agents" : "Auto dialing agents"}</h2><p>{isManual ? "Use Start Call only on a ready agent. Live controls and the customer conversation open on the call page." : "An agent set to Both appears here and in Manual Dialing. Calls start automatically only inside your saved schedule."}</p></div><span>{agents.length} agents</span></header>{agents.length ? <div className="bpo-dial-grid">{agents.map(agent => <article className={`bpo-dial-agent ${agent.live_call ? "live" : agent.ready ? "ready" : "blocked"}`} key={agent.id}><header><span className="bpo-dial-avatar">{agent.avatar_url ? <img src={agent.avatar_url} alt="" /> : initials(agent.name)}</span><div><h3>{agent.name}</h3><p>{agent.dialing_mode === "BOTH" ? "Auto + manual" : agent.dialing_mode === "MANUAL" ? "Manual only" : "Auto only"}</p></div><em>{agent.live_call ? agent.live_call.status : agent.is_queued ? "Waiting for answered call" : agent.ready ? "Ready" : "Not ready"}</em></header><dl><div><dt><FiFileText /> Customer sheet</dt><dd data-tooltip={agent.customer_sheet_name}>{agent.customer_sheet_name || "Not assigned"}</dd></div><div><dt><FiMic /> Agent script</dt><dd data-tooltip={agent.script_name}>{agent.script_name || "Not assigned"}</dd></div><div><dt><FiPhoneCall /> Next customer</dt><dd>{agent.next_customer ? `${agent.next_customer.name} · ${agent.next_customer.number}` : agent.customer_sheet_name==="Customers managed in VICIdial" ? "Supplied by VICIdial campaign" : "No eligible customer"}</dd></div></dl><footer><span>{agent.calls_made} calls made</span>{agent.live_call ? <button type="button" onClick={() => router.push(`/bpo/calls/${agent.live_call?.id}`)}><FiRadio /> Live view</button> : agent.is_queued ? <button type="button" disabled={Boolean(startingId)} onClick={async()=>{setStartingId(agent.id);try{const r=await fetch("/api/bpo/calls",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"stop-agent",agentId:agent.id})});const d=await r.json();if(!r.ok)throw Error(d.message);setMessage(d.message);await load();}catch(e){setError(e instanceof Error?e.message:"Queue stop failed");}finally{setStartingId("");}}}>Stop queue</button> : isManual && agent.ready ? <button type="button" disabled={Boolean(startingId)} onClick={() => void start(agent)}><FiPlay /> {startingId === agent.id ? "Calling..." : "Start call"}</button> : <small>{isManual ? agent.blocked_reason : agent.ready ? "Waiting for auto schedule" : agent.blocked_reason}</small>}</footer></article>)}</div> : <div className="bpo-dial-empty"><FiUsers /><h3>No eligible agents</h3><p>Create and activate an agent with {isManual ? "Manual" : "Auto"} dialing access to see it here.</p></div>}</section>
    <section className="bpo-call-progress"><header><div><p className="bpo-eyebrow">SCRIPT TASK PROGRESS</p><h2>{isManual ? "Manual call progress" : "Auto call progress"}</h2><p>Each call shows how much of its assigned agent script was collected from the customer conversation.</p></div><span>{callProgress.length} calls</span></header>{callProgress.length ? <div>{callProgress.map(call => <article key={call.id}><div><span className={`bpo-call-progress-status ${call.status.toLowerCase()}`}>{call.status}</span><strong>{call.customer_name}</strong><small>{call.customer_number || "Customer number unavailable"} · {clock(call.duration_seconds)}</small></div><div className="bpo-call-task-meter"><div><span>Script tasks</span><b>{call.progress.collected} / {call.progress.total}</b><em>{call.progress.percent}%</em></div><i><b style={{ width: `${call.progress.percent}%` }} /></i></div>{["INITIATED", "RINGING", "ANSWERED"].includes(call.status) && <button type="button" onClick={() => router.push(`/bpo/calls/${call.id}`)}><FiRadio /> Live view</button>}</article>)}</div> : <p className="bpo-call-progress-empty">No {isManual ? "manual" : "auto"} calls have started yet.</p>}</section>
  </main>;
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: string }) { return <article><span className={tone}>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>; }
