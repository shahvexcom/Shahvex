"use client";
import { useCurrency } from "./currency-provider";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiActivity, FiClock, FiDownload, FiMic, FiMicOff, FiPause, FiPhone, FiPhoneCall, FiPhoneOff, FiPlay, FiRefreshCw, FiRadio, FiVolume2, FiVolumeX, FiWifi, FiWifiOff } from "react-icons/fi";
import "./bpo-quick-dial.css";

type CallRecord = { id: string; status: string; lead_number: string; duration_seconds: number; charged_credits: number; answered_at: string | null; recording_url: string; recording_active: boolean; created_at: string; downloadable: boolean };
type Dashboard = { metrics: { dials_today?: number; connected_today?: number; talk_seconds_today?: number; recordings_today?: number }; recordings: CallRecord[]; billing: { balance: number; minutePrice: number; recordingPrice: number } };
type SoftphoneCall = {
  id?: string; state?: string; localStream?: MediaStream; remoteStream?: MediaStream;
  telnyxIDs?: { telnyxCallControlId?: string; telnyxSessionId?: string };
  cause?: string; causeCode?: string | number; sipCode?: string | number; sipReason?: string;
  hangup: () => void; hold?: () => void | Promise<void>; unhold?: () => void | Promise<void>;
  muteAudio?: () => void; unmuteAudio?: () => void;
};
type SoftphoneClient = { connect: () => void; disconnect: () => void | Promise<void>; newCall: (options: { destinationNumber: string; callerNumber: string; remoteElement: string }) => SoftphoneCall; on: (event: string, listener: (value?: unknown) => void) => SoftphoneClient };

const blankDashboard: Dashboard = { metrics: {}, recordings: [], billing: { balance: 0, minutePrice: 0, recordingPrice: 0 } };
const remoteAudioElementId = "quick-dial-remote-audio";
const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0"];
const stateLabel: Record<string, string> = { offline: "Phone offline", connecting: "Connecting phone", ready: "Ready to call", initiating: "Starting call", ringing: "Calling…", active: "Live call", ended: "Call ended" };
const fmtTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0")}:${(Math.max(0, seconds) % 60).toString().padStart(2, "0")}`;
const fmtTalk = (seconds: number) => seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

function normalizeNumber(value: string) {
  const stripped = value.replace(/[^\d+]/g, "");
  const e164 = stripped.startsWith("00") ? `+${stripped.slice(2)}` : stripped;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : "";
}

function sdkErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const item = value as { message?: unknown; detail?: unknown; cause?: unknown; error?: unknown };
    for (const candidate of [item.message, item.detail, item.cause, item.error]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
      if (candidate && typeof candidate === "object" && candidate !== value) {
        const nested: string = sdkErrorMessage(candidate, "");
        if (nested) return nested;
      }
    }
  }
  return fallback;
}

type QuickDialProps = {
  endpoint?: string;
  adminMode?: boolean;
};

