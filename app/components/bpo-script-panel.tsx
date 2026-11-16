"use client";
import { useEffect, useState } from "react";
import {
  FiFile,
  FiFileText,
  FiHardDrive,
  FiPlus,
  FiTrash2,
  FiUpload,
  FiUsers,
  FiX,
} from "react-icons/fi";
import BpoFileActions from "./bpo-file-actions";
type Assignment = {
  id: string;
  lead_file_name: string;
  script_file_name: string;
  lead_file_type?: string;
  script_file_type?: string;
  lead_headers: string[];
  lead_rows: string[][];
  script_text: string;
  created_at: string;
};
type Kind = "script" | "leads";
type Storage = { used: number; limit: number; remaining: number; scripts: number; recordings: number; hasPlan: boolean };
const pretty = (n: number) =>
  n <= 0
    ? "0 B"
    : n < 1048576
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1048576).toFixed(1)} MB`;
export default function BpoScriptPanel() {
  const [items, setItems] = useState<Assignment[]>([]),
    [loading, setLoading] = useState(true),
    [show, setShow] = useState(false),
    [tab, setTab] = useState<Kind>("script"),
    [script, setScript] = useState<File | null>(null),
    [leads, setLeads] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [storage, setStorage] = useState<Storage>({ used: 0, limit: 0, remaining: 0, scripts: 0, recordings: 0, hasPlan: false });
  const load = () =>
    fetch("/api/bpo/scripts")
      .then((r) => r.json())
      .then((x) => {
        setItems(x.assignments || []);
        setStorage({ used: Number(x.storageUsedBytes || 0), limit: Number(x.storageLimitBytes || 0), remaining: Number(x.storageRemainingBytes || 0), scripts: Number(x.scriptStorageBytes || 0), recordings: Number(x.recordingStorageBytes || 0), hasPlan: Boolean(x.hasActivePlan) });
      })
      .catch(() => setMessage("Unable to load files."))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []);
  const pick = (kind: Kind, file?: File) => {
    if (!file) return;
    if (file.size > 5242880) {
      setMessage("Each file must be 5MB or smaller.");
      return;
    }
    if (!storage.hasPlan) {
      setMessage("Buy a plan before uploading workspace files.");
      return;
    }
    const nextScript = kind === "script" ? file : script;
    const nextLeads = kind === "leads" ? file : leads;
    const selectedBytes = (nextScript?.size || 0) + (nextLeads?.size || 0);
    if (storage.used + selectedBytes > storage.limit) {
      setMessage(`Not enough storage. You have ${pretty(storage.remaining)} left in your plan.`);
      return;
    }
    kind === "script" ? setScript(file) : setLeads(file);
    setMessage("");
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!script) {
      setMessage("Choose an agent script. A customer sheet is optional.");
      return;
    }
    setBusy(true);
    const body = new FormData();
    body.append("script", script);
    if(leads)body.append("leads", leads);
    const r = await fetch("/api/bpo/scripts", { method: "POST", body });
    const j = await r.json();
    setMessage(j.message || "");
    setBusy(false);
    if (r.ok) {
      setShow(false);
      setScript(null);
      setLeads(null);
      setLoading(true);
      load();
    }
  }
  const uploadBlocked = !storage.hasPlan || storage.used >= storage.limit;
  if (loading)
    return (
      <section className="bpo-script-page">
        <div className="bpo-skeleton skeleton-heading" />
        <div className="bpo-script-kpis">
          {[1, 2, 3, 4].map((x) => (
            <article className="bpo-skeleton-card" key={x}>
              <i className="bpo-skeleton" />
              <span>
                <b className="bpo-skeleton" />
                <em className="bpo-skeleton" />
              </span>
            </article>
          ))}
        </div>
      </section>
    );
  return (
    <section className="bpo-script-page">
      <div className="bpo-script-title">
        <div>
          <p className="bpo-eyebrow">SCRIPT LIBRARY</p>
          <h1>Agent scripts</h1>
          <p>Manage scripts, customer sheets and recording storage for your calling team.</p>
        </div>
        <button className="bpo-upload-btn" disabled={uploadBlocked} data-tooltip={storage.hasPlan ? "Your plan storage is full" : "Buy a plan to unlock storage"} onClick={() => setShow(true)}>
          <FiUpload />
          {uploadBlocked ? "Storage unavailable" : "Upload script"}
        </button>
      </div>
      <div className="bpo-script-kpis">
        <Kpi
          icon={<FiFileText />}
          tone="purple"
          label="Total scripts"
          value={items.length}
        />
        <Kpi
          icon={<FiUsers />}
          tone="blue"
          label="Total customers"
          value={items.reduce((n, x) => n + (x.lead_rows?.length || 0), 0)}
        />
        <Kpi
          icon={<FiHardDrive />}
          tone="green"
          label="Used storage"
          value={pretty(storage.used)}
        />
        <Kpi
          icon={<FiUpload />}
          tone="orange"
          label="Plan storage"
          value={pretty(storage.limit)}
        />
      </div>
      <section className="bpo-uploaded-section">
        <h2>Uploaded files</h2>
        <p>Saved calling scripts. VICIdial campaign numbers stay on the dialer.</p>
        {!items.length && <div className="bpo-script-empty"><div><FiFileText /></div><h3>Your scripts start here</h3><p>Keep agent scripts and customer lead sheets together, ready for your calling team.</p><button type="button" className="bpo-upload-btn" disabled={uploadBlocked} onClick={() => setShow(true)}><FiUpload /> Upload workspace files</button>{uploadBlocked && <small>{storage.hasPlan ? "Your plan storage is full." : "Choose a plan to unlock file storage."}</small>}</div>}
        {items.map((x) => (
          <div className="bpo-file-pair" key={x.id}>
            <BpoFileActions
              id={x.id}
              name={x.script_file_name}
              type={x.script_file_type}
              content={x.script_text}
              kind="script"
              onDeleted={() => {
                setLoading(true);
                load();
              }}
            />
            {x.lead_file_name&&<BpoFileActions
              id={x.id}
              name={x.lead_file_name}
              type={x.lead_file_type}
              content={[
                ...(x.lead_rows || []).map((row) => row.join(" | ")),
              ].join("\n")}
              kind="leads"
              onDeleted={() => {
                setLoading(true);
                load();
              }}
            />}
          </div>
        ))}
      </section>
      {show && (
        <div className="bpo-upload-overlay">
          <form className="bpo-upload-modal" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="bpo-upload-title">
            <button
              type="button"
              aria-label="Close upload form"
              className="bpo-modal-close"
              onClick={() => setShow(false)}
            >
              <FiX />
            </button>
            <p className="bpo-eyebrow">NEW WORKSPACE DATA</p>
            <h2 id="bpo-upload-title">Upload workspace files</h2>
            <p className="bpo-modal-copy">
              Upload a calling script; no customer sheet is needed for VICIdial campaigns. Files count against plan storage and must be 5MB or smaller.
            </p>
            <div className="bpo-modal-tabs">
              <button
                type="button"
                className={tab === "script" ? "active" : ""}
                onClick={() => setTab("script")}
              >
                Agent Script
              </button>
              <button
                type="button"
                className={tab === "leads" ? "active" : ""}
                onClick={() => setTab("leads")}
              >
                Customer Sheet
              </button>
            </div>
            <Uploader
              kind={tab}
              file={tab === "script" ? script : leads}
              pick={pick}
              clear={() =>
                tab === "script" ? setScript(null) : setLeads(null)
              }
            />
            <div className="bpo-upload-summary">
              <span className={script ? "done" : ""}>
                Agent Script {script ? "✓" : ""}
              </span>
              <span className={leads ? "done" : ""}>
                Customer Sheet (optional) {leads ? "✓" : ""}
              </span>
            </div>
            {message && <p className="bpo-upload-message">{message}</p>}
            <button className="bpo-upload-submit" disabled={busy}>
              <FiPlus />
              {busy ? "Saving..." : "Save to workspace"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
function Kpi({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: string | number;
}) {
  return (
    <article>
      <span className={tone}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}
function Uploader({
  kind,
  file,
  pick,
  clear,
}: {
  kind: Kind;
  file: File | null;
  pick: (k: Kind, f?: File) => void;
  clear: () => void;
}) {
  return (
    <div className="bpo-uploader">
      {file ? (
        <div className="bpo-selected-file">
          <span>
            <FiFile />
          </span>
          <div>
            <strong>{file.name}</strong>
            <small>
              {pretty(file.size)} · {file.name.split(".").pop()?.toUpperCase()}{" "}
              · Max 5MB
            </small>
          </div>
          <button type="button" onClick={clear}>
            <FiTrash2 />
          </button>
        </div>
      ) : (
        <label>
          <input
            type="file"
            accept={
              kind === "script"
                ? ".txt,.md,.docx,.pdf,.csv,.xlsx,.xls"
                : ".csv,.xlsx,.xls"
            }
            onChange={(e) => pick(kind, e.target.files?.[0])}
          />
          <FiUpload />
          <strong>
            {kind === "script" ? "Choose agent script" : "Choose customer sheet"}
          </strong>
          <small>Click to browse · Supported files · Max 5MB</small>
        </label>
      )}
    </div>
  );
}
