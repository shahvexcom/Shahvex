"use client";

import { recordingReference } from "@/lib/recording-reference";
import toast from "react-hot-toast";
import Link from "next/link";
import { FiActivity, FiArrowLeft, FiCheckCircle, FiHeadphones, FiLayers, FiMessageSquare, FiPhone, FiPhoneOff, FiRadio, FiSearch, FiUser, FiDownload, FiSquare, FiPlay } from "react-icons/fi";
import { useEffect, useRef, useState } from "react";
import "./live-conversation-monitor.css";
import { LiveCallListener } from "@/lib/live-call-listener";
import { LiveMonitorSetup } from "./live-monitor-setup";

type Turn = { role: string; content: string };
type Call = {
  telephony_provider?: string; direct_audio_line?: string; id: string; native_only?:boolean; native_connected?:boolean; agent_avatar?: string; agent_name: string; status: string; conversation_state: string;
  recording_serial?: string; recording_active?: boolean; ai_recording_id?: string; ending_requested?: boolean; ai_leg_released?: boolean;
  conversation_busy: boolean; lead_name: string; lead_number: string;
  vicidial_agent_user: string; external_campaign_id: string; asterisk_uniqueid: string;
  conversation_history: Turn[]; transcript: string;
};
const active = (call: Call) => ["INITIATED", "RINGING", "ANSWERED"].includes(call.status);

function AgentAvatar({ name, url, large = false, live = false }: {name: string; url?: string; large?: boolean; live?: boolean}) {
  const [failed, setFailed] = useState("");
  return <span className={`monitor-avatar${large ? " large" : ""}`}>
    {url && failed !== url ? <img src={url} alt={`${name} avatar`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} /> : <FiUser aria-label={`${name} avatar unavailable`} />}
    {live && <i />}
  </span>;
}

