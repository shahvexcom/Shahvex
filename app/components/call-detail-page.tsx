"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FiArrowLeft, FiDownload, FiFileText, FiMic, FiPause, FiPhoneOff, FiPlay, FiSave, FiVolume2 } from "react-icons/fi";

type Turn = { role: "user" | "assistant"; content: string; at?: string };
type Call = {
  telephony_provider?:string; collected_fields?:Record<string,{value:string}>; vicidial_sync_status?:string; transfer_status?:string; transfer_consent?:boolean;
  id: string; status: string; conversation_state?: string; agent_name: string; agent_avatar?: string; lead_name: string; lead_number: string;
  recording_url?: string; recording_id?: string; recording_active?: boolean; on_hold?: boolean; duration_seconds?: number;
  summary: string; notes: string; start_note?: string; mid_note?: string; final_note?: string; outcome?: string;
  transcript?: string; conversation_history?: Turn[]; script_lead_headers?: string[]; script_text?: string; created_at: string; answered_at?: string; ended_at?: string;
};
type Command = "transfer" | "sync-comments" | "hangup" | "record-start" | "record-stop" | "hold" | "resume";

const live = (status: string) => ["INITIATED", "RINGING", "ANSWERED"].includes(status);
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "CU";
const duration = (call: Call, now: number) => {
  const seconds = call.ended_at
    ? (call.duration_seconds ?? Math.max(0, Math.floor((new Date(call.ended_at).getTime() - new Date(call.answered_at || call.created_at).getTime()) / 1000)))
    : Math.max(0, Math.floor((now - new Date(call.answered_at || call.created_at).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const downloadText = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
};
const fallbackTurns = (transcript = ""): Turn[] => transcript.split("\n").map(line => {
  const match = line.match(/^(AGENT|CLIENT):\s*(.*)$/i);
  return match ? { role: match[1].toUpperCase() === "AGENT" ? "assistant" : "user", content: match[2] } as Turn : null;
}).filter((turn): turn is Turn => Boolean(turn?.content));

const downloadLead = (call: Call, turns: Turn[]) => downloadText(`lead-${call.id.slice(0, 8)}.txt`, `LEAD DETAILS\nName: ${call.lead_name || "Not provided"}\nPhone: ${call.lead_number || "Not provided"}\n\n${call.collected_fields ? "COLLECTED FIELDS\n"+Object.entries(call.collected_fields).map(([name,field])=>`${name}: ${field.value}`).join("\n")+"\n\n" : ""}CLIENT ANSWERS\n${turns.filter(turn => turn.role === "user").map(turn => `- ${cleanTranscriptText(turn.content)}`).join("\n") || "No client answers recorded."}`);

const cleanTranscriptText = (value: string) => value
  .replace(/<\/?(?:emotion|break|prosody|say-as|phoneme|speak)(?:\s[^>]*)?>/gi, " ")
  .replace(/\s+/g, " ")
  .trim();
const scriptLeadRequirements = (script: string) => {
  const text = script.toLowerCase();
  if (!text) return [] as string[];
  const fields = [
    ["Full Name", /full name|name of the client/],
    ["Date of Birth", /date of birth|\bdob\b/],
    ["Tenancy Start Date", /tenancy start date|how long.*property|at least 1 year/],
    ["Monthly Rent", /how much rent|monthly.*rent|rent monthly/],
    ["Tenancy Type (single or joint)", /single or joint tenancy|joint tenancy/],
    ["Health Issue from Disrepair", /health issue due to disrepair|health.*disrepair/],
  ] as const;
  return fields.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
};
const requirementAnswer = (field: string, answers: string[]) => {
  const patterns: Record<string, RegExp> = {
    "Full Name": /name|called|i'm|i am/i,
    "Date of Birth": /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|born|birth/i,
    "Tenancy Start Date": /tenan|moved|years? ago|since/i,
    "Monthly Rent": /rent|£|pounds/i,
    "Tenancy Type (single or joint)": /single|joint|tenan/i,
    "Health Issue from Disrepair": /health|asthma|ill|sick|doctor|injur/i,
  };
  return answers.some(answer => patterns[field]?.test(answer));
};

function LoadingLines({ count = 3 }: { count?: number }) {
  return <div className="notes-loading" aria-label="Loading notes">{Array.from({ length: count }, (_, index) => <i key={index} style={{ width: `${78 - index * 14}%` }} />)}</div>;
}

const audioClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function RecordingPlayer({ src, title, subtitle }: { src: string; title: string; subtitle: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const bars = [20,34,48,29,18,42,55,31,24,46,62,39,22,35,51,44,27,58,37,20,43,53,33,25,49,61,40,28,45,56,36,21,47,52,30,41];
  const toggle = async () => {
    const audio = audioRef.current; if (!audio) return;
    try { if (audio.paused) await audio.play(); else audio.pause(); } catch { setAudioError("Recording is not ready to play. Please try again shortly."); }
  };
  return <div className="recording-player">
    {audioError && <p role="alert">{audioError}</p>}
    <audio ref={audioRef} onError={() => setAudioError("Recording could not be loaded.")} preload="metadata" src={src} onLoadedMetadata={event => setTotal(event.currentTarget.duration || 0)} onDurationChange={event => setTotal(event.currentTarget.duration || 0)} onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <div className="recording-cover"><span /><i /></div>
    <div className="recording-copy"><strong>{title}</strong><small>{subtitle}</small></div>
    <div className="recording-wave" aria-hidden="true">{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} className={total && index / bars.length <= current / total ? "played" : ""} />)}</div>
    <input className="recording-progress" aria-label="Recording progress" type="range" min="0" max={total || 0} step="0.1" value={Math.min(current, total || 0)} onChange={event => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setCurrent(value); }} />
    <div className="recording-times"><span>{audioClock(current)}</span><span>{audioClock(total)}</span></div>
    <div className="recording-actions"><FiVolume2 /><button onClick={toggle} aria-label={playing ? "Pause recording" : "Play recording"}>{playing ? <FiPause /> : <FiPlay />}</button><a href={src.replace("?inline=1", "")} data-tooltip="Download recording" aria-label="Download recording"><FiDownload /></a></div>
  </div>;
}

export default function CallDetailPage({ portal = "admin" }: { portal?: "admin" | "agent" | "bpo" }) {
  const apiBase = `/api/${portal}/calls`;
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [call, setCall] = useState<Call | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [summaryWait, setSummaryWait] = useState(0);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesState, setNotesState] = useState<"saved" | "saving" | "idle">("idle");
  const conversationRef = useRef<HTMLDivElement>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingNotes = useRef(false);

  const load = useCallback(async () => {
    try {
    const response = await fetch(`${apiBase}?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json();
    const item = (data.calls as Call[] | undefined)?.[0];
    if (!response.ok || !item) { setMessage(data.message || "Call not found."); return; }
    setCall(item);
    if (!editingNotes.current) setNotesDraft(item.notes || "");
    } catch { setMessage("Unable to refresh call data. Retrying shortly."); }
  }, [id, apiBase]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), 3000);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(poll); window.clearInterval(timer); if (noteTimer.current) clearTimeout(noteTimer.current); };
  }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setSummaryWait(value => value + 1), 1000); return () => window.clearInterval(timer); }, []);

  const turns = (call?.conversation_history?.length ? call.conversation_history : fallbackTurns(call?.transcript))
    .map(turn => ({ ...turn, content: cleanTranscriptText(turn.content) }))
    .filter(turn => turn.content)
    .slice()
    .reverse();
  const clientAnswers = turns.filter(turn => turn.role === "user");
  const requiredFields = (call?.script_lead_headers || []).filter(Boolean);
  const scriptRequirements = scriptLeadRequirements(call?.script_text || "");
  const requirementFields = scriptRequirements.length ? scriptRequirements : requiredFields;
  const answerTexts = clientAnswers.map(turn => turn.content);
  const collectedFields = requirementFields.filter(field => field === "Full Name" ? Boolean(call?.lead_name) || requirementAnswer(field, answerTexts) : requirementAnswer(field, answerTexts));
  const leadPercent = requirementFields.length ? Math.round(collectedFields.length / requirementFields.length * 100) : 0;
  const fallbackSummary = clientAnswers.length ? `Client response: ${clientAnswers.map(turn => cleanTranscriptText(turn.content)).join(" ")}` : "No client answer was captured.";
  useEffect(() => { if (conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight; }, [turns.length]);

  const goBack = () => {
    if (portal === "agent") { router.push("/agent?tab=dialer"); return; }
    if (portal === "bpo") { router.push("/bpo?tab=manual"); return; }
    const source = new URLSearchParams(window.location.search).get("from");
    if (source) { router.push(`/controler?tab=${source === "reports" ? "reports" : source === "queue" ? "queue" : "live"}`); return; }
    try {
      const previous = new URL(document.referrer);
      if (previous.origin === window.location.origin && previous.pathname === "/controler") { router.back(); return; }
    } catch { /* Direct visits have no usable referrer. */ }
    router.push("/controler?tab=live");
  };
  const command = async (action: Command) => {
    if (!call) return;
    setBusy(true);
    try {
      const response = await fetch(apiBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: call.id }) });
      const data = await response.json();
      setMessage(data.message || "Command sent.");
      if (response.ok) await load();
    } catch { setMessage("Command could not be confirmed. Refreshing call status."); void load(); } finally { setBusy(false); }
  };
  const saveNotes = async (value: string) => {
    if (!call) return;
    setNotesState("saving");
    try {
    const response = await fetch(apiBase, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: call.id, notes: value }) });
    if (response.ok) { editingNotes.current = false; setNotesState("saved"); setTimeout(() => setNotesState("idle"), 1600); }
    else { setNotesState("idle"); setMessage("Notes could not be saved."); }
    } catch { setNotesState("idle"); setMessage("Notes could not be saved. Your draft is still here."); }
  };
  const changeNotes = (value: string) => {
    editingNotes.current = true; setNotesDraft(value); setNotesState("saving");
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => void saveNotes(value), 800);
  };

  if (!call) return <main className="admin-page call-detail-page"><button className="admin-outline call-back" onClick={goBack}><FiArrowLeft /> Back</button>{message ? <p className="muted">{message}</p> : <div className="call-detail-skeleton"><i /><i /><i /></div>}</main>;

  const active = live(call.status), time = duration(call, now), customer = call.lead_name || "Unnamed customer";
  const baseName = `call-${customer.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || call.id.slice(0, 8)}`;
  const elapsed = (turn: Turn) => {
    if (!turn.at || !call.answered_at) return "--:--";
    const seconds = Math.max(0, Math.floor((new Date(turn.at).getTime() - new Date(call.answered_at).getTime()) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const report = `CALL REPORT\nAgent: ${call.agent_name}\nClient: ${customer}\nNumber: ${call.lead_number}\nStatus: ${call.status}\nOutcome: ${call.outcome || "Not classified"}\nDuration: ${time}\n\nSUMMARY\n${call.summary || "Not available"}\n\nNOTES\n${notesDraft || "Not available"}\n\nTRANSCRIPT\n${call.transcript || "Not available"}`;

  return <main className="admin-page call-detail-page">
    <button className="admin-outline call-back" onClick={goBack}><FiArrowLeft /> Back</button>
    <div className="call-detail-title"><div><p>{active ? "LIVE CALL CONTROL" : "COMPLETED CALL"}</p><h1>{call.agent_name} <span>→</span> {customer}</h1></div><span className="call-live-timer">{time}</span></div>
    {call.telephony_provider==="VICIDIAL"&&<section className="admin-card"><h3>Collected lead details</h3>{Object.entries(call.collected_fields||{}).map(([name,field])=><p key={name}><strong>{name}:</strong> {field.value}</p>)}<p>VICIdial comments: {call.vicidial_sync_status||"PENDING"} ? Transfer: {call.transfer_status||"Not requested"}</p>{!active&&<button disabled={busy} onClick={()=>command("sync-comments")}>Retry comments sync</button>}</section>}
    <section className="call-detail-columns">
      <article className="admin-card detail-column conversation-column">
        <header className="detail-card-head"><div><h2>Conversation</h2><p>Live agent and client transcript</p></div><span className={active ? "conversation-live" : ""}>{active ? "LIVE" : call.status}</span></header>
        <div className="conversation-thread" ref={conversationRef} aria-live="polite">
          {turns.length ? turns.map((turn, index) => <div className={`conversation-message ${turn.role}`} key={`${turn.at || "turn"}-${index}`}><div><b>{turn.role === "assistant" ? call.agent_name : customer}</b><p>{turn.content}</p><time>{elapsed(turn)}</time></div></div>) : <p className="conversation-empty">Waiting for the conversation…</p>}
        </div>
        {!active && <div className="completed-summary"><h3>AI summary</h3>{call.summary ? <p>{call.summary}</p> : summaryWait < 20 ? <><LoadingLines /><small>Preparing summary from the completed conversation...</small></> : <><p>{fallbackSummary}</p><small>AI summary is still unavailable; this fallback is based on the recorded client answers.</small></>}</div>}
      </article>
      <article className="admin-card detail-column dialer-column">
        <div className="dialer-status"><span className={active ? "online" : ""} /><b>{call.status}</b><strong>{time}</strong></div>
        <div className="call-versus"><div className="versus-person agent">{call.agent_avatar ? <img src={call.agent_avatar} alt="" /> : <span>{initials(call.agent_name)}</span>}<small>Agent</small><b>{call.agent_name}</b></div><i>VS</i><div className="versus-person client"><span>{initials(customer)}</span><small>Client</small><b>{customer}</b></div></div><p>{call.lead_number || "Number unavailable"}</p>
        <hr /><small>Answered</small><p>{call.answered_at ? new Date(call.answered_at).toLocaleString() : "Awaiting answer"}</p>
        {active ? <div className="dialer-controls" aria-label="Live call controls">
          {call.telephony_provider==="VICIDIAL"&&<><button disabled={busy||call.status!=="ANSWERED"||!call.transfer_consent||["SUBMITTED","UNCERTAIN"].includes(call.transfer_status||"")} onClick={()=>command("transfer")}>Transfer to human</button><button disabled={busy} onClick={()=>command("sync-comments")}>Sync lead comments</button></>}
          <button className={call.recording_active ? "control-active" : ""} disabled={busy || call.status !== "ANSWERED" || call.telephony_provider === "VICIDIAL"} onClick={() => command(call.recording_active ? "record-stop" : "record-start")} data-tooltip={call.recording_active ? "Stop recording" : "Start recording"} aria-label={call.recording_active ? "Stop recording" : "Start recording"}><FiMic /></button>
          <button className={call.on_hold ? "control-active" : ""} disabled={busy || call.status !== "ANSWERED"} onClick={() => command(call.on_hold ? "resume" : "hold")} data-tooltip={call.on_hold ? "Resume call" : "Hold call"} aria-label={call.on_hold ? "Resume call" : "Hold call"}>{call.on_hold ? <FiPlay /> : <FiPause />}</button>
          <button className="danger" disabled={busy} onClick={() => command("hangup")} data-tooltip="End call" aria-label="End call"><FiPhoneOff /></button>
        </div> : <div className="ended-downloads">
          <button onClick={() => downloadLead(call, turns)} data-tooltip="Download collected customer data"><FiFileText /><span>{portal === "bpo" ? "Customer data" : "Lead"}</span></button>
          {(call.recording_id || call.recording_url) && <a href={`${apiBase}/${call.id}/recording`} data-tooltip="Download recording"><FiDownload /><span>Recording</span></a>}
          <button onClick={() => downloadText(`${baseName}-notes.txt`, notesDraft || "No notes available.")}><FiFileText /><span>Notes</span></button>
          <button onClick={() => downloadText(`${baseName}-summary.txt`, call.summary || "No summary available.")}><FiFileText /><span>Summary</span></button>
          <button onClick={() => downloadText(`${baseName}-transcript.txt`, call.transcript || "No transcript available.")}><FiFileText /><span>Transcript</span></button>
          <button onClick={() => downloadText(`${baseName}-report.txt`, report)}><FiDownload /><span>Report</span></button>
        </div>}
        {(call.recording_id || call.recording_url) && <RecordingPlayer src={`${apiBase}/${call.id}/recording?inline=1`} title={`${call.agent_name} × ${customer}`} subtitle="Call recording" />}
        {active && <p className="recording-note">{call.recording_active ? "● Recording automatically" : "Recording paused by controller"}</p>}
      </article>
      <article className="admin-card detail-column notes-column">
        <div className="detail-card-head"><div><h2>Collective notes</h2><p>Saved automatically while you type</p></div><span className="notes-save-state"><FiSave /> {notesState === "saving" ? "Saving" : notesState === "saved" ? "Saved" : "Auto-save"}</span></div>
        <div className="note-timeline"><p><b className="note-badge start">Start</b><span>{call.start_note || (clientAnswers.length ? cleanTranscriptText(clientAnswers[0].content) : turns.length ? cleanTranscriptText(turns[0].content) : <LoadingLines count={2} />)}</span></p><p><b className="note-badge mid">Flow</b><span>{call.mid_note || (clientAnswers.length > 1 ? clientAnswers.map(turn => cleanTranscriptText(turn.content)).join(" ") : clientAnswers.length ? cleanTranscriptText(clientAnswers[0].content) : <LoadingLines count={2} />)}</span></p><p><b className="note-badge final">Final</b><span>{call.final_note || call.notes || (call.summary ? call.summary : active ? "Final AI notes will be prepared after the call." : <LoadingLines count={2} />)}</span></p></div>
        <label className="operator-notes">{portal === "agent" ? "Agent notes" : portal === "bpo" ? "BPO notes" : "Controller notes"}<textarea value={notesDraft} onChange={event => changeNotes(event.target.value)} onBlur={() => { if (noteTimer.current) clearTimeout(noteTimer.current); if (editingNotes.current) void saveNotes(notesDraft); }} rows={8} placeholder="Add observations, follow-up details, or call notes…" /></label>
        <h3>Script requirements</h3><div className="lead-progress"><div><span>Required information collected</span><b>{leadPercent}%</b></div><i><em style={{ width: `${leadPercent}%` }} /></i></div><div className="lead-badges">{(requirementFields.length ? requirementFields : ["No lead requirements found in script"]).map((field, index) => { const collected = collectedFields.includes(field); return <span className={collected ? "collected" : "missing"} key={`${field}-${index}`}>{field}: {collected ? "Collected" : "Missing"}</span>; })}<span className="rule">Success: arrears not over £1,000, defects over £1,000, and tenant in property for 1+ year.</span>{clientAnswers.slice(-3).map((turn, index) => <span className="answer" key={`${turn.at || "answer"}-${index}`}>Client: {cleanTranscriptText(turn.content)}</span>)}</div><h3>Outcome</h3><div className={`call-outcome outcome-${(call.outcome || "unknown").toLowerCase()}`}>{call.outcome || "Not classified"}</div>
      </article>
    </section>
    {message && <p className="call-page-message">{message}</p>}
  </main>;
}