export default function BpoQuickDial({ endpoint = "/api/bpo/quick-dial", adminMode = false }: QuickDialProps = {}) {
  const { formatMoney } = useCurrency();
  const [dashboard, setDashboard] = useState<Dashboard>(blankDashboard), [loading, setLoading] = useState(true);
  const [number, setNumber] = useState(""), [phoneState, setPhoneState] = useState<keyof typeof stateLabel>("offline"), [recording, setRecording] = useState(false), [recordingPaused, setRecordingPaused] = useState(false), [onHold, setOnHold] = useState(false), [muted, setMuted] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [localRecordingUrl, setLocalRecordingUrl] = useState("");
  const remoteAudioRef = useRef<HTMLAudioElement>(null), clientRef = useRef<SoftphoneClient | null>(null), callRef = useRef<SoftphoneCall | null>(null), recordIdRef = useRef("");
  const callerNumberRef = useRef("");
  const recorderRef = useRef<MediaRecorder | null>(null), chunksRef = useRef<BlobPart[]>([]), audioContextRef = useRef<AudioContext | null>(null), sourceNodesRef = useRef<MediaStreamAudioSourceNode[]>([]), uploadStartedRef = useRef(false), finalizedRef = useRef(false), callAnsweredRef = useRef(false), localUrlRef = useRef(""), callLimitTimerRef = useRef<number | undefined>(undefined), heartbeatTimerRef = useRef<number | undefined>(undefined);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load Quick Dial data.");
      setDashboard({ metrics: data.metrics || {}, recordings: Array.isArray(data.recordings) ? data.recordings : [], billing: { balance: Number(data.billing?.balance || 0), minutePrice: Number(data.billing?.minutePrice || 0), recordingPrice: Number(data.billing?.recordingPrice || 0) } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Quick Dial data."); }
    finally { if (showLoading) setLoading(false); }
  }, [endpoint]);

  // The request starts after mount; the interval keeps the live dashboard fresh.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(true); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    if (callLimitTimerRef.current) window.clearTimeout(callLimitTimerRef.current);
    if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    const callId = recordIdRef.current;
    if (callId && !finalizedRef.current) {
      const body = JSON.stringify({ action: "end-call", callId, connected: callAnsweredRef.current });
      const sent = navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }));
      if (!sent) void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    }
    try { recorderRef.current?.stop(); } catch { /* recorder is already stopped */ }
    try { callRef.current?.hangup(); } catch { /* call is already closed */ }
    void clientRef.current?.disconnect();
  }, [endpoint]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Quick Dial request failed.");
    return data;
  }, [endpoint]);

  const cleanRecorderGraph = () => {
    sourceNodesRef.current.forEach(node => node.disconnect());
    sourceNodesRef.current = [];
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    recorderRef.current = null;
  };

  const uploadRecording = useCallback(async (callId: string, mime: string) => {
    if (uploadStartedRef.current || !chunksRef.current.length) return;
    uploadStartedRef.current = true;
    const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
    if (!blob.size) return;
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const localUrl = URL.createObjectURL(blob);
    localUrlRef.current = localUrl;
    setLocalRecordingUrl(localUrl);
    try {
      const form = new FormData(); form.set("callId", callId); form.set("recording", new File([blob], `quick-dial-${callId.slice(0, 8)}.webm`, { type: blob.type || "audio/webm" }));
      const response = await fetch(endpoint, { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Recording could not be saved.");
      setMessage("Call ended. Recording is ready to download.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recording could not be saved."); }
  }, [endpoint, load]);

  const startAutomaticRecording = useCallback(async () => {
    const call = callRef.current, callId = recordIdRef.current;
    if (!call || !callId || recorderRef.current || typeof MediaRecorder === "undefined") return;
    try {
      const streams = [call.localStream, call.remoteStream].filter((stream): stream is MediaStream => Boolean(stream && stream.getAudioTracks().length));
      if (!streams.length) throw new Error("Call audio is not ready yet.");
      const context = new AudioContext(), destination = context.createMediaStreamDestination();
      audioContextRef.current = context;
      sourceNodesRef.current = streams.map(stream => { const source = context.createMediaStreamSource(stream); source.connect(destination); return source; });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(candidate => MediaRecorder.isTypeSupported(candidate)) || "";
      chunksRef.current = []; uploadStartedRef.current = false;
      const recorder = new MediaRecorder(destination.stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { cleanRecorderGraph(); setRecording(false); setRecordingPaused(false); void post({ action: "recording-state", callId, active: false }).catch(() => undefined); void uploadRecording(callId, recorder.mimeType || mime); };
      recorder.start(1000); recorderRef.current = recorder;
      setRecording(true); setRecordingPaused(false);
      await post({ action: "recording-state", callId, active: true });
    } catch (cause) {
      cleanRecorderGraph();
      setError(cause instanceof Error ? `Automatic recording could not start: ${cause.message}` : "Automatic recording could not start.");
    }
  }, [post, uploadRecording]);

  const finalizeCall = useCallback(async (status: "COMPLETED" | "FAILED", failureReason = "") => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const callId = recordIdRef.current, call = callRef.current;
    if (callId) {
      const ids = call?.telnyxIDs || {};
      try {
        await post({ action: "update-call", callId, status, controlId: ids.telnyxCallControlId || "", sessionId: ids.telnyxSessionId || "", failureReason, connected: callAnsweredRef.current });
      } catch {
        try { await post({ action: "end-call", callId }); }
        catch { setError("The call ended locally, but its server status could not be confirmed. Refresh Quick Dial before placing another call."); }
      }
    }
    try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); else setRecording(false); } catch { setRecording(false); }
    if (callLimitTimerRef.current) window.clearTimeout(callLimitTimerRef.current);
    callLimitTimerRef.current = undefined;
    if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = undefined;
    callRef.current = null; recordIdRef.current = "";
    callAnsweredRef.current = false;
    setOnHold(false); setMuted(false);
    setPhoneState("ready");
    void load();
  }, [load, post]);

  const connectPhone = async () => {
    if (clientRef.current) { setPhoneState("ready"); return; }
    setBusy(true); setError(""); setMessage(""); setPhoneState("connecting");
    try {
      const access = await post({ action: "access-token" }) as { token: string; callerNumber: string; retryAfterMs?: number };
      callerNumberRef.current = access.callerNumber;
      if (access.retryAfterMs) await new Promise(resolve => window.setTimeout(resolve, access.retryAfterMs));
      const telnyxModule = await import("@telnyx/webrtc");
      const client = new telnyxModule.TelnyxRTC({ login_token: access.token }) as unknown as SoftphoneClient;
      client.on("telnyx.ready", () => { setPhoneState("ready"); setBusy(false); setMessage("Softphone connected. Enter a number and press Call."); })
        .on("telnyx.error", event => {
          const payload = event as { message?: unknown; code?: unknown; error?: { message?: unknown; detail?: unknown; code?: unknown } } | undefined;
          const detail = sdkErrorMessage(payload?.error || event, "The softphone could not connect.");
          const code = payload?.error?.code || payload?.code;
          const reason = code ? `${detail} (Telnyx code: ${String(code)})` : detail;
          const dialingCall = Boolean(recordIdRef.current && !finalizedRef.current);
          setError(reason); setBusy(false);
          if (dialingCall) void finalizeCall("FAILED", reason);
          else { setPhoneState("offline"); clientRef.current = null; }
        })
        .on("telnyx.notification", event => {
          const notification = event as { type?: string; call?: SoftphoneCall } | undefined, call = notification?.call;
          if (finalizedRef.current || !call || !callRef.current || (call.id && callRef.current.id && call.id !== callRef.current.id)) return;
          callRef.current = call;
          const state = String(call.state || "").toLowerCase(), ids = call.telnyxIDs || {}, callId = recordIdRef.current;
          if (state === "active") {
            callAnsweredRef.current = true;
            setOnHold(false);
            setPhoneState("active");
            if (callId) void post({ action: "update-call", callId, status: "ANSWERED", controlId: ids.telnyxCallControlId || "", sessionId: ids.telnyxSessionId || "" }).catch(() => undefined);
            window.setTimeout(() => void startAutomaticRecording(), 250);
          } else if (["trying", "requesting", "ringing", "early", "answering"].includes(state)) {
            setPhoneState("ringing");
            if (callId) void post({ action: "update-call", callId, status: "RINGING", controlId: ids.telnyxCallControlId || "", sessionId: ids.telnyxSessionId || "" }).catch(() => undefined);
          } else if (["held", "hold"].includes(state)) {
            setOnHold(true); setPhoneState("active");
          } else if (["hangup", "destroy", "purge"].includes(state)) {
            const ended = call as SoftphoneCall;
            const reason = [ended.cause, ended.causeCode ? `code ${ended.causeCode}` : "", ended.sipCode ? `SIP ${ended.sipCode}` : "", ended.sipReason].filter(Boolean).join(" · ");
            const status = callAnsweredRef.current ? "COMPLETED" : "FAILED";
            if (!callAnsweredRef.current && reason) setError(`Customer call was not connected: ${reason}`);
            void finalizeCall(status, reason);
          }
        });
      clientRef.current = client;
      client.connect();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect the softphone."); setPhoneState("offline"); setBusy(false); }
  };

  const dial = async () => {
    const destination = normalizeNumber(number);
    if (!destination) { setError("Enter a full phone number with country code, for example +14155550123."); return; }
    if (!clientRef.current || phoneState !== "ready") { setError("Connect the softphone before placing a call."); return; }
    setBusy(true); setError(""); setMessage(""); setPhoneState("initiating"); finalizedRef.current = false; callAnsweredRef.current = false;
    setOnHold(false); setMuted(false);
    try {
      const reservation = await post({ action: "begin-call", number: destination }) as { callId: string; maxCallDurationSeconds?: number };
      recordIdRef.current = reservation.callId;
      const client = clientRef.current;
      // Use the element id in call options. The Telnyx client-level setter
      // eagerly resolves an id into an HTMLAudioElement, which then leaks into
      // JSON-RPC and creates a circular React-fiber serialization error.
      const call = client.newCall({ destinationNumber: destination, callerNumber: callerNumberRef.current, remoteElement: remoteAudioElementId });
      callRef.current = call;
      const ids = call.telnyxIDs || {};
      await post({ action: "update-call", callId: reservation.callId, status: "INITIATED", controlId: ids.telnyxCallControlId || "", sessionId: ids.telnyxSessionId || "" }).catch(() => undefined);
      heartbeatTimerRef.current = window.setInterval(() => {
        const callId = recordIdRef.current;
        if (callId && !finalizedRef.current) void post({ action: "heartbeat", callId }).catch(() => undefined);
      }, 15_000);
      if (reservation.maxCallDurationSeconds) callLimitTimerRef.current = window.setTimeout(() => {
        setMessage(adminMode ? "The maximum Quick Dial duration was reached, so this call has ended." : "Quick Dial credit time reached, so this call has ended.");
        try { callRef.current?.hangup(); } catch { /* The provider can already be ending the call. */ }
        void finalizeCall("COMPLETED");
      }, reservation.maxCallDurationSeconds * 1000);
      setPhoneState("ringing");
    } catch (cause) {
      const callId = recordIdRef.current;
      if (callId) void post({ action: "update-call", callId, status: "FAILED", failureReason: cause instanceof Error ? cause.message : "Browser call could not start." }).catch(() => undefined);
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = undefined; recordIdRef.current = ""; callRef.current = null; setPhoneState("ready");
      setError(cause instanceof Error ? cause.message : "Unable to start the call.");
    } finally { setBusy(false); }
  };

  const hangup = async () => {
    const callId = recordIdRef.current;
    setBusy(true);
    try { if (callId) await post({ action: "end-call", callId, connected: callAnsweredRef.current }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The server could not confirm the call end."); }
    try { callRef.current?.hangup(); } catch { /* The provider can already be ending the call. */ }
    await finalizeCall("COMPLETED");
    setBusy(false);
  };
  const toggleHold = async () => {
    const call = callRef.current;
    if (!call || phoneState !== "active") return;
    setBusy(true); setError("");
    try {
      if (onHold) {
        if (!call.unhold) throw new Error("Hold is not available for this browser call.");
        await call.unhold(); setOnHold(false); setMessage("Call resumed.");
      } else {
        if (!call.hold) throw new Error("Hold is not available for this browser call.");
        await call.hold(); setOnHold(true); setMessage("Call is on hold.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change the hold state."); }
    finally { setBusy(false); }
  };
  const toggleMute = () => {
    const call = callRef.current;
    if (!call || phoneState !== "active") return;
    try {
      if (muted) {
        if (!call.unmuteAudio) throw new Error("Mute is not available for this browser call.");
        call.unmuteAudio(); setMuted(false); setMessage("Microphone unmuted.");
      } else {
        if (!call.muteAudio) throw new Error("Mute is not available for this browser call.");
        call.muteAudio(); setMuted(true); setMessage("Microphone muted.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change microphone mute."); }
  };
  const toggleRecording = async () => {
    const recorder = recorderRef.current, callId = recordIdRef.current;
    if (!callId) return;
    if (!recorder) { await startAutomaticRecording(); return; }
    if (recorder.state === "recording") { recorder.pause(); setRecordingPaused(true); setRecording(false); await post({ action: "recording-state", callId, active: false }).catch(() => undefined); }
    else if (recorder.state === "paused") { recorder.resume(); setRecordingPaused(false); setRecording(true); await post({ action: "recording-state", callId, active: true }).catch(() => undefined); }
  };
  const addKey = (key: string) => {
    if (phoneState === "active") {
      if (key !== "+") try { (callRef.current as SoftphoneCall & { dtmf?: (value: string) => void })?.dtmf?.(key); } catch { /* The provider can already be ending the call. */ }
      return;
    }
    if (key === "+") { setNumber(current => current ? current : "+"); return; }
    setNumber(current => {
      if (!current.startsWith("+")) return current;
      return current.replace(/\D/g, "").length < 15 ? `${current}${key}` : current;
    });
  };
  const live = ["initiating", "ringing", "active"].includes(phoneState);
  const metrics = dashboard.metrics;
  const recordingApiBase = adminMode ? "/api/admin/calls" : "/api/bpo/calls";
  const cards = [
    { icon: <FiPhoneCall />, label: "Dials today", value: metrics.dials_today || 0, tone: "purple" },
    { icon: <FiActivity />, label: "Connected", value: metrics.connected_today || 0, tone: "green" },
    { icon: <FiClock />, label: "Talk time", value: fmtTalk(Number(metrics.talk_seconds_today || 0)), tone: "blue" },
    { icon: <FiRadio />, label: "Recordings ready", value: metrics.recordings_today || 0, tone: "orange" },
  ];

  return <main className={`quick-dial-page ${adminMode ? "admin-quick-dial-page" : ""}`}>
    <audio id={remoteAudioElementId} ref={remoteAudioRef} autoPlay playsInline />
    <header className="quick-dial-heading"><div><p className="bpo-eyebrow">DIRECT CALLING · LIVE VOICE</p><h1>Quick Dial</h1><p>{adminMode ? "Enter a customer number and speak directly from the controller—no calling agent is used." : "Call any number from your browser, speak directly with the customer, and keep a downloadable recording of each call."}</p></div><button type="button" onClick={() => void load(true)} disabled={loading}><FiRefreshCw /> Refresh</button></header>
    <section className="quick-dial-kpis" aria-label="Quick Dial live metrics">{cards.map(card => <article key={card.label}><span className={card.tone}>{card.icon}</span><div><small>{card.label}</small><strong>{card.value}</strong></div></article>)}</section>
    {!adminMode && <p className="quick-dial-billing"><b>Quick Dial billing:</b> {formatMoney(dashboard.billing.minutePrice)} per minute + {formatMoney(dashboard.billing.recordingPrice)} per recording. Available balance: {formatMoney(dashboard.billing.balance)}. Plan call and minute allowances are not used here.</p>}
    {message && <p className="quick-dial-message success">{message}</p>}{error && <p className="quick-dial-message error">{error}</p>}
    <section className="quick-dial-console">
      <div className="quick-dial-console-head"><div><span className={`quick-dial-presence ${phoneState}`}><i /> {stateLabel[phoneState]}</span><h2>Browser softphone</h2><p>Your microphone connects only after you choose <b>Connect phone</b>. Recording begins automatically when the customer answers.</p></div>{phoneState === "offline" ? <button type="button" className="quick-connect" disabled={busy} onClick={() => void connectPhone()}>{busy ? <FiRadio /> : <FiWifi />} {busy ? "Connecting…" : "Connect phone"}</button> : <button type="button" className="quick-connected" disabled>{live ? <FiRadio /> : <FiWifi />} {live ? "Live" : "Connected"}</button>}</div>
      <div className="quick-dial-body">
        <div className="quick-dial-pad">
          <div className="quick-number-screen">
            <span>{live ? stateLabel[phoneState] : "Destination number"}</span><output>{number || "+"}</output><small>Use the keypad: press +, then country code and number.</small>
            <button type="button" aria-label="Delete last digit" disabled={!number || live} onClick={() => setNumber(current => current.slice(0, -1))}>⌫</button>
          </div>
          <div className="quick-keypad">{digits.map(key => <button type="button" key={key} disabled={(live && (phoneState !== "active" || key === "+")) || (!live && key === "+" && number.startsWith("+"))} onClick={() => addKey(key)}><b>{key}</b>{/[2-9]/.test(key) && <small>{({ 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ" } as Record<string, string>)[key]}</small>}</button>)}</div>
          <div className="quick-call-actions">
            {live ? <>
              <button type="button" className="quick-hangup" disabled={busy} onClick={() => void hangup()}><FiPhoneOff /> End call</button>
              <button type="button" className={`quick-hold-button ${onHold ? "active" : ""}`} disabled={phoneState !== "active" || busy} onClick={() => void toggleHold()}>{onHold ? <FiPlay /> : <FiPause />} {onHold ? "Resume" : "Hold"}</button>
              <button type="button" className={`quick-mute-button ${muted ? "active" : ""}`} disabled={phoneState !== "active"} onClick={toggleMute}>{muted ? <FiVolumeX /> : <FiVolume2 />} {muted ? "Unmute" : "Mute"}</button>
            </> : <button type="button" className="quick-dial-button" disabled={phoneState !== "ready" || busy} onClick={() => void dial()}><FiPhoneCall /> {busy ? "Starting…" : "Call"}</button>}
            <button type="button" className={`quick-record-button ${recording ? "recording" : ""} ${recordingPaused ? "paused" : ""}`} disabled={phoneState !== "active"} onClick={() => void toggleRecording()}>{recording ? <FiMic /> : <FiMicOff />} {recording ? "Stop recording" : recordingPaused ? "Resume recording" : "Start recording"}</button>
          </div>
        </div>
        <aside className="quick-dial-status"><span className="quick-status-icon">{phoneState === "offline" ? <FiWifiOff /> : live ? <FiRadio /> : <FiPhone />}</span><h3>{live ? "Conversation in progress" : phoneState === "ready" ? "Ready when you are" : "Connect to start"}</h3><p>{live ? "Use headphones for the best audio. The red recording control lets you pause and resume recording during the call." : phoneState === "ready" ? "Enter a country-code phone number on the keypad, then press Call." : "Quick Dial uses your Telnyx browser connection; your Telnyx API key remains on the server."}</p><dl><div><dt>Microphone</dt><dd>{phoneState === "offline" ? "Not connected" : live ? "In use" : "Ready"}</dd></div><div><dt>Recording</dt><dd>{recording ? "Recording" : recordingPaused ? "Paused" : live ? "Auto start on answer" : "Standby"}</dd></div><div><dt>Download</dt><dd>{localRecordingUrl ? <a href={localRecordingUrl} download="quick-dial-recording.webm"><FiDownload /> This call</a> : "After call ends"}</dd></div></dl><small className="quick-consent">Make sure the other party is notified or has consented where recording laws require it.</small></aside>
      </div>
    </section>
    <section className="quick-recordings">
      <header><div><p className="bpo-eyebrow">RECENT ACTIVITY</p><h2>Quick Dial history</h2><p>Only calls the customer answered have talk time and a charge. Unanswered calls always show 00:00 and {formatMoney(0)}.</p></div><span>{dashboard.recordings.length} calls</span></header>
      {loading ? <div className="quick-recording-loading">Loading live Quick Dial data…</div> : dashboard.recordings.length ? <div className="quick-recording-list">{dashboard.recordings.map(call => <article key={call.id}>
        <div><strong>{call.lead_number}</strong><small>{new Date(call.created_at).toLocaleString()} · Call time: {fmtTime(Number(call.duration_seconds || 0))} · Charge: {formatMoney(call.charged_credits || 0)}</small></div>
        <em className={call.answered_at ? call.status.toLowerCase() : "not-connected"}>{call.answered_at ? call.status === "ANSWERED" ? "LIVE" : call.status : "NOT CONNECTED"}</em>
        {call.downloadable ? <div className="quick-recording-actions"><audio controls preload="metadata" src={`${recordingApiBase}/${call.id}/recording?inline=1`} aria-label={`Recording for ${call.lead_number}`} /><a href={`${recordingApiBase}/${call.id}/recording`} data-tooltip="Download recording"><FiDownload /> Download</a></div> : <span className="quick-recording-pending">{call.recording_active ? "Recording…" : "No recording"}</span>}
      </article>)}</div> : <div className="quick-recording-empty"><FiPhone /><h3>No Quick Dial calls yet</h3><p>Your one-to-one calls and their recordings will appear here.</p></div>}
    </section>
  </main>;
}
