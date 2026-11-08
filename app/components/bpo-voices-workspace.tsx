"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FiCheck, FiKey, FiMic, FiPhoneCall, FiRefreshCw, FiUsers } from "react-icons/fi";
import "./bpo-voice-panel.css";
import "./bpo-voices-workspace.css";

type Voice = { id: string; name: string; gender: string; accent: string; status: "ACTIVE" | "INACTIVE"; is_active: boolean; telnyx_label: string | null; groq_label: string | null; assigned_at: string };

export default function BpoVoicesWorkspace() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/bpo/voices", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load assigned voices.");
      setVoices(Array.isArray(data.voices) ? data.voices : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load assigned voices.");
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const activeVoices = useMemo(() => voices.filter(voice => voice.status === "ACTIVE" && voice.is_active), [voices]);
  const setVoiceActivity = async (voice: Voice) => {
    const isActive = !voice.is_active;
    setBusy(voice.id);
    try {
      const response = await fetch("/api/bpo/voices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voiceId: voice.id, isActive }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to update voice.");
      setVoices(current => current.map(item => item.id === voice.id ? { ...item, is_active: isActive } : item));
      toast.success(data.message || "Voice updated.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to update voice.");
    } finally { setBusy(""); }
  };

  if (loading) return <main className="bpo-main bpo-voice-page bpo-voices-page"><div className="bpo-voice-title-skeleton bpo-voice-shimmer" /><div className="bpo-voice-kpis bpo-voice-kpi-skeletons">{[1, 2, 3, 4].map(item => <article className="bpo-voice-shimmer" key={item} />)}</div><div className="bpo-voice-grid">{[1, 2, 3].map(item => <div className="bpo-voice-card-skeleton bpo-voice-shimmer" key={item} />)}</div></main>;

  return <main className="bpo-main bpo-voice-page bpo-voices-page">
    <div className="bpo-heading bpo-voice-heading"><div><p className="bpo-eyebrow">CONTROLLER-ASSIGNED VOICES</p><h1>AI voices</h1><p>Activate a controller-assigned voice here before using it in a new calling agent.</p></div><button onClick={() => void load()}><FiRefreshCw /> Refresh</button></div>

    <div className="bpo-voice-kpis"><VoiceKpi icon={<FiUsers />} label="Assigned voices" value={voices.length} /><VoiceKpi icon={<FiMic />} label="Active voices" value={activeVoices.length} /><VoiceKpi icon={<FiPhoneCall />} label="VoIP ready" value={voices.filter(voice => voice.telnyx_label).length} /><VoiceKpi icon={<FiKey />} label="Knowledge base ready" value={voices.filter(voice => voice.groq_label).length} /></div>

    {error ? <section className="bpo-voice-empty"><FiMic /><h2>Voices unavailable</h2><p>{error}</p><button onClick={() => void load()}>Try again</button></section>
      : voices.length ? <section className="bpo-voice-grid">{voices.map(voice => {
        const active = voice.status === "ACTIVE" && voice.is_active;
        return <article className={`bpo-assigned-voice ${active ? "selected" : ""} ${voice.status === "INACTIVE" ? "inactive" : ""}`} key={voice.id}>
          <header><span><FiMic /></span><div><h2>{voice.name}</h2><p>{voice.gender.charAt(0) + voice.gender.slice(1).toLowerCase()} · {voice.accent}</p></div><em>{active ? "Active" : voice.status === "ACTIVE" ? "Inactive" : "Disabled"}</em></header>
          <div className="bpo-assigned-providers"><span><FiPhoneCall /><div><small>VoIP</small><b>{voice.telnyx_label || "Not configured"}</b></div></span><span><FiKey /><div><small>Knowledge base</small><b>{voice.groq_label || "Not configured"}</b></div></span></div>
          <div className="bpo-voice-actions"><button className={active ? "selected" : ""} disabled={voice.status !== "ACTIVE" || busy === voice.id} onClick={() => void setVoiceActivity(voice)}>{busy === voice.id ? "Saving..." : active ? <><FiCheck /> Active voice</> : <><FiMic /> Set as active voice</>}</button></div>
        </article>;
      })}</section>
        : <section className="bpo-voice-empty"><FiMic /><h2>No AI voices assigned</h2><p>Ask the controller to create and assign a VoIP or Knowledge base voice profile to your BPO workspace.</p></section>}
  </main>;
}

function VoiceKpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <article><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;
}
