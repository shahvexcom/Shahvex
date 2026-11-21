"use client";

import { recordingReference } from "@/lib/recording-reference";
import toast from "react-hot-toast";
import Link from "next/link";
import { FiActivity, FiArrowLeft, FiCheckCircle, FiHeadphones, FiLayers, FiMessageSquare, FiPhone, FiPhoneOff, FiRadio, FiSearch, FiUser, FiDownload, FiSquare, FiPlay } from "react-icons/fi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./live-conversation-monitor.css";
import { LiveCallListener } from "@/lib/live-call-listener";
import { LiveMonitorSetup } from "./live-monitor-setup";

type Turn = { role: string; content: string };
type Call = {
  telephony_provider?: string; direct_audio_line?: string; id: string; native_only?:boolean; native_connected?:boolean; agent_avatar?: string; agent_name: string; status: string; conversation_state: string;
  recording_serial?: string; recording_active?: boolean; ai_recording_id?: string; ending_requested?: boolean; ai_leg_released?: boolean;
  created_at?: string; ended_at?: string; history_at?: string; transfer_status?: string;
  end_initiation?: { reason: string };
  conversation_busy: boolean; lead_name: string; lead_number: string;
  vicidial_agent_user: string; external_campaign_id: string; asterisk_uniqueid: string;
  conversation_history: Turn[]; transcript: string;
};
const active = (call: Call) => ["INITIATED", "RINGING", "ANSWERED"].includes(call.status);

const transferred = (call: Call) => call.transfer_status === "SUBMITTED" || call.transfer_status === "ANSWERED" || call.conversation_state === "HANDED_OFF";
const callFilters = { all: "All calls", live: "Live", ended: "Ended", transfer: "Transfer" } as const;

function callStatus(call: Call) {
  if (!active(call)) return call.status === "FAILED" ? "Failed" : "Ended";
  if (call.ending_requested) return "Ending";
  if (call.transfer_status === "ANSWERED") return "Transferred";
  if (call.transfer_status === "SUBMITTED") return "Transferring";
  if (call.native_only) return "Audio unlinked";
  if (call.status === "INITIATED") return "Linking audio";
  if (call.status === "RINGING") return "Ringing";
  return "Live";
}

function callTime(value?: string) {
  return value ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Karachi" }) : "Unavailable";
}

function outcomeLabel(call: Call) {
  if (call.transfer_status === "ANSWERED") return "AI handoff confirmed";
  const labels: Record<string, string> = {
    voicemail_detected: "Voicemail detected",
    customer_request: "Customer requested hangup",
    agent_hangup: "Agent requested hangup",
    admin_hangup: "Admin requested hangup",
    audio_link_timeout: "Audio link failed",
    media_pipeline_failure: "Media pipeline failed",
    no_speech_timeout: "No speech detected",
  };
  const reason = call.end_initiation?.reason;
  return reason ? labels[reason] : undefined;
}