export default function LiveConversationMonitor({ portal }: { portal: "admin" | "bpo" }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "live" | "ended">("all");
  const [source, setSource] = useState<"campaign" | "local">("campaign");
  const [calls, setCalls] = useState<Call[]>([]);
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
        if (!response.ok) throw Error(data.error || data.message || "Unable to load calls.");
        if (!stopped) {
          setCalls(data.calls || []);
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
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [portal, source]);
  const visible = calls.filter(item => (filter === "all" || (filter === "live" ? active(item) : !active(item))) && [recordingReference(item,source === "local"),item.agent_name,item.lead_name,item.lead_number,item.direct_audio_line,item.vicidial_agent_user,item.external_campaign_id].join(" ").toLowerCase().includes(query.toLowerCase().trim()));
  const call = visible.find(item => item.id === selected) || visible[0];
  useEffect(() => {
    if (listening && (call?.id !== listening.id || call.status !== "ANSWERED" || call.ai_leg_released)) { listener.current?.stop(); setListening(null); }
  }, [call?.id, call?.status, call?.ai_leg_released, listening]);
  const liveCount = calls.filter(active).length;
  const campaignCount = new Set(calls.map(item => item.external_campaign_id).filter(Boolean)).size;
  const turns: Turn[] = call?.conversation_history?.length ? call.conversation_history
    : (call?.transcript || "").split(/\r?\n/).filter(Boolean).map(line => ({
      role: /^AGENT:/i.test(line) ? "assistant" : "user", content: line.replace(/^(AGENT|CLIENT):\s*/i, ""),
    }));
  const lastText = turns.map(turn => turn.content).join("");
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: "nearest" });
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
      {source === "campaign" && <div className="monitor-serial-lookup"><form onSubmit={event => {event.preventDefault();void findRecording();}}><label htmlFor="recording-serial-search">Find recording by serial</label><input id="recording-serial-search" placeholder="REC-000123" value={serialQuery} onChange={event=>setSerialQuery(event.target.value)} required maxLength={30} /><button disabled={serialBusy}>{serialBusy?"Finding…":"Find recording"}</button></form>{serialResult && <p role="status"><strong>{serialResult.serial}</strong> · {serialResult.agent_name} {serialResult.detail_url && <Link href={serialResult.detail_url}>Open call</Link>} {serialResult.download_url ? <button type="button" disabled={!!pending} onClick={()=>void download(serialResult)}>Download recording</button> : <span>Recording not ready yet.</span>}</p>}</div>}
      {source === "local" && <LiveMonitorSetup portal={portal} />}
      <div className="monitor-layout">
        <aside className="monitor-roster" aria-label="Calls">
          <div className="monitor-roster-heading"><div><h2>Conversations</h2><p>Select a call to follow along</p></div><span>{visible.length}</span></div>
          <label className="monitor-search"><FiSearch /><input aria-label="Search conversations" placeholder="Search agent, customer, or line" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="monitor-filters" role="group" aria-label="Call status">{(["all","live","ended"] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All calls" : value === "live" ? "Live" : "Ended"}</button>)}</div>
          <div className="monitor-call-list">
            {loading && !calls.length ? <div className="monitor-list-loading" role="status">Loading conversations…</div> : !visible.length ? <div className="monitor-list-empty"><FiPhoneOff /><strong>{calls.length ? "No matching calls" : "No calls just yet"}</strong><p>{calls.length ? "Try another search or status filter." : "Your live and recently ended calls will appear here."}</p></div> : visible.map(item => <div className="monitor-call-row" key={item.id}><button className="monitor-call" onClick={() => setSelected(item.id)} aria-pressed={call?.id === item.id}>
              <AgentAvatar name={item.agent_name} url={item.agent_avatar} live={active(item)} />
              <span className="monitor-call-info"><strong>{item.agent_name}</strong><span>{item.lead_name || item.lead_number || "Customer"}</span><small>{item.external_campaign_id || (source === "local" ? "Local test" : "Campaign")}{item.direct_audio_line ? ` · ${item.direct_audio_line}` : ""}</small></span>
              <span className={active(item) ? "monitor-call-state live" : "monitor-call-state"}>{active(item) ? "Live" : "Ended"}</span>
            </button>{active(item) && !item.native_only && <span className="monitor-row-actions"><button className={listening?.id === item.id ? "monitor-row-listen listening" : "monitor-row-listen"} aria-label={`${listening?.id === item.id ? "Stop listening to" : "Listen live to"} ${item.agent_name}`} title={listening?.id === item.id ? "Stop listening" : "Listen live · microphone off"} disabled={item.status !== "ANSWERED" || item.ai_leg_released} onClick={() => toggleListen(item)}>{listening?.id === item.id ? <FiSquare /> : <FiHeadphones />}</button><button className="monitor-row-end" aria-label={`End call for ${item.agent_name}`} title="End this call only" disabled={!!pending || item.ending_requested} onClick={() => void control(item,"hangup")}><FiPhoneOff /></button></span>}</div>)}
          </div>
          <div className="monitor-roster-footer"><FiActivity /> {liveCount} active · {calls.length - liveCount} ended</div>
        </aside>
        <section className="monitor-conversation" aria-label="Conversation">
          {call ? <><header>
            <div className="monitor-conversation-title"><AgentAvatar name={call.agent_name} url={call.agent_avatar} large /><div><h2>{call.agent_name}</h2><p>{call.lead_name || call.lead_number || "Customer conversation"}</p></div><span className={active(call) ? "monitor-session-state live" : "monitor-session-state"}><i />{call.native_only ? "Connected in VICIdial" : call.status === "INITIATED" ? "Connecting" : call.status === "RINGING" ? "Ringing" : active(call) ? "On a call" : "Call ended"}</span></div>
            <div className="monitor-call-meta"><div><small>Campaign</small><strong>{call.external_campaign_id || (source === "local" ? "Local test" : "—")}</strong></div><div><small>Extension</small><strong>{call.direct_audio_line || "—"}</strong></div><div><small>Remote agent</small><strong>{call.vicidial_agent_user || "—"}</strong></div><div><small>Call state</small><strong>{(call.conversation_state || call.status).replaceAll("_"," ").toLowerCase()}</strong></div></div>
            <div className="monitor-call-controls" aria-label="Selected call controls">
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
