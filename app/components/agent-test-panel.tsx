"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConversationRecorder } from "@/lib/browser-conversation-recorder";
import { AdminSkeleton } from "./admin-skeleton";
import { BrowserSpeechCapture } from "@/lib/browser-speech-capture";
import { conversationStyles, detailLabels, emptyScriptDetails, type ScriptDetails } from "@/lib/agent-script-details";
import Image from "next/image";
import { RecordingPlayer } from "./recording-player";
import { LuBrush } from "react-icons/lu";
import { BrowserPCMPlayer } from "@/lib/browser-pcm-player";
import { FiMic, FiMicOff, FiSquare, FiX, FiVolume2, FiChevronDown, FiDownload } from "react-icons/fi";
import { CustomSelect } from "./custom-select";
import type { TestConfig } from "@/lib/agent-test";
import "./local-agent-voice-test.css";
import "./agent-test-panel.css";

type Line = { id: string; role: string; text: string };
type VoiceTiming = { stage: string; elapsedMs?: number; atMs: number; turnId?: string };
const base = "/api/admin/agent-test";
export function AgentTestPanel({ agentId: initialAgentId, agentName: initialName = "Agent", avatarUrl: initialAvatar, onVoiceChange, agents = [] }: { agentId?: string; agentName?: string; avatarUrl?: string; onVoiceChange?: (name: string) => void; agents?: {id:string;name:string;avatar_url?:string}[] }) {
  const [selectedAgentId,setSelectedAgentId]=useState(initialAgentId||agents[0]?.id||"");
  const selectedAgent=agents.find(a=>a.id===selectedAgentId);
  const [profile,setProfile]=useState<{name:string;avatarUrl:string}|null>(null);
  const agentId=selectedAgentId,agentName=profile?.name||selectedAgent?.name||initialName,avatarUrl=profile?.avatarUrl||selectedAgent?.avatar_url||initialAvatar;
  const hiddenTurns=useRef(new Set<string>());
  const [recordedAgentName,setRecordedAgentName]=useState("");
  const [open, setOpen] = useState(false), [config, setConfig] = useState<TestConfig>(), [voices, setVoices] = useState<{ id: string; name: string; gender?: string;language?:string;accent?:string }[]>([]);
  const [status, setStatus] = useState(""), [running, setRunning] = useState(false), [busy, setBusy] = useState(false), [lines, setLines] = useState<Line[]>([]), [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0), [playing, setPlaying] = useState(false), [mobilePanel,setMobilePanel] = useState<"configuration"|"conversation">("configuration");
  const [recording,setRecording] = useState(false), [recordFinalizing,setRecordFinalizing] = useState(false), [recordURL,setRecordURL] = useState(""), [recordSeconds,setRecordSeconds] = useState(0), [recordError,setRecordError] = useState(""), [recordExtension,setRecordExtension] = useState("webm");
  const recorder = useRef<ConversationRecorder | null>(null), micRecordGain = useRef<GainNode | null>(null), recordingNow = useRef(false), recordStarted = useRef(0), recordTimer = useRef<ReturnType<typeof setInterval> | null>(null), savedURL = useRef(""), mounted = useRef(true);
  const finalizeRecording = () => {
    if (!recordingNow.current) return;
    recordingNow.current=false; if(recordTimer.current)clearInterval(recordTimer.current);
    setRecordSeconds(Math.floor((performance.now()-recordStarted.current)/1000)); setRecording(false); setRecordFinalizing(true); recorder.current?.stop();
  };
  const beginRecording = (stream: MediaStream) => {
    if (recordingNow.current || recorder.current) throw Error("A recording is already active or finalizing");
    if (savedURL.current) { URL.revokeObjectURL(savedURL.current); savedURL.current=""; setRecordURL(""); }
    const current = new ConversationRecorder(); recorder.current=current; setRecordError(""); setRecordedAgentName(config?.name||agentName); setRecordSeconds(0); recordStarted.current=performance.now();
    try { current.start(stream,blob=>{
      recorder.current=null;recordingNow.current=false;if(recordTimer.current)clearInterval(recordTimer.current);
      if(!mounted.current)return;
      const url=URL.createObjectURL(blob);savedURL.current=url;setRecordURL(url);setRecordExtension(blob.type.includes("mp4")?"m4a":"webm");setRecordFinalizing(false);setRecording(false);
    },message=>{recorder.current=null;recordingNow.current=false;if(recordTimer.current)clearInterval(recordTimer.current);if(mounted.current){setRecordError(message);setRecording(false);setRecordFinalizing(false);}}); } catch(error) { recorder.current=null; current.discard(); setRecordError(error instanceof Error?error.message:"Recording could not start"); throw error; }
    recordingNow.current=true;setRecording(true);recordTimer.current=setInterval(()=>setRecordSeconds(Math.floor((performance.now()-recordStarted.current)/1000)),500);
  };
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;recorder.current?.stop();if(recordTimer.current)clearInterval(recordTimer.current);if(savedURL.current)URL.revokeObjectURL(savedURL.current);};},[]);
  useEffect(()=>{const voice=voices.find(v=>v.id===config?.voice);if(voice)onVoiceChange?.(voice.name);},[voices,config?.voice,onVoiceChange]);
  const [timings, setTimings] = useState<VoiceTiming[]>([]);
  const [extraction, setExtraction] = useState<{ script: string; details: ScriptDetails; status: "ready" | "loading" | "error"; error?: string }>({ script: "", details: emptyScriptDetails(), status: "ready" });
  const [extractionRetry, setExtractionRetry] = useState(0), [audioError, setAudioError] = useState(""), [previewing, setPreviewing] = useState(false);
  const capture = useRef(new BrowserSpeechCapture()), preview = useRef<AudioBufferSourceNode | null>(null), previewContext = useRef<AudioContext | null>(null), previewAbort = useRef<AbortController | null>(null), loadVersion = useRef(0), startupAbort = useRef<AbortController | null>(null);
  const currentScript = config?.script;
  const extractionReady = currentScript !== undefined && extraction.script === currentScript && extraction.status === "ready";
  useEffect(() => {
    if (!open || currentScript === undefined) return;
    const control = new AbortController(); let valid = true;
    const timer = setTimeout(async () => {
      if (!currentScript.trim()) { setExtraction({ script: currentScript, details: emptyScriptDetails(), status: "ready" }); return; }
      setExtraction({ script: currentScript, details: emptyScriptDetails(), status: "loading" });
      try {
        const r = await fetch(`${base}?action=extract`, { method: "POST", signal: control.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script: currentScript }) });
        const d = await r.json(); if (!r.ok) throw Error(d.error || "Unable to extract script details");
        if (valid && d.script === currentScript) setExtraction({ script: currentScript, details: d.details, status: "ready" });
      } catch (error) { if (valid && !control.signal.aborted) setExtraction({ script: currentScript, details: emptyScriptDetails(), status: "error", error: error instanceof Error ? error.message : "Extraction failed" }); }
    }, currentScript.trim() ? 650 : 0);
    return () => { valid = false; control.abort(); clearTimeout(timer); };
  }, [open, currentScript, extractionRetry]);
  const stopPreview = () => { previewAbort.current?.abort(); try { preview.current?.stop(); } catch {} if (previewContext.current?.state !== "closed") void previewContext.current?.close().catch(() => {}); previewContext.current = null; preview.current = null; setPreviewing(false); };
  const previewVoice = async () => {
    if (!config || running) return; stopPreview(); setAudioError(""); setPreviewing(true);
    const control = new AbortController(); previewAbort.current = control;
    try {
      // Resume in the click gesture, before awaiting synthesis, so autoplay cannot silently block the preview.
      const output = new AudioContext(); previewContext.current = output; await output.resume();
      if (output.state !== "running") throw Error("Audio output is blocked. Allow browser audio and try preview again.");
      const r = await fetch(`${base}?action=preview`, { method: "POST", signal: control.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice: config.voice }) });
      if (!r.ok) throw Error((await r.json()).error || "Voice preview failed");
      const blob = await r.blob(); control.signal.throwIfAborted(); if (blob.size < 44) throw Error("Voice preview was empty");
      const buffer = await output.decodeAudioData(await blob.arrayBuffer()); control.signal.throwIfAborted();
      if (!buffer.length || !buffer.duration) throw Error("Voice preview decoded to empty audio");
      const source = output.createBufferSource(); source.buffer = buffer; source.connect(output.destination); preview.current = source;
      source.onended = () => { if (preview.current === source) setPreviewing(false); if (output.state !== "closed") void output.close().catch(() => {}); }; source.start();
    } catch (error) { if (!control.signal.aborted) { setAudioError(error instanceof Error ? error.message : "Voice preview failed"); setPreviewing(false); if (previewContext.current?.state !== "closed") void previewContext.current?.close().catch(() => {}); previewContext.current = null; } }
  };
  const player = useRef<BrowserPCMPlayer | null>(null), interruption = useRef<Promise<unknown>>(Promise.resolve()), chat = useRef<HTMLDivElement>(null), followChat = useRef(true), browserTurn = useRef({ started: 0, firstPlayback: false, turnId: "" });
  const metric = (event: Omit<VoiceTiming, "atMs">) => {
    const value = { ...event, atMs: performance.now() };
    console.info("[Shahvex agent test browser]", value);
    setTimings(old => [...old.slice(-49), value]);
  };
  useEffect(() => { if (followChat.current && chat.current) chat.current.scrollTop = chat.current.scrollHeight; }, [lines]);
  const session = useRef(""), context = useRef<AudioContext | null>(null), mic = useRef<MediaStream | null>(null), generation = useRef(0), active = useRef(false), mute = useRef(false), working = useRef(false), abort = useRef<AbortController | null>(null), dialog = useRef<HTMLDivElement>(null), turnRef = useRef<(audio?: Blob, text?: string, opening?: boolean, recordingId?: string) => Promise<void>>(async () => {});
  const clearAudio = () => { player.current?.clear(generation.current); setPlaying(false); };
  const stop = () => {
    finalizeRecording();
    active.current = false; startupAbort.current?.abort(); generation.current++; capture.current.reset(); abort.current?.abort(); clearAudio(); mic.current?.getTracks().forEach(t => t.stop()); mic.current = null;
    player.current?.dispose(); player.current = null; void context.current?.close(); context.current = null;
    if (session.current) void fetch(`${base}?action=stop&id=${session.current}`, { method: "POST", keepalive: true });
    session.current = ""; working.current = false; setRunning(false); setBusy(false); setLevel(0); setStatus("Ready");
  };
  const interrupt = (preserveRecording = false) => {
    if (!preserveRecording) capture.current.reset();
    generation.current++; abort.current?.abort(); clearAudio();
    working.current = false; setBusy(false);
    if (session.current) interruption.current = fetch(`${base}?action=interrupt&id=${session.current}`, { method: "POST" }).catch(() => {});
    setStatus("Interrupted — listening");
  };
  useEffect(() => () => { active.current = false; startupAbort.current?.abort(); abort.current?.abort(); mic.current?.getTracks().forEach(t => t.stop()); player.current?.dispose(); void context.current?.close(); previewAbort.current?.abort(); try { preview.current?.stop(); } catch {} if (previewContext.current?.state !== "closed") void previewContext.current?.close().catch(() => {}); previewContext.current = null; if (session.current) void fetch(`${base}?action=stop&id=${session.current}`, { method: "POST", keepalive: true }); }, []);
  useEffect(() => {
    if (!open) return;
    const prior = document.activeElement as HTMLElement;
    const scrollY = window.scrollY, scrollX = window.scrollX, oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.(".custom-dropdown-menu")) return;
      if (e.key === "Escape" && !dialog.current?.querySelector(".custom-dropdown.is-open")) { dialog.current?.querySelector<HTMLButtonElement>("[data-close]")?.click(); }
      if (e.key === "Tab") {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],audio[controls]") || []).filter(el=>el.getClientRects().length>0 && el.tabIndex!==-1 && el.getAttribute("aria-hidden")!=="true");
        if (!items?.length) return;
        if (e.shiftKey && (document.activeElement === items[0] || document.activeElement === dialog.current)) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener("keydown", key); return () => { document.removeEventListener("keydown", key); document.body.style.overflow = oldOverflow; prior?.focus({ preventScroll: true }); window.scrollTo(scrollX, scrollY); };
  }, [open]);
  const loadAgent = async (id:string) => {
    const version=++loadVersion.current;setSelectedAgentId(id);setConfig(undefined);setProfile(null);setLines([]);setTimings([]);hiddenTurns.current.clear();followChat.current=true;
    if(!id){setStatus("Create an agent before starting a test.");return;}
    setStatus("Loading agent configuration...");
    try{const r=await fetch(`${base}?agentId=${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(20000)}),d=await r.json();if(!r.ok)throw Error(d.error);if(loadVersion.current!==version)return;setConfig(d.config);setVoices(d.voices);setProfile(d.agent||null);setStatus("Ready");}
    catch(e){if(loadVersion.current===version)setStatus(e instanceof Error?e.message:"Unable to load agent");}
  };
  const show = async () => {setAudioError("");setOpen(true);setMobilePanel("configuration");await loadAgent(agentId||agents[0]?.id||initialAgentId||"");};
  const turn = async (audio?: Blob, message?: string, opening = false, recordingId?: string) => {
    if (!active.current || working.current) return;
    if (player.current?.hasAudio) interrupt();
    working.current = true; setBusy(true); setStatus(audio ? "Transcribing…" : "Thinking…");
    const stamp = generation.current, control = new AbortController(); abort.current = control; const turnId = recordingId || crypto.randomUUID();
    browserTurn.current = { started: performance.now(), firstPlayback: false, turnId: "" };
    try {
      await interruption.current; control.signal.throwIfAborted();
      let r: Response;
      for (let attempt = 0; ; attempt++) {
        r = await fetch(`${base}?action=turn&id=${session.current}&turnId=${turnId}`, { method: "POST", signal: control.signal, headers: { "Content-Type": audio ? "audio/wav" : "application/json" }, body: audio || JSON.stringify({ text: message, opening }) });
        if (r.status !== 409 || attempt >= 10) break;
        const rejection = await r.json(); if (rejection.code !== "BUSY") throw Error(rejection.error); await new Promise(resolve => setTimeout(resolve, 100)); control.signal.throwIfAborted();
      }
      if (!r.ok) throw Error((await r.json()).error); if (!r.body) throw Error("Missing response stream");
      const reader = r.body.getReader(), decoder = new TextDecoder(); let pending = "";
      const consume = async (line: string) => {
        if (!line.trim() || stamp !== generation.current) return; const event = JSON.parse(line);
        browserTurn.current.turnId = event.turnId || "";
        if (event.type === "timing") metric({ stage: event.stage, elapsedMs: event.elapsedMs, turnId: event.turnId });
        if (event.type === "error") throw Error(event.error);
        if (event.turnId !== turnId) return;
        if (!hiddenTurns.current.has(turnId) && event.type === "user" && event.final === true && event.source === (audio ? "stt" : "typed")) setLines(old => old.some(v => v.id === turnId && v.role === "Customer") ? old : [...old, { id: turnId, role: "Customer", text: event.text }]);
        if (!hiddenTurns.current.has(turnId) && event.type === "delta") setLines(old => old.some(v => v.id === turnId && v.role === "Agent")
          ? old.map(v => v.id === turnId && v.role === "Agent" ? { ...v, text: v.text + event.text } : v)
          : [...old, { id: turnId, role: "Agent", text: event.text }]);
        if (event.type === "pcm") {
          if (event.sampleRate !== 24000) throw Error("Unsupported PCM sample rate");
          if (!player.current) throw Error("Audio player is not initialized. Restart testing.");
          await player.current.push(event.data, stamp, control.signal);
        }
        if (event.type === "done") player.current?.end(stamp);
      };
      while (true) { const { value, done } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); let at; while ((at = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, at); pending = pending.slice(at + 1); await consume(line); } }
      await consume(pending + decoder.decode());
      if (stamp === generation.current) setStatus(player.current?.isPlaying ? "Speaking" : "Listening");
    } catch (e) { if (!control.signal.aborted && stamp === generation.current) { clearAudio(); control.abort(); stop(); setAudioError(e instanceof Error ? e.message : "Conversation failed"); setStatus("Error"); } }
    finally { if (abort.current === control) { working.current = false; setBusy(false); } }
  };
  const start = async () => {
    if (!config || !extractionReady  || recordFinalizing || active.current) return;
    stopPreview(); setAudioError(""); capture.current.reset();
    const startup = new AbortController(); startupAbort.current = startup;
    turnRef.current = turn;
    active.current = true; setRunning(true); setLines([]); setStatus("Connecting…"); mute.current = false; setMuted(false);
    try {
      const ctx = new AudioContext({ sampleRate: 16000 }); context.current = ctx; await ctx.resume();
      if (ctx.state !== "running") throw Error("Audio output is blocked. Allow audio and restart testing.");
      ctx.onstatechange = () => { if (active.current && ctx.state !== "running") { clearAudio(); setStatus("Audio paused"); setAudioError("Audio output is paused. Click Resume audio."); } };
      await ctx.audioWorklet.addModule("/shahvex-playback-worklet.js");
      if (!active.current || context.current !== ctx) return;
      player.current = new BrowserPCMPlayer(ctx, event => {
        if (!active.current || context.current !== ctx) return;
        if (event.type === "reference" && event.samples) { capture.current.playback(new Float32Array(event.samples)); return; }
        if (event.type === "playback-error") { setPlaying(false); setAudioError("Audio playback failed or no audible PCM was rendered. Check audio output and restart testing."); setStatus("Audio error"); clearAudio(); return; }
        if (event.type === "started") {
          setPlaying(true); setStatus("Speaking");
          if (!browserTurn.current.firstPlayback) {
            browserTurn.current.firstPlayback = true;
            metric({ stage: "browser-playback-started", elapsedMs: Math.round(performance.now() - browserTurn.current.started), turnId: browserTurn.current.turnId });
            console.info("[Shahvex playback render]", { contextTime: event.contextTime, outputTimestamp: ctx.getOutputTimestamp?.() });
          }
        }
        if (event.type === "idle") { setPlaying(false); setStatus(working.current ? "Processing" : "Listening"); }
        if (event.type === "overflow") { clearAudio(); setStatus("Playback buffer overflow. Please restart the session."); }
      });
      player.current.clear(generation.current);
      if (ctx.sampleRate !== 16000) throw Error("16 kHz microphone capture is required");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (!active.current || context.current !== ctx) { stream.getTracks().forEach(t => t.stop()); return; } mic.current = stream;
      await ctx.audioWorklet.addModule("/shahvex-microphone-worklet.js"); if (!active.current || context.current !== ctx) return;
      const r = await fetch(`${base}?action=start`, { method: "POST", signal: startup.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, config }) }); const data = await r.json(); if (!r.ok) throw Error(data.error);
      if (!active.current || context.current !== ctx) { void fetch(`${base}?action=stop&id=${data.id}`, { method: "POST" }); return; } session.current = data.id;
      const mixed=ctx.createMediaStreamDestination(); player.current.connectRecording(mixed);
      const source = ctx.createMediaStreamSource(stream), worklet = new AudioWorkletNode(ctx, "shahvex-microphone"), silent = ctx.createGain(); silent.gain.value = 0; const recordGain=ctx.createGain();micRecordGain.current=recordGain;source.connect(recordGain);recordGain.connect(mixed); beginRecording(mixed.stream); source.connect(worklet); worklet.connect(silent); silent.connect(ctx.destination);
      worklet.port.onmessage = event => {
        if (!active.current || context.current !== ctx) return;
        if (mute.current) { capture.current.reset(); setLevel(0); return; }
        const frame = new Int16Array(event.data), result = capture.current.feed(frame, Boolean(player.current?.hasAudio));
        setLevel(Math.min(1, result.rms / 5000));
        if (result.started) { if (working.current || player.current?.hasAudio) interrupt(true); setStatus("Listening"); }
        if (result.recording) {
          console.debug("[Shahvex microphone recording]", { turnId: result.recording.id, durationMs: result.recording.durationMs, vadSpeechMs: result.recording.voicedMs, state: "finalized" });
          void turnRef.current(result.recording.blob, undefined, false, result.recording.id);
        }
      };
      setMobilePanel("conversation"); setStatus("Listening"); if (config.first === "ai") void turnRef.current(undefined, undefined, true);
    } catch (e) { if (startup.signal.aborted) return; stop(); setAudioError(e instanceof Error ? e.message : "Unable to start microphone"); setStatus("Microphone Error"); }
  };
  const displayState = audioError ? "Audio error" : playing ? "Speaking" : running ? busy ? "Thinking" : muted ? "Ready" : "Listening" : "Ready";
  const microphoneState = audioError ? "Microphone Error" : playing ? "Agent Speaking" : running ? busy ? "Processing" : muted ? "Microphone Ready" : "Listening" : "Microphone Ready";
  const close = () => { loadVersion.current++; stopPreview(); stop(); setOpen(false); };
  const clearConversation = () => {if(active.current&&!window.confirm("Clear displayed messages? The active conversation and recording will continue."))return;for(const line of lines)hiddenTurns.current.add(line.id);if(browserTurn.current.turnId)hiddenTurns.current.add(browserTurn.current.turnId);setLines([]);followChat.current=true;if(!active.current)setStatus("Ready");};
  return <><button className="sv-voice-trigger admin-outline" type="button" aria-label={agents.length ? "Test Agent" : `Test agent ${agentName}`} onClick={() => void show()}><FiMic/>Test Agent</button>{open && createPortal(<div className="sv-voice-overlay sv-test-overlay"><div className="sv-voice-modal sv-agent-test" role="dialog" aria-modal="true" aria-labelledby="agent-test-title" tabIndex={-1} ref={dialog}>
    <header className="sv-test-header">
      <div className={`sv-test-avatar-wrap ${playing ? "is-speaking" : running && busy ? "is-thinking" : running ? "is-listening" : ""}`}><i className="sv-avatar-ripple"/><i className="sv-avatar-ripple"/><i className="sv-avatar-ripple"/><div className="sv-voice-avatar"><span>{(config?.name || agentName).slice(0, 1)}</span>{avatarUrl && <Image src={avatarUrl} alt="" width={58} height={58} unoptimized onError={e => { e.currentTarget.style.display = "none"; }}/>}</div></div>
      <div className="sv-test-identity"><h2 id="agent-test-title">{config?.name || agentName}</h2><p className={`sv-voice-subtitle sv-test-header-state ${playing ? "is-speaking" : ""}`}><span/>{displayState}</p></div>
      <button data-close className="sv-voice-close" aria-label="Close agent test" onClick={close}><FiX/></button>
    </header>
    <div className="sv-test-mobile-tabs" role="tablist" aria-label="Agent tester panels">{(["configuration","conversation"] as const).map(panel=><button key={panel} id={`sv-test-${panel}-tab`} type="button" role="tab" aria-selected={mobilePanel===panel} aria-controls={`sv-test-${panel}-panel`} onClick={()=>setMobilePanel(panel)} onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();const next=panel==="configuration"?"conversation":"configuration";setMobilePanel(next);dialog.current?.querySelector<HTMLButtonElement>(`#sv-test-${next}-tab`)?.focus();}}}>{panel==="configuration"?"Configuration":"Conversation"}</button>)}</div>
    <div className="sv-test-body">
      <section id="sv-test-configuration-panel" data-active={mobilePanel==="configuration"} className="sv-test-config" aria-label="Agent configuration">

        <div className="sv-test-config-scroll">
          {agents.length>0&&<label className="sv-test-agent-picker">Select Agent<CustomSelect aria-label="Select Agent" disabled={running||recordFinalizing} value={agentId} onChange={e=>void loadAgent(e.target.value)}>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</CustomSelect></label>}
          {config && <><fieldset disabled={running}><div className="sv-test-fields">
            <label className="sv-test-wide">Agent Script<textarea rows={9} maxLength={16000} placeholder="Paste the complete agent script: instructions, goals, tasks, business knowledge, FAQs and restrictions." value={config.script} onChange={e => setConfig({ ...config, script: e.target.value })}/></label>
            <section className="sv-extracted-details sv-test-wide" aria-label="Extracted Agent Details"><h4>Extracted Agent Details</h4><p>To update these details, edit the Agent Script.</p>
              {!extractionReady && <div>{extraction.status === "error" && extraction.script === config.script ? <p role="alert">{extraction.error}</p> : <AdminSkeleton rows={3} compact label="Extracting script details"/>}</div>}
              {extraction.status === "error" && <button type="button" onClick={() => setExtractionRetry(v => v + 1)}>Retry extraction</button>}
              {(Object.keys(detailLabels) as (keyof ScriptDetails)[]).map(key => <details key={key}><summary>{detailLabels[key]}<FiChevronDown/></summary><div>{extractionReady && extraction.details[key].length ? extraction.details[key].map((value, i) => <p key={i}>{value}</p>) : extractionReady ? <p>Not specified in script</p> : extraction.status === "error" ? <p>Details unavailable. Retry extraction.</p> : <AdminSkeleton rows={1} compact label={`Loading ${detailLabels[key]}`}/>}</div></details>)}
            </section>
            <label>Selected local voice<CustomSelect aria-label="Selected local voice" disabled={running} value={config.voice} onChange={e => { stopPreview(); setConfig({ ...config, voice: e.target.value }); }}>{voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.gender ? ` - ${v.gender}` : ""}</option>)}</CustomSelect></label>
            <div className="sv-test-preview"><button type="button" disabled={running || previewing} onClick={() => void previewVoice()}><FiVolume2/>{previewing ? "Playing preview..." : "Preview voice"}</button></div>
            <label>Who speaks first?<CustomSelect aria-label="Who speaks first?" disabled={running} value={config.first} onChange={e => setConfig({ ...config, first: e.target.value as "ai" | "customer" })}><option value="customer">Customer Speaks First</option><option value="ai">AI Speaks First</option></CustomSelect></label>
            <label>Conversation Style<CustomSelect aria-label="Conversation Style" disabled={running} value={config.style} onChange={e => setConfig({ ...config, style: e.target.value })}>{conversationStyles.map(style => <option key={style} value={style}>{style}</option>)}</CustomSelect></label>
          </div></fieldset><p className="sv-test-note">Settings apply to this session. Stop and restart to apply changes.</p></>}

          {!config && (status.startsWith("Loading") ? <AdminSkeleton rows={5} label="Loading agent configuration and voices"/> : <p role="alert">{status}</p>)}
        </div>

        {running&&<footer className="sv-test-config-actions sv-voice-controls"><button aria-pressed={muted} onClick={() => { mute.current = !mute.current; if(micRecordGain.current)micRecordGain.current.gain.value=mute.current?0:1; setMuted(mute.current); }}>{muted ? <FiMicOff/> : <FiMic/>}{muted ? "Unmute" : "Mute"}</button></footer>}
      </section>
      <section id="sv-test-conversation-panel" data-active={mobilePanel==="conversation"} className="sv-test-conversation" aria-label="Live conversation">
        <div className="sv-test-section-heading sv-test-chat-heading"><div><h3>Live conversation</h3><p>Speak naturally with your agent.</p></div><button aria-label="Clear conversation" title="Clear Conversation" onClick={clearConversation}><LuBrush/></button></div>
        <div className="sv-test-activity">{status.startsWith("Loading") ? <AdminSkeleton rows={1} compact label="Loading voice test status"/> : <span className={`sv-voice-status ${playing ? "is-speaking" : ""}`} role="status">{status}</span>}<div className="sv-voice-wave" aria-label={`Microphone level ${Math.round(level * 100)} percent`}>{Array.from({ length: 13 }, (_, i) => <i key={i} style={{ height: `${6 + level * 27 * (1 - Math.abs(i - 6) / 10)}px` }}/>)}</div><span className="sv-test-playback">{muted ? <FiMicOff/> : <FiMic/>}{microphoneState}</span></div>
        {audioError && <div className="sv-test-audio-error" role="alert">{audioError}<button type="button" onClick={async () => { try { if (!context.current) throw Error("Start testing to initialize audio."); await context.current.resume(); if (context.current.state !== "running") throw Error("Browser audio remains blocked."); setAudioError(""); } catch (e) { setAudioError(e instanceof Error ? e.message : "Unable to resume audio"); } }}>Resume audio</button></div>}
        <div className="sv-test-chat-scroll" ref={chat} role="log" aria-live="polite" aria-label="Conversation transcript" onScroll={() => { const el = chat.current; if (el) followChat.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {lines.length ? lines.map(v => <div className={`sv-test-message ${v.role === "Customer" ? "is-customer" : "is-agent"}`} key={`${v.id}:${v.role}`}><b>{v.role === "Agent" ? config?.name || agentName : v.role}</b><p>{v.text}</p></div>) : <div className="sv-test-empty"><div className="sv-empty-mic-icon"><FiMic/></div><h3>Your conversation starts here</h3><p>Start testing, then speak into your microphone. Use headphones for clearer interruption.</p></div>}
        </div>

      </section>
    </div>
    <section className="sv-test-recording" aria-label="Conversation recording"><div role="status">{recording&&<i className="sv-record-dot"/>}{recording?"Recording":recordFinalizing?"Finalizing recording...":recordURL?"Recording ready":"Browser-only recording"} <span>{Math.floor(recordSeconds/60)}:{String(recordSeconds%60).padStart(2,"0")}</span></div>{recordError&&<p role="alert">{recordError}</p>}{recordURL&&<><RecordingPlayer key={recordURL} src={recordURL} durationHint={recordSeconds}/><a className="sv-record-download" href={recordURL} download={`shahvex-${(recordedAgentName||agentName).replace(/[^a-z0-9_-]/gi,"-")}-${new Date().toISOString().slice(0,10)}.${recordExtension}`}><FiDownload/><span>Download recording<small>{recordExtension.toUpperCase()} audio</small></span></a></>}</section>
    <footer className="sv-test-footer">{running?<button className="sv-voice-stop" onClick={stop}><FiSquare/>End Session</button>:<button className="sv-voice-start" disabled={!config || !voices.some(v=>v.id===config?.voice) || !extractionReady || previewing || recordFinalizing} onClick={()=>void start()}><FiMic/>Start Test</button>}<span>Private test session | Use headphones | Speak, then pause</span><details><summary>Timing logs</summary><div>{timings.length ? timings.map((t, i) => <p key={i}>{t.stage}: {t.elapsedMs ?? 0} ms</p>) : <p>Timings appear when a response starts.</p>}</div></details></footer>
  </div></div>, document.body)}{!open&&recordURL&&<a className="sv-record-card-download" href={recordURL} download={`shahvex-${(recordedAgentName||agentName).replace(/[^a-z0-9_-]/gi,"-")}.${recordExtension}`}><FiDownload/>Download last recording</a>}</>;
}
