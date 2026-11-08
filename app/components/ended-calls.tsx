"use client";
import { useMemo, useState } from "react";
import { FiArchive, FiDownload, FiChevronLeft, FiChevronRight, FiPlay, FiExternalLink } from "react-icons/fi";
import { RecordingModal } from "./recording-modal";

type Call = {
  id: string;
  status: string;
  agent_name: string;
  lead_name: string;
  lead_number: string;
  summary: string;
  answered_at?: string;
  ended_at?: string;
  created_at?: string;
  duration_seconds?: number;
  outcome?: string;
  recording_url?: string;
};

function formatDate(value?: string) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

function formatDuration(seconds?: number) {
  if (!seconds && seconds !== 0) return "—";
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function callDuration(call: Call) {
  if (typeof call.duration_seconds === "number" && call.duration_seconds > 0) return formatDuration(call.duration_seconds);
  if (!call.answered_at) return "—";
  const endedAt = call.ended_at ? new Date(call.ended_at).getTime() : Date.now();
  return formatDuration(Math.max(0, Math.floor((endedAt - new Date(call.answered_at).getTime()) / 1000)));
}

function outcomeClass(outcome?: string) {
  return `outcome-${String(outcome || "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function EndedCalls({ calls }: { calls: Call[] }) {
  const [page, setPage] = useState(1);
  const [playing, setPlaying] = useState<Call | null>(null);
  const pageSize = 10;
  const ended = useMemo(() => calls.filter((c) => c.status === "COMPLETED"), [calls]);
  const totalPages = Math.max(1, Math.ceil(ended.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = ended.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const exportReport = (call: Call) => {
    const rows = [
      ["Agent", call.agent_name || "Unknown agent"],
      ["Lead", call.lead_name || "Unnamed client"],
      ["Lead Number", call.lead_number || "N/A"],
      ["Dialed On", formatDate(call.created_at)],
      ["Ended On", formatDate(call.ended_at)],
      ["Duration", callDuration(call)],
      ["Status", call.status || "COMPLETED"],
      ["Outcome", call.outcome || "Not provided"],
      ["Summary", call.summary || "No summary available."]
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `call-report-${call.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="admin-card ended-calls-card">
      <div className="card-heading">
        <div>
          <h2>Ended calls</h2>
          <p>Completed calls, AI summary, and report export.</p>
        </div>
        <span className="ended-count"><FiArchive /> {ended.length} completed</span>
      </div>

      {ended.length ? (
        <>
          <div className="ended-calls-table" role="region" aria-label="Completed call history" tabIndex={0}>
            <div className="ended-calls-head">
              <span>Lead</span>
              <span>Duration</span>
              <span>Agent</span>
              <span>Lead status</span>
              <span>Dialed date</span>
              <span>End date</span>
              <span>AI output</span>
              <span>Actions</span>
            </div>

            {rows.map((call) => (
              <div className="ended-calls-row" key={call.id}>
                <span className="ended-call-cell ended-call-lead">
                  <b>{call.lead_name || "Unnamed client"}</b>
                  <small>{call.lead_number || "No number"}</small>
                </span>
                <span className="ended-call-cell ended-call-duration">{callDuration(call)}</span>
                <span className="ended-call-cell">{call.agent_name || "Unknown agent"}</span>
                <span className="ended-call-cell ended-call-status">
                  <i className={`call-status-pill ${outcomeClass(call.outcome)}`}><FiArchive /> {call.outcome || "Not classified"}</i>
                </span>
                <span className="ended-call-cell">{formatDate(call.created_at)}</span>
                <span className="ended-call-cell">{formatDate(call.ended_at)}</span>
                <span className="ended-call-cell"><span className={`ended-summary ${call.summary ? "is-ready" : "is-pending"}`}>{call.summary ? "Summary ready" : "Processing"}</span></span>
                <span className="ended-call-cell ended-call-action">
                  <a className="admin-outline small-btn icon-only" href={`/controler/calls/${call.id}?from=live`} data-tooltip="View call details" aria-label="View call details"><FiExternalLink /></a>
                  <button className="admin-outline small-btn icon-only" onClick={() => exportReport(call)} data-tooltip="Download summary" aria-label="Download summary"><FiDownload /></button>
                  {call.recording_url && <button className="admin-outline small-btn icon-only" onClick={() => setPlaying(call)} data-tooltip="Play audio" aria-label="Play audio"><FiPlay /></button>}
                  {call.recording_url && <a className="admin-outline small-btn icon-only" href={`/api/admin/calls/${call.id}/recording`} data-tooltip="Download audio" aria-label="Download audio"><FiDownload /></a>}
                </span>
              </div>
            ))}
          </div>

          <div className="ended-calls-pagination">
            <button aria-label="Previous ended calls page" disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <FiChevronLeft />
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button aria-label="Next ended calls page" disabled={currentPage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <FiChevronRight />
            </button>
          </div>
        </>
      ) : (
        <div className="ended-empty"><div><FiArchive /></div><h3>Your call history starts here</h3><p>Completed calls will appear here with outcomes, summaries and recordings when available.</p></div>
      )}
      <RecordingModal call={playing} onClose={() => setPlaying(null)} />
    </section>
  );
}
