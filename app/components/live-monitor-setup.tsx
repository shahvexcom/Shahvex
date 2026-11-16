"use client";

import { useEffect, useState } from "react";
import { LocalMonitorConnect } from "./local-monitor-connect";

export function LiveMonitorSetup({ portal }: { portal: "admin" | "bpo" }) {
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const endpoint = `/api/${portal}/live-monitor/settings`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Unable to load settings.");
        if (!controller.signal.aborted) setScript(data.initialScript);
      }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, retry]);
  async function save() {
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialScript: script }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Unable to save script.");
      setScript(data.initialScript); setMessage(data.message);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save script."); }
    finally { setSaving(false); }
  }
  return <section className="monitor-setup" aria-label="Monitor setup">
    <details>
      <summary>Initial script · Edit and save</summary>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <p>Save the initial script for your localhost agent here.</p>
        <label htmlFor="monitor-initial-script">Default initial script</label>
        <textarea id="monitor-initial-script" rows={8} minLength={10} maxLength={16000} required
          disabled={loading || saving} value={script} onChange={event => { setScript(event.target.value); setMessage(""); }} />
        <p>After saving, click Connect localhost to apply the script to your next local call.</p>
        <button disabled={loading || saving || script.trim().length < 10}>{saving ? "Saving…" : loading ? "Loading…" : "Save initial script"}</button>
        {error && <p role="alert">{error} <button type="button" disabled={loading || saving} onClick={() => setRetry(value => value + 1)}>Reload saved script</button></p>}
        {message && <p role="status">{message}</p>}
      </form>
    </details>
    <LocalMonitorConnect portal={portal} />
  </section>;
}
