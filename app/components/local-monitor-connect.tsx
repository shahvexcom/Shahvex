"use client";
import { useEffect, useState } from "react";
import { localTestVoices, isLocalTestVoice } from "../../gateway/local-test-voices.cjs";

export function LocalMonitorConnect({ portal }: { portal: "admin" | "bpo" }) {
  const [form, setForm] = useState({ url: "http://127.0.0.1:8792", secret: "", name: "Lissa", voice: "lissa", first: "ai" });
  const [savedSecret, setSavedSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const endpoint = `/api/${portal}/live-monitor/local`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) })
      .then(async response => { const data = await response.json(); if (response.ok && data.connected && !controller.signal.aborted) {
        setSavedSecret(true);
        setForm(current => ({ ...current, url: data.url,
          name: data.agent.name,
          voice: data.agent.voice, first: data.agent.first }));
      } }).catch(() => {});
    return () => controller.abort();
  }, [endpoint]);
  async function connect() {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, secret: form.secret || undefined }), signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Local connection failed.");
      setSavedSecret(true); setForm(current => ({ ...current, secret: "", name: data.agent.name, voice: data.agent.voice, first: data.agent.first })); setMessage(data.message);
    } catch (err) { setError(err instanceof Error ? err.message : "Local connection failed."); }
    finally { setBusy(false); }
  }
  return <details open>
    <summary>Localhost connection</summary>
    <form onSubmit={event => { event.preventDefault(); void connect(); }}>
      <p>Connect to the local Asterisk test bridge running on the same machine as this website.</p>
      <fieldset disabled={busy} className="local-monitor-fields">
        <label>Local bridge URL<input type="url" required value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} placeholder="http://127.0.0.1:8792" /></label>
        <label>Bridge shared secret<input type="password" autoComplete="new-password" required={!savedSecret} minLength={32} maxLength={2000}
          value={form.secret} onChange={event => setForm({ ...form, secret: event.target.value })} placeholder={savedSecret ? "Leave blank to keep saved secret" : "Local bridge secret"} /></label>
        <label>Agent name<input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Call voice<select required value={form.voice} onChange={event => {
          const voice = localTestVoices.find(item => item.id === event.target.value)!;
          const previous = localTestVoices.find(item => item.id === form.voice);
          setForm({ ...form, voice: voice.id, name: form.name === previous?.name ? voice.name : form.name });
        }}>
          {!isLocalTestVoice(form.voice) && <option disabled value={form.voice}>Previous voice: {form.voice} — choose a voice</option>}
          {localTestVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
        </select></label>
        <label>Who speaks first?<select value={form.first} onChange={event => setForm({ ...form, first: event.target.value })}><option value="ai">Agent</option><option value="customer">Customer</option></select></label>
      </fieldset>
      <button disabled={busy}>{busy ? "Connecting…" : "Connect localhost"}</button>
      <p>Choose Lissa, Emma or Olivia, then click Connect localhost to apply it to the next incoming test call. Dial your configured Asterisk extension. Finish an active call before changing the voice or script.</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
