"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FiCheck, FiKey, FiMic, FiPhoneCall, FiRadio, FiRefreshCw, FiUsers, FiZap } from "react-icons/fi";
import "./bpo-voice-panel.css";

type Voice = { is_local?:boolean;id: string; name: string; gender: string; accent: string; status: "ACTIVE" | "INACTIVE"; telnyx_label: string | null; groq_label: string | null; assigned_at: string };
type Preferences = { auto_voice_id: string | null; manual_voice_id: string | null };
type Mode = "auto" | "manual" | "monitoring";

const copy = {
  auto: { eyebrow: "AUTO DIALING · ADMIN VOICES", title: "Choose an auto-dial voice", text: "Select one of the voice profiles assigned to your BPO workspace by the admin." },
  manual: { eyebrow: "MANUAL DIALING · ADMIN VOICES", title: "Choose a manual-dial voice", text: "Your selected voice is saved for manual dialing across this workspace." },
  monitoring: { eyebrow: "MONITORING · ADMIN VOICES", title: "Assigned voice agents", text: "Monitor the availability and AI provider setup of every voice assigned to you." },
};

export default function BpoVoicePanel({ mode }: { mode: Mode }) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({ auto_voice_id: null, manual_voice_id: null });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [voiceWarning, setVoiceWarning] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/bpo/voices", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load assigned voices.");
      setVoices(data.voices || []); setVoiceWarning(data.localVoiceError || ""); setPreferences(data.preferences || { auto_voice_id: null, manual_voice_id: null });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load assigned voices.");
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => voices.filter(voice => voice.status === "ACTIVE"), [voices]);
  const selectedId = mode === "auto" ? preferences.auto_voice_id : mode === "manual" ? preferences.manual_voice_id : null;

  const selectVoice = async (voice: Voice) => {
    if (mode === "monitoring") return;
    setBusyId(voice.id);
    try {
      const response = await fetch("/api/bpo/voices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, voiceId: voice.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to select voice.");
      setPreferences(current => ({ ...current, [mode === "auto" ? "auto_voice_id" : "manual_voice_id"]: voice.id }));
      toast.success(data.message);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to select voice."); }
    finally { setBusyId(""); }
  };

  if (loading) return <main className="bpo-main bpo-voice-page"><div className="bpo-voice-title-skeleton bpo-voice-shimmer" /><div className="bpo-voice-grid">{[1, 2, 3].map(item => <div className="bpo-voice-card-skeleton bpo-voice-shimmer" key={item} />)}</div></main>;

  return <main className="bpo-main bpo-voice-page">
    <div className="bpo-heading bpo-voice-heading"><div><p className="bpo-eyebrow">{copy[mode].eyebrow}</p><h1>{copy[mode].title}</h1><p>{copy[mode].text}</p></div><button onClick={() => void load()}><FiRefreshCw /> Refresh</button></div>

    {mode === "monitoring" && <div className="bpo-voice-kpis"><article><span><FiUsers /></span><div><small>Assigned voices</small><strong>{voices.length}</strong></div></article><article><span><FiRadio /></span><div><small>Active voices</small><strong>{active.length}</strong></div></article><article><span><FiPhoneCall /></span><div><small>VoIP ready</small><strong>{voices.filter(voice => voice.telnyx_label).length}</strong></div></article><article><span><FiKey /></span><div><small>Knowledge base ready</small><strong>{voices.filter(voice => voice.groq_label).length}</strong></div></article></div>}

    {voiceWarning && <p role="status">{voiceWarning}</p>}
    {error ? <section className="bpo-voice-empty"><FiMic /><h2>Voices unavailable</h2><p>{error}</p><button onClick={() => void load()}>Try again</button></section>
      : voices.length ? <section className="bpo-voice-grid">{voices.map(voice => {
        const selected = selectedId === voice.id;
        return <article className={`bpo-assigned-voice ${selected ? "selected" : ""} ${voice.status === "INACTIVE" ? "inactive" : ""}`} key={voice.id}>
          <header><span><FiMic /></span><div><h2>{voice.name}</h2><p>{voice.gender.charAt(0) + voice.gender.slice(1).toLowerCase()} · {voice.accent}</p></div><em>{voice.status === "ACTIVE" ? "Ready" : "Inactive"}</em></header>
          <div className="bpo-assigned-providers"><span><FiPhoneCall /><div><small>VoIP</small><b>{voice.is_local ? "Agent calling connection" : voice.telnyx_label || "Not configured"}</b></div></span><span><FiKey /><div><small>Knowledge base</small><b>{voice.is_local ? "Agent campaign script" : voice.groq_label || "Not configured"}</b></div></span></div>
          {mode === "monitoring" ? <footer><span><i /> {voice.status === "ACTIVE" ? "Available for dialing" : "Disabled by admin"}</span><small>{voice.is_local ? "Shared voice" : `Assigned ${new Date(voice.assigned_at).toLocaleDateString()}`}</small></footer>
            : <button className={selected ? "selected" : ""} disabled={voice.is_local || voice.status !== "ACTIVE" || busyId === voice.id} onClick={() => void selectVoice(voice)}>{voice.is_local ? "Choose in agent settings" : busyId === voice.id ? "Saving…" : selected ? <><FiCheck /> Selected for {mode} dialing</> : <><FiZap /> Use for {mode} dialing</>}</button>}
        </article>;
      })}</section>
      : <section className="bpo-voice-empty"><FiMic /><h2>No admin voice assigned</h2><p>Ask your administrator to create and assign a VoIP or Knowledge base voice profile to your BPO account.</p></section>}
  </main>;
}
