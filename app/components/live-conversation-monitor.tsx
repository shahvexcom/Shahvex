"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "./live-conversation-monitor.css";
import { LiveMonitorSetup } from "./live-monitor-setup";

type Turn = { role: string; content: string };
type Call = {
  telephony_provider?: string; direct_audio_line?: string; id: string; agent_name: string; status: string; conversation_state: string;
  conversation_busy: boolean; lead_name: string; lead_number: string;
  vicidial_agent_user: string; external_campaign_id: string; asterisk_uniqueid: string;
  conversation_history: Turn[]; transcript: string;
};
const active = (call: Call) => ["INITIATED", "RINGING", "ANSWERED"].includes(call.status);

export default function LiveConversationMonitor({ portal }: { portal: "admin" | "bpo" }) {
  const [source, setSource] = useState<"campaign" | "local">("campaign");
  const [calls, setCalls] = useState<Call[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setCalls([]); setSelected(""); setError(""); setUpdated(""); setLoading(true);
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
          setError("");
          setUpdated(new Date().toLocaleTimeString());
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
  const call = calls.find(item => item.id === selected) || calls[0];
  const turns: Turn[] = call?.conversation_history?.length ? call.conversation_history
    : (call?.transcript || "").split(/\r?\n/).filter(Boolean).map(line => ({
      role: /^AGENT:/i.test(line) ? "assistant" : "user", content: line.replace(/^(AGENT|CLIENT):\s*/i, ""),
    }));
  const lastText = turns.map(turn => turn.content).join("");
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lastText, call?.id, follow]);
  return <main className="conversation-monitor">
    <header className="monitor-header">
      <div><Link href={portal === "admin" ? "/controler" : "/bpo"}>← Back to dashboard</Link>
        <h1>Live conversation monitor</h1><p>{source === "campaign" ? "Campaign agents" : "Local Asterisk test"} · {calls.filter(active).length} active calls</p></div>
      <span role="status">{error ? "Disconnected · retrying" : loading ? "Connecting…" : `Updated ${updated}`}</span>
    </header>
    <div className="monitor-source" role="group" aria-label="Call source">
      <button aria-pressed={source === "campaign"} onClick={() => setSource("campaign")}>Campaign calls</button>
      <button aria-pressed={source === "local"} onClick={() => setSource("local")}>Local test calls</button>
    </div>
    {source === "local" ? <LiveMonitorSetup portal={portal} /> : <p className="monitor-source-note">Campaign calls show the assigned AI agent, VICIdial campaign and conversation after the production bridge registers the answered call. Manage assignments in VoIP → Campaigns.</p>}
    {error && <p className="monitor-error" role="alert">{error} Previously received text may be out of date.</p>}
    <div className="monitor-layout">
      <aside aria-label="Calls"><h2>Calls</h2>
        {!calls.length && <p>{loading ? "Loading calls…" : source === "campaign" ? "No registered campaign calls. Check campaign intake and the production audio route." : "Connect your localhost bridge above, then dial your configured Asterisk extension. Local calls appear automatically."}</p>}
        {calls.map(item => <button key={item.id} onClick={() => setSelected(item.id)} aria-pressed={call?.id === item.id}>
          <strong>{item.agent_name}</strong><span>{item.lead_name || item.lead_number || "Customer"}</span>
          <small>{active(item) ? "● Live" : "Ended"} · {item.status}</small>
        </button>)}
      </aside>
      <section className="monitor-conversation" aria-label="Conversation">
        {call ? <><header><h2>{call.agent_name}</h2>
          <p>{call.lead_name || call.lead_number || "Customer"} · {call.conversation_state || call.status}</p>
          <p>{source === "campaign" ? call.telephony_provider === "AUDIOSOCKET" ? `Direct AudioSocket · Line ${call.direct_audio_line || "Unknown"} · Script campaign: ${call.external_campaign_id || "Unknown"} · Native customer not linked` : `Campaign: ${call.external_campaign_id || "Pending"} · Remote agent: ${call.vicidial_agent_user || "Pending"}` : "Local AudioSocket test call"}</p>
          {call.asterisk_uniqueid && <small>Asterisk call: {call.asterisk_uniqueid}</small>}
          <label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Follow new messages</label>
        </header>
        <div className="monitor-messages" tabIndex={0} aria-label="Agent and customer messages">
          {!turns.length && <p>Call connected. Starting the conversation…</p>}
          {turns.map((turn, index) => <article key={index} className={turn.role === "assistant" ? "monitor-agent" : "monitor-customer"}>
            <strong>{turn.role === "assistant" ? call.agent_name : "Customer"}</strong><p>{turn.content}</p>
          </article>)}
          {call.conversation_busy && active(call) && <p className="monitor-progress">Conversation updating…</p>}
          <div ref={bottom} />
        </div><footer>Text updates automatically. Agent text is generated speech; playback can lag or be interrupted.</footer></>
        : <div className="monitor-empty"><h2>Ready to monitor</h2><p>{source === "campaign" ? "Answered calls appear here with the assigned agent once the production campaign route is connected. Local test conversations are available under Local test calls." : "Open Localhost connection, enter the local bridge details and connect. Then dial the Asterisk test extension to see the conversation."}</p></div>}
      </section>
    </div>
  </main>;
}
