"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiActivity, FiCheckCircle, FiClock, FiPhoneCall, FiRefreshCw, FiSearch } from "react-icons/fi";
import { CustomDropdown } from "./custom-dropdown";

type BpoCall = {
  id: string;
  call_type: string;
  status: string;
  lead_name: string;
  lead_number: string;
  duration_seconds: number;
  outcome: string;
  created_at: string;
  agent_name: string;
  agent_avatar: string;
  bpo_id: string;
  bpo_name: string;
};

const duration = (value: number) => {
  const seconds = Number(value || 0);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};

const initials = (name: string) => name.split(" ").filter(Boolean).map(item => item[0]).join("").slice(0, 2).toUpperCase();
const pill = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function BpoCallHistory() {
  const [calls, setCalls] = useState<BpoCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [bpo, setBpo] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/bpo/calls", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load BPO call history.");
      setCalls(data.calls ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load BPO call history."); }
    finally { setLoading(false); }
  }, []);

  // The history request intentionally starts after this client panel mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const bpoUsers = useMemo(() => [...new Map(calls.map(call => [call.bpo_id, call.bpo_name])).entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name)), [calls]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return calls.filter(call => (bpo === "ALL" || call.bpo_id === bpo) && (status === "ALL" || call.status === status) && (!search || `${call.bpo_name} ${call.agent_name} ${call.lead_name} ${call.lead_number}`.toLowerCase().includes(search)));
  }, [bpo, calls, query, status]);
  const metrics = useMemo(() => ({ total: filtered.length, completed: filtered.filter(call => call.status === "COMPLETED").length, today: filtered.filter(call => new Date(call.created_at).toDateString() === new Date().toDateString()).length, minutes: Math.round(filtered.reduce((sum, call) => sum + Number(call.duration_seconds || 0), 0) / 60) }), [filtered]);

  return <section className="bpo-history-admin">
    <div className="bpo-section-heading"><div><p>BPO USER CALL HISTORY</p><h1>Agent call history</h1><span>Every call made by a BPO user or their assigned agent is retained here.</span></div><button className="admin-outline" onClick={() => void load()} disabled={loading}><FiRefreshCw /> Refresh</button></div>
    <div className="bpo-admin-history-kpis"><article className="bpo-history-total"><span><FiActivity /></span><div><small>Total calls</small><strong>{metrics.total}</strong></div></article><article className="bpo-history-today"><span><FiClock /></span><div><small>Calls today</small><strong>{metrics.today}</strong></div></article><article className="bpo-history-completed"><span><FiCheckCircle /></span><div><small>Completed</small><strong>{metrics.completed}</strong></div></article><article className="bpo-history-talk"><span><FiPhoneCall /></span><div><small>Talk time</small><strong>{metrics.minutes}m</strong></div></article></div>
    <section className="bpo-admin-call-table"><div className="bpo-admin-call-tools"><label><FiSearch /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search BPO user, agent or lead" /></label><CustomDropdown className="bpo-history-filter" value={bpo} onChange={setBpo} ariaLabel="Filter by BPO user" options={[{ value: "ALL", label: "All BPO users" }, ...bpoUsers.map(user => ({ value: user.id, label: user.name }))]} /><CustomDropdown className="bpo-history-filter" value={status} onChange={setStatus} ariaLabel="Filter by call status" options={[{ value: "ALL", label: "All statuses" }, ...[...new Set(calls.map(call => call.status))].sort().map(item => ({ value: item, label: item }))]} /><span>{filtered.length} call{filtered.length === 1 ? "" : "s"}</span></div>
      {loading ? <div className="bpo-call-table-loading" aria-busy="true">{[1, 2, 3, 4, 5].map(item => <i className="bpo-shimmer" key={item} />)}</div> : error ? <div className="bpo-admin-error"><FiPhoneCall /><h2>Could not load call history</h2><p>{error}</p><button className="admin-primary" onClick={() => void load()}>Try again</button></div> : <div className="bpo-admin-table-scroll"><table><thead><tr><th>BPO user</th><th>Agent</th><th>Lead</th><th>Type</th><th>Duration</th><th>Result</th><th>Date</th><th /></tr></thead><tbody>{filtered.length ? filtered.map(call => <tr key={`${call.id}-${call.bpo_id}`}><td><strong>{call.bpo_name}</strong></td><td><span className="bpo-history-agent">{call.agent_avatar ? <img src={call.agent_avatar} alt="" /> : <i>{initials(call.agent_name)}</i>}<b>{call.agent_name}</b></span></td><td><strong>{call.lead_name || "Unknown lead"}</strong><small>{call.lead_number || "No number"}</small></td><td>{call.call_type === "QUICK_DIAL" ? "Manual" : "Agent"}</td><td>{duration(call.duration_seconds)}</td><td><em className={`bpo-pill ${pill(call.outcome || call.status)}`}>{call.outcome || call.status}</em></td><td>{new Date(call.created_at).toLocaleString()}</td><td><a className="bpo-call-open" href={`/controler/calls/${call.id}`}>Open</a></td></tr>) : <tr className="bpo-call-empty-row"><td colSpan={8}><div className="bpo-call-empty-state"><span><FiPhoneCall /></span><h2>{calls.length ? "No calls match these filters" : "No BPO agent calls yet"}</h2><p>{calls.length ? "Try another BPO user, status, or search term." : "Calls made by a BPO user or their agents will appear here."}</p></div></td></tr>}</tbody></table></div>}
    </section>
  </section>;
}