function elapsed(call: Call, now: number) {
  const start = Date.parse(call.created_at || "");
  const end = active(call) ? now : Date.parse(call.ended_at || "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Unavailable";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function AgentAvatar({ name, url, large = false, live = false }: {name: string; url?: string; large?: boolean; live?: boolean}) {
  const [failed, setFailed] = useState("");
  return <span className={`monitor-avatar${large ? " large" : ""}`}>
    {url && failed !== url ? <img src={url} alt={`${name} avatar`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} /> : <FiUser aria-label={`${name} avatar unavailable`} />}
    {live && <i />}
  </span>;
}

export default function LiveConversationMonitor({ portal }: { portal: "admin" | "bpo" }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<keyof typeof callFilters>("all");
  const [source, setSource] = useState<"campaign" | "local">("campaign");
  const [calls, setCalls] = useState<Call[]>([]);
  const [history, setHistory] = useState<Call[]>([]);
  const [historyCursor, setHistoryCursor] = useState<Call>();
  const [hasMore, setHasMore] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const roster = useRef<HTMLDivElement>(null);
  const historySentinel = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);
  const historyRequest = useRef<AbortController | null>(null);
  const loadHistory = useCallback(async () => {
    if (source !== "campaign" || !hasMore || historyRequest.current) return;
    setHistoryError("");
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistoryBusy(true);
    const last = historyCursor;
    const params = new URLSearchParams({ history: "1" });
    if (last?.history_at) {
      params.set("before", last.history_at);
      params.set("id", last.id);
    }
    try {
      const response = await fetch(`/api/${portal}/live-monitor?${params}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.calls)) throw Error(data.message || "Unable to load call history.");
      if (!controller.signal.aborted) {
        const page = data.calls as Call[];
        setHistory(previous => [...new Map([...page, ...previous].map(item => [item.id, item])).values()]);
        if (page.length) setHistoryCursor(page.at(-1));
        setHasMore(data.has_more);
        setHistoryReady(true);
      }
    } catch {
      if (!controller.signal.aborted) setHistoryError("Unable to load call history.");
    } finally {
      if (historyRequest.current === controller) {
        historyRequest.current = null;
        setHistoryBusy(false);
      }
    }
  }, [hasMore, historyCursor, portal, source]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [nativeUnavailable, setNativeUnavailable] = useState(false);
  const listener = useRef<LiveCallListener | null>(null);
  const [listening, setListening] = useState<{id: string; state: "connecting" | "listening"} | null>(null);
  function toggleListen(target: Call) {
    if (listening?.id === target.id) { listener.current?.stop(); setListening(null); toast("Live listening stopped.",{id:"monitor-listening"}); return; }
    setSelected(target.id);
    listener.current ||= new LiveCallListener();
    void listener.current.start(`/api/${portal}/live-monitor/${source === "local" ? "local/" : ""}listen?id=${target.id}`, (state, message) => {
      setListening(state === "connecting" || state === "listening" ? {id: target.id, state} : null);
      if(state === "listening")toast.success("Listening live · microphone off",{id:"monitor-listening"});
      if (message) { if (state === "error") toast.error(message,{id:"monitor-listening"}); else toast(message,{id:"monitor-listening"}); }
    });
  }
  useEffect(() => { setListening(null); return () => listener.current?.stop(false); }, [portal, source]);
  const [serialQuery, setSerialQuery] = useState("");
  const [serialResult, setSerialResult] = useState<{id:string; recording_serial?:string; serial:string; agent_name:string; detail_url:string|null; download_url:string|null} | null>(null);
  const [serialBusy, setSerialBusy] = useState(false);
  async function findRecording() {
    setSerialBusy(true); setSerialResult(null); toast.loading("Finding recording…",{id:"monitor-serial"});
    try { const response = await fetch(`/api/${portal}/recordings?serial=${encodeURIComponent(serialQuery)}`,{cache:"no-store",signal:AbortSignal.timeout(15000)}); const data = await response.json(); if (!response.ok) throw Error(data.message || "Recording not found."); setSerialResult(data.call); toast.success(`Recording found: ${data.call.serial}`,{id:"monitor-serial",duration:3000}); }
    catch(err) { toast.error(err instanceof Error ? err.message : "Recording lookup failed.",{id:"monitor-serial",duration:4000}); }
    finally { setSerialBusy(false); }
  }
  const [pending, setPending] = useState("");
  const actionLock = useRef(false);
  async function control(target: Call, action: "hangup" | "record-start" | "record-stop") {
    if (actionLock.current) return;
    actionLock.current = true; setPending(target.id); toast.loading("Updating selected call…",{id:"monitor-action"});
    try {
      const response = await fetch(source === "local" ? `/api/${portal}/live-monitor/local/control` : `/api/${portal}/calls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: target.id, action }), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw Error(data.message || "Call action failed.");
      setCalls(previous => previous.map(item => item.id !== target.id ? item : { ...item, ...(action === "hangup" ? { ending_requested: true, conversation_state: "ENDING" } : { recording_active: data.recording_active, ai_recording_id: data.ai_recording_id || item.ai_recording_id }) }));
      toast.success(data.message || "Call updated.",{id:"monitor-action",duration:3000});
    } catch (err) { toast.error(err instanceof Error ? err.message : "Call action failed. Check status before retrying.",{id:"monitor-action",duration:4000}); }
    finally { actionLock.current = false; setPending(""); }
  }
  async function download(target: Pick<Call,"id"|"recording_serial">) {
    if (actionLock.current) return;
    actionLock.current = true; setPending(target.id); toast.loading("Downloading recording…",{id:"monitor-action"});
    try {
      const response = await fetch(source === "local" ? `/api/${portal}/live-monitor/local/control?id=${target.id}` : `/api/${portal}/calls/${target.id}/recording`, { cache: "no-store", signal: AbortSignal.timeout(60000) });
      if (!response.ok) { const data = await response.json(); throw Error(data.message || "Recording download failed."); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || `recording-${response.headers.get("X-Recording-Serial") || recordingReference(target, source === "local")}.wav`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Recording downloaded.",{id:"monitor-action",duration:3000});
    } catch (err) { toast.error(err instanceof Error ? err.message : "Recording download failed.",{id:"monitor-action",duration:4000}); }
    finally { actionLock.current = false; setPending(""); }
  }
  const [updated, setUpdated] = useState("");
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setHistory([]); setHistoryCursor(undefined); setHasMore(true); setHistoryBusy(false); setHistoryReady(false); setHistoryError("");
    setCalls([]); setSelected(""); setError(""); setNativeUnavailable(false); setUpdated(""); setLoading(true);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(`/api/${portal}/live-monitor${source === "local" ? "/local" : ""}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.calls)) throw Error(data.error || data.message || "Unable to load calls.");
        if (!stopped) {
          const incoming = data.calls as Call[];
          if (source === "campaign") {
            const ended = incoming.filter(item => !active(item) && item.history_at);
            if (ended.length) setHistory(previous => [...new Map([...previous, ...ended].map(item => [item.id, item])).values()]);
          }
          setCalls(incoming);
          setNativeUnavailable(data.native_status?.available === false);
          setError("");
          setUpdated(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : "Connection lost. Reconnecting…");
      } finally {
        if (!stopped) { setLoading(false); timer = setTimeout(refresh, 1000); }
      }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); historyRequest.current?.abort(); historyRequest.current = null; };
  }, [portal, source]);
  useEffect(() => {
    if (source !== "campaign" || filter === "live" || !hasMore || historyBusy || historyError) return;
    if (!historyReady) {
      const initial = setTimeout(() => void loadHistory(), 0);
      return () => clearTimeout(initial);
    }
    const sentinel = historySentinel.current;
    if (!sentinel || !roster.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadHistory();
    }, { root: roster.current, rootMargin: "0px 0px 120px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [source, filter, hasMore, historyBusy, historyError, historyReady, loadHistory]);
  const allCalls = useMemo(() => {
    const byId = new Map(calls.map(item => [item.id, item]));
    for (const item of history) {
      const current = byId.get(item.id);
      if (!current || active(current)) byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => {
      const aStart = a.history_at || a.created_at || "";
      const bStart = b.history_at || b.created_at || "";
      const milliseconds = (Date.parse(bStart) || 0) - (Date.parse(aStart) || 0);
      if (milliseconds) return milliseconds;
      if (a.history_at && b.history_at && a.history_at !== b.history_at) return a.history_at < b.history_at ? 1 : -1;
      return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
    });
  }, [calls, history]);
  const matchesFilter = (item: Call) => {
    if (filter === "transfer") return transferred(item);
    if (filter === "live") return active(item);
    if (filter === "ended") return !active(item);
    return true;
  };
  const serialReady = serialResult && (serialResult.download_url || allCalls.some(item => item.id === serialResult.id && item.ai_recording_id));
  const visible = allCalls.filter(item => matchesFilter(item) && [recordingReference(item,source === "local"),item.agent_name,item.lead_name,item.lead_number,item.direct_audio_line,item.vicidial_agent_user,item.external_campaign_id].join(" ").toLowerCase().includes(query.toLowerCase().trim()));
  const call = visible.find(item => item.id === selected) || visible[0];
  useEffect(() => {
    if (listening && (call?.id !== listening.id || call.status !== "ANSWERED" || call.ai_leg_released)) { listener.current?.stop(); setListening(null); }
  }, [call?.id, call?.status, call?.ai_leg_released, listening]);
  const liveCount = allCalls.filter(active).length;
  const campaignCount = new Set(calls.map(item => item.external_campaign_id).filter(Boolean)).size;
  const turns: Turn[] = call?.conversation_history?.length ? call.conversation_history
    : (call?.transcript || "").split(/\r?\n/).filter(Boolean).map(line => ({
      role: /^AGENT:/i.test(line) ? "assistant" : "user", content: line.replace(/^(AGENT|CLIENT):\s*/i, ""),
    }));
  const lastText = turns.map(turn => turn.content).join("");
  useEffect(() => {
    const timeline = bottom.current?.parentElement;
    if (follow && timeline) timeline.scrollTop = timeline.scrollHeight;
  }, [lastText, call?.id, follow]);
  useEffect(() => {
    if (error) toast.error(error,{id:"monitor-feed",duration:4000}); else toast.dismiss("monitor-feed");
  },[error]);
  const feedStatus = error ? "Reconnecting" : loading ? "Connecting" : nativeUnavailable ? "VICIdial status unavailable" : "Live updates";
  return <main className="conversation-monitor">
    <div className="monitor-shell">
      <header className="monitor-header">
        <div><Link className="monitor-back" href={portal === "admin" ? "/controler" : "/bpo"}><FiArrowLeft /> Dashboard</Link>
          <div className="monitor-eyebrow"><span /> CALL OPERATIONS</div><h1>Live monitor<span>.</span></h1>
          <p>Your calls, conversations, and agents. All in one view.</p>
        </div>
        <div className="monitor-feed"><span className={error || nativeUnavailable ? "monitor-feed-badge offline" : "monitor-feed-badge"} role="status"><i />{feedStatus}</span><small>Last synced {updated || "—"}{updated ? " PKT" : ""}</small></div>
      </header>
      <section className="monitor-stats" aria-label="Call overview">
        <div><span className="monitor-stat-icon green"><FiPhone /></span><div><small>Active calls</small><strong>{liveCount.toString().padStart(2,"0")}</strong></div><span className="monitor-stat-caption">Happening now</span></div>
        <div><span className="monitor-stat-icon orange"><FiLayers /></span><div><small>Campaigns in view</small><strong>{campaignCount.toString().padStart(2,"0")}</strong></div><span className="monitor-stat-caption">Across these calls</span></div>
        <div><span className="monitor-stat-icon blue"><FiMessageSquare /></span><div><small>Calls in view</small><strong>{calls.length.toString().padStart(2,"0")}</strong></div><span className="monitor-stat-caption">Live &amp; recent</span></div>
      </section>
      <div className="monitor-toolbar">
        <div className="monitor-source" role="group" aria-label="Call source">
          <button aria-pressed={source === "campaign"} onClick={() => {setSource("campaign");setQuery("");setFilter("all");}}><FiRadio /> Campaign calls</button>
          <button aria-pressed={source === "local"} onClick={() => {setSource("local");setQuery("");setFilter("all");}}><FiHeadphones /> Local test calls</button>
        </div>
        <span className="monitor-toolbar-note"><FiCheckCircle /> Transcript updates automatically</span>
      </div>
      {source === "campaign" && <div className="monitor-serial-lookup"><form onSubmit={event => {event.preventDefault();void findRecording();}}><label htmlFor="recording-serial-search">Find recording by serial</label><input id="recording-serial-search" placeholder="REC-000123" value={serialQuery} onChange={event=>setSerialQuery(event.target.value)} required maxLength={30} /><button disabled={serialBusy}>{serialBusy?"Finding…":"Find recording"}</button></form>{serialResult && <p role="status"><strong>{serialResult.serial}</strong> · {serialResult.agent_name} {serialResult.detail_url && <Link href={serialResult.detail_url}>Open call</Link>} {serialReady ? <button type="button" disabled={!!pending} onClick={()=>void download(serialResult)}>Download recording</button> : <span>Recording not ready yet.</span>}</p>}</div>}
      {source === "local" && <LiveMonitorSetup portal={portal} />}
      <div className="monitor-layout">
        <aside className="monitor-roster" aria-label="Calls">
          <div className="monitor-roster-heading"><div><h2>Conversations</h2><p>Select a call to follow along</p></div><span>{visible.length}</span></div>
          <label className="monitor-search"><FiSearch /><input aria-label="Search conversations" placeholder="Search agent, customer, or line" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="monitor-filters" role="group" aria-label="Call status">{(Object.keys(callFilters) as (keyof typeof callFilters)[]).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{callFilters[value]}</button>)}</div>
          <div className="monitor-call-list" ref={roster}>
            {error && <div role="alert" className="monitor-error">{error} Retrying automatically.</div>}
            {!visible.length && (loading || (source === "campaign" && filter !== "live" && !historyReady && !historyError)) ? <div className="monitor-list-loading" role="status">Loading conversations…</div> : !visible.length && (error || historyError) ? null : !visible.length ? <div className="monitor-list-empty"><FiPhoneOff /><strong>{allCalls.length ? "No matching calls" : "No calls just yet"}</strong><p>{allCalls.length ? "Try another search or status filter." : "Your live and recently ended calls will appear here."}</p></div> : visible.map(item => <div className="monitor-call-row" key={item.id}><button className="monitor-call" onClick={() => setSelected(item.id)} aria-pressed={call?.id === item.id}>
              <AgentAvatar name={item.agent_name} url={item.agent_avatar} live={active(item)} />
              <span className="monitor-call-info"><strong>{item.agent_name}</strong><span>{item.lead_name ? `${item.lead_name} · ` : ""}{item.lead_number || "Unavailable"}</span><small>{item.external_campaign_id || (source === "local" ? "Local test" : "Campaign")}{item.direct_audio_line ? ` · ${item.direct_audio_line}` : ""} · {elapsed(item, now)}{!active(item) && outcomeLabel(item) ? ` · ${outcomeLabel(item)}` : ""}</small></span>
              <span className="monitor-call-badges">
                <span className={active(item) ? "monitor-call-state live" : "monitor-call-state"}>{callStatus(item)}</span>
                {!active(item) && transferred(item) && <span className="monitor-call-state transfer">Transfer</span>}
              </span>
            </button>{active(item) && !item.native_only && <span className="monitor-row-actions"><button className={listening?.id === item.id ? "monitor-row-listen listening" : "monitor-row-listen"} aria-label={`${listening?.id === item.id ? "Stop listening to" : "Listen live to"} ${item.agent_name}`} title={listening?.id === item.id ? "Stop listening" : "Listen live · microphone off"} disabled={item.status !== "ANSWERED" || item.ai_leg_released} onClick={() => toggleListen(item)}>{listening?.id === item.id ? <FiSquare /> : <FiHeadphones />}</button><button className="monitor-row-end" aria-label={`End call for ${item.agent_name}`} title="End this call only" disabled={!!pending || item.ending_requested} onClick={() => void control(item,"hangup")}><FiPhoneOff /></button></span>}</div>)}
            {source === "campaign" && filter !== "live" && hasMore && (
              historyError ? <div role="alert" className="monitor-error">{historyError} <button type="button" onClick={() => void loadHistory()}>Retry</button></div>
                : <div ref={historySentinel} style={{ minHeight: 1 }}>{historyBusy && historyReady && <span role="status">Loading older calls…</span>}</div>
            )}
          </div>
          <div className="monitor-roster-footer"><FiActivity /> {liveCount} active · {allCalls.length - liveCount} ended shown</div>
        </aside>
        <section className="monitor-conversation" aria-label="Conversation">
          {call ? <><header>
            <div className="monitor-conversation-title"><AgentAvatar name={call.agent_name} url={call.agent_avatar} large /><div><h2>{call.agent_name}</h2><p>{call.lead_name ? `${call.lead_name} · ` : ""}{call.lead_number || "Unavailable"}</p></div><span className={active(call) ? "monitor-session-state live" : "monitor-session-state"}><i />{callStatus(call)}</span></div>
            <div className="monitor-call-meta"><div><small>Campaign</small><strong>{call.external_campaign_id || (source === "local" ? "Local test" : "—")}</strong></div><div><small>Extension</small><strong>{call.direct_audio_line || "—"}</strong></div><div><small>Remote agent</small><strong>{call.vicidial_agent_user || "—"}</strong></div><div><small>Call state</small><strong>{(call.conversation_state || call.status).replaceAll("_"," ").toLowerCase()}</strong></div></div>
            <div className="monitor-call-meta"><div><small>Started</small><strong>{callTime(call.created_at)}</strong></div><div><small>Ended</small><strong>{active(call) ? "In progress" : callTime(call.ended_at)}</strong></div><div><small>Duration</small><strong>{elapsed(call, now)}</strong></div></div>
            {outcomeLabel(call) && <p>{call.transfer_status === "ANSWERED" ? outcomeLabel(call) : `Hangup initiated · ${outcomeLabel(call)}`}</p>}
            <div className="monitor-call-controls" aria-label="Selected call controls">
              {call.lead_number && <button onClick={() => void navigator.clipboard.writeText(call.lead_number).then(() => toast.success("Number copied.")).catch(() => toast.error("Unable to copy the number."))}>Copy number</button>}
              {active(call) && !call.ai_leg_released && <button className={listening?.id === call.id ? "monitor-listen-button listening" : "monitor-listen-button"} disabled={call.status !== "ANSWERED"} onClick={() => toggleListen(call)}>{listening?.id === call.id ? <FiSquare /> : <FiHeadphones />}{listening?.id === call.id ? "Stop listening" : "Listen live"}</button>}
              {!call.native_only && <span className={call.recording_active && active(call) ? "monitor-recording active" : "monitor-recording"}><i />{call.recording_active && active(call) ? "Recording" : "Recording stopped"}</span>}
              {active(call) && !call.ai_leg_released && <button disabled={!!pending || call.ending_requested} onClick={() => void control(call, call.recording_active ? "record-stop" : "record-start")}>{call.recording_active ? <FiSquare /> : <FiPlay />}{call.recording_active ? "Stop recording" : "Start recording"}</button>}
              {(!call.native_only || call.ai_recording_id) && <button disabled={!!pending || !call.ai_recording_id} title={!call.ai_recording_id ? "Stop recording or wait for the call to end to download" : "Download saved AI recording"} onClick={() => void download(call)}><FiDownload /> Download recording</button>}
              {active(call) && !call.native_only && <button className="monitor-end-call" disabled={!!pending || call.ending_requested} onClick={() => void control(call,"hangup")}><FiPhoneOff />{call.ending_requested ? "Ending call…" : "End call"}</button>}
            </div>
            {listening?.id === call.id && <p className="monitor-listening-status" role="status"><FiHeadphones />{listening.state === "connecting" ? "Connecting live audio…" : "Listening live · customer + agent · microphone off"}</p>}
            {(!call.native_only || call.recording_serial) && <p className="monitor-recording-reference">Recording serial: <strong>{recordingReference(call,source === "local")}</strong><button onClick={() => { void navigator.clipboard.writeText(recordingReference(call,source === "local")).then(() => toast.success("Recording serial copied.")).catch(() => toast.error("Select and copy the recording serial above.")); }}>Copy serial</button></p>}
            {call.native_only && <p className="monitor-native-notice" role="status">Connected in VICIdial · {call.lead_number || "Customer number pending"}. AI audio is not linked; listening and AI controls are unavailable for this connection.</p>}
            <p className="monitor-controls-note">Controls apply to this call only. Recording controls manage the AI recording; the dialer may keep its own recording.</p>
          </header>
          <div className="monitor-transcript-toolbar"><span><FiMessageSquare /> Conversation <small>{turns.length} messages</small></span><label className="monitor-follow"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Auto-scroll</label></div>
          <div className="monitor-messages" tabIndex={0} role="log" aria-live="off" aria-label="Agent and customer messages">
            <div className="monitor-timeline-label"><span />{active(call) ? "Live conversation" : "Conversation history"}<span /></div>
            {!turns.length && <div className="monitor-transcript-empty"><FiHeadphones /><p>{call.native_only?"Native call connected":"Waiting for the first words"}</p><small>{call.native_only?"No AI transcript is available until its audio leg is linked.":"Messages appear here as the conversation unfolds."}</small></div>}
            {turns.filter(turn => turn.role === "assistant" || turn.role === "user").map((turn, index) => <article key={`${call.id}-${index}`} className={turn.role === "assistant" ? "monitor-agent" : "monitor-customer"}>
              <div className="monitor-speaker">{turn.role === "assistant" ? <FiHeadphones /> : <FiUser />}<strong>{turn.role === "assistant" ? call.agent_name : "Customer"}</strong><small>{turn.role === "assistant" ? "AI agent" : "Caller"}</small></div><p>{turn.content}</p>
            </article>)}
            {call.conversation_busy && active(call) && <p className="monitor-progress"><i /><i /><i /> Updating conversation</p>}
            <div ref={bottom} />
          </div><footer><span><FiCheckCircle /> Live transcript</span><span>Spoken audio may be interrupted or arrive after the text.</span></footer></>
          : <div className="monitor-empty"><div className="monitor-empty-icon"><FiHeadphones /></div><span>YOUR CONVERSATION WORKSPACE</span><h2>{calls.length ? "Find your conversation" : "Ready when your calls are"}</h2><p>{calls.length ? "Choose another search or filter to find a call." : "Choose a call from the left to follow the agent and customer conversation here."}</p><div className="monitor-empty-hint"><FiRadio /> {source === "campaign" ? "Listening for campaign calls" : "Connect your local bridge above to start"}</div></div>}
        </section>
      </div>
    </div>
  </main>;
}
