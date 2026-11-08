"use client";
import { CustomDropdown } from "./custom-dropdown";
import { useEffect, useState } from "react";
import {
  FiClock,
  FiCode,
  FiDatabase,
  FiEdit2,
  FiFileText,
  FiGrid,
  FiList,
  FiTable,
  FiTrash2,
  FiUpload,
  FiUsers,
} from "react-icons/fi";
type Agent = {
  id: string;
  name: string;
  username: string;
  status: string;
  avatar_url?: string;
};
type FileData = {
  fileName: string;
  text: string;
  headers: string[];
  rows: string[][];
  fileUrl?: string;
  fileType?: string;
};
type Assignment = {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_avatar?: string;
  lead_file_name: string;
  script_file_name: string;
  lead_headers: string[];
  lead_rows: string[][];
  script_text: string;
};
type View = "grid" | "list" | "table";
const Avatar = ({ src, name }: { src?: string; name: string }) =>
  src ? (
    <img className="script-avatar" src={src} alt="" />
  ) : (
    <span className="script-avatar">
      {name
        .split(" ")
        .map((x) => x[0])
        .join("")
        .slice(0, 2)}
    </span>
  );
function AgentMultiSelect({
  agents,
  value,
  onChange,
}: {
  agents: Agent[];
  value: string[];
  onChange: (x: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    selected = agents.filter((a) => value.includes(a.id));
  return (
    <div className="agent-multi">
      <button type="button" onClick={() => setOpen(!open)}>
        <span className="agent-picker-avatars">
          {selected.length ? (
            selected
              .slice(0, 3)
              .map((a) => (
                <Avatar key={a.id} src={a.avatar_url} name={a.name} />
              ))
          ) : (
            <span className="script-avatar">?</span>
          )}
        </span>
        <span>
          <b>
            {selected.length
              ? `${selected.length} agent${selected.length > 1 ? "s" : ""} selected`
              : "Select approved agents"}
          </b>
          <small>Minimum 1 agent required</small>
        </span>
        <i>⌄</i>
      </button>
      {open && (
        <div>
          {agents.map((a) => (
            <button
              className={value.includes(a.id) ? "selected" : ""}
              type="button"
              key={a.id}
              onClick={() =>
                onChange(
                  value.includes(a.id)
                    ? value.filter((x) => x !== a.id)
                    : [...value, a.id],
                )
              }
            >
              <Avatar src={a.avatar_url} name={a.name} />
              <span>
                <b>{a.name}</b>
                <small>@{a.username} · Approved</small>
              </span>
              {value.includes(a.id) && <em>✓</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const responseData = async (r: Response) => {
  const text = await r.text();
  try {
    return text
      ? JSON.parse(text)
      : { message: `Request failed (${r.status}).` };
  } catch {
    return { message: `Request failed (${r.status}). Please try again.` };
  }
};
export function ScriptsManager({
  agents,
  onAction,
}: {
  agents: Agent[];
  onAction: (m: string) => void;
}) {
  const [id, setId] = useState(""),
    [agentIds, setAgentIds] = useState<string[]>([]),
    [multi, setMulti] = useState(false),
    [lead, setLead] = useState<FileData | null>(null),
    [script, setScript] = useState<FileData | null>(null),
    [items, setItems] = useState<Assignment[]>([]),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editId, setEditId] = useState(""),
    [view, setView] = useState<View>("grid"),
    [open, setOpen] = useState(false),
    [deleteItem, setDeleteItem] = useState<Assignment | null>(null);
  const approved = agents.filter((a) => a.status === "APPROVED"),
    selected = approved.find((a) => a.id === id),
    load = () => {
      setLoading(true);
      fetch("/api/admin/scripts")
        .then(async (r) => (r.ok ? responseData(r) : null))
        .then((d) => setItems(d?.assignments ?? []))
        .finally(() => setLoading(false));
    };
  useEffect(() => {
    load();
  }, []);
  const upload = async (kind: "lead" | "script", file?: File) => {
    if (!file) return;
    setBusy(kind);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch("/api/admin/scripts", {
          method: "POST",
          body: form,
        }),
        d = await responseData(r);
      if (!r.ok) throw Error(d.message);
      const f = {
        fileName: d.fileName,
        text: d.text,
        headers: d.headers,
        rows: d.rows,
        fileUrl: d.fileUrl,
        fileType: d.fileType,
      };
      kind === "lead" ? setLead(f) : setScript(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy("");
    }
  };
  const reset = () => {
    setId("");
    setAgentIds([]);
    setMulti(false);
    setLead(null);
    setScript(null);
    setEditId("");
    setError("");
  };
  const save = async () => {
    const target = multi ? agentIds : id ? [id] : [];
    if (!target.length || !lead || !script)
      return setError("Select at least one agent and upload both sheets.");
    setBusy("save");
    try {
      const r = await fetch("/api/admin/scripts", {
          method: editId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editId,
            agentId: editId ? target[0] : undefined,
            agentIds: editId ? undefined : target,
            leadFileName: lead.fileName,
            leadFileUrl: lead.fileUrl,
            leadFileType: lead.fileType,
            scriptFileName: script.fileName,
            scriptFileUrl: script.fileUrl,
            scriptFileType: script.fileType,
            headers: lead.headers,
            rows: lead.rows,
            scriptText: script.text,
          }),
        }),
        d = await responseData(r);
      if (!r.ok) return setError(d.message);
      onAction(d.message);
      reset();
      load();
    } catch {
      setError("Could not save the assignment. Please try again.");
    } finally {
      setBusy("");
    }
  };
  const edit = (a: Assignment) => {
    setEditId(a.id);
    setId(a.agent_id);
    setAgentIds([a.agent_id]);
    setLead({
      fileName: a.lead_file_name,
      text: "",
      headers: a.lead_headers,
      rows: a.lead_rows,
    });
    setScript({
      fileName: a.script_file_name,
      text: a.script_text,
      headers: [],
      rows: [],
    });
    scrollTo({ top: 0, behavior: "smooth" });
  };
  const del = async () => {
    if (!deleteItem) return;
    setBusy("delete");
    const r = await fetch(`/api/admin/scripts?id=${deleteItem.id}`, {
        method: "DELETE",
      }),
      d = await responseData(r);
    setBusy("");
    setDeleteItem(null);
    onAction(d.message);
    if (r.ok) load();
  };
  const assigned = new Set(items.map((x) => x.agent_id));
  return (
    <div className="shahvex-scripts">
      <div className="admin-page-head">
        <div>
          <p>AUTOMATION</p>
          <h1>Scripts</h1>
        </div>
      </div>
      <div className="script-kpis">
        <K icon={<FiCode />} l="Assignments" v={items.length} t="purple" />
        <K icon={<FiUsers />} l="Assigned agents" v={assigned.size} t="blue" />
        <K
          icon={<FiDatabase />}
          l="Leads loaded"
          v={items.reduce((n, x) => n + x.lead_rows.length, 0)}
          t="green"
        />
        <K
          icon={<FiClock />}
          l="Pending setup"
          v={Math.max(0, approved.length - assigned.size)}
          t="orange"
        />
      </div>
      <section className="script-layout">
        <div className="admin-card script-form">
          <div className="card-heading">
            <div>
              <h2>{editId ? "Edit assignment" : "Create agent assignment"}</h2>
              <p>
                Upload sheets and assign them to{" "}
                {multi ? "one or more agents." : "an agent."}
              </p>
            </div>
          </div>
          <div className="script-agent-select">
            <div className="agent-select-label">
              <span>Assign to agent</span>
              {!editId && (
                <label className="multi-agent-toggle">
                  <input
                    type="checkbox"
                    checked={multi}
                    onChange={(e) => {
                      setMulti(e.target.checked);
                      setOpen(false);
                      if (e.target.checked && id) setAgentIds([id]);
                    }}
                  />
                  <i />
                  <b>Multiple agents</b>
                </label>
              )}
            </div>
            {multi ? (
              <AgentMultiSelect
                agents={approved}
                value={agentIds}
                onChange={setAgentIds}
              />
            ) : (
              <CustomDropdown value={id} onChange={value => { setId(value); setAgentIds([value]); }} ariaLabel="Assign to agent" placeholder={approved.length ? "Select an approved agent" : "No approved agents available"} disabled={!approved.length} options={approved.map(agent => ({ value: agent.id, label: agent.name + ' (@' + agent.username + ')' }))} />
            )}
          </div>
          <Upload
            title="Client lead sheet"
            value={lead}
            busy={busy === "lead"}
            onFile={(f) => upload("lead", f)}
          />
          <Upload
            title="Agent script sheet"
            value={script}
            busy={busy === "script"}
            onFile={(f) => upload("script", f)}
          />
          {error && <p className="script-error">{error}</p>}
          <button className="admin-primary script-save" onClick={save}>
            {busy === "save"
              ? "Saving..."
              : editId
                ? "Update assignment"
                : multi
                  ? "Assign to selected agents"
                  : "Assign sheets"}
          </button>
          {editId && (
            <button className="admin-link script-cancel" onClick={reset}>
              Cancel edit
            </button>
          )}
        </div>
        <div className="script-preview-stack">
          <Preview
            title="Lead data preview"
            file={lead}
            empty="Lead table preview appears after upload."
          />
          <Preview
            title="Script preview"
            file={script}
            empty="Your paragraph-based script will appear here."
            script
            setScript={setScript}
          />
        </div>
      </section>
      <section className="admin-card script-assignments">
        <div className="card-heading">
          <div>
            <h2>Assigned sheets</h2>
            <p>Edit or delete an assignment from its action buttons.</p>
          </div>
          <div className="script-view-switch">
            <button
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
            >
              <FiGrid />
            </button>
            <button
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              <FiList />
            </button>
            <button
              className={view === "table" ? "active" : ""}
              onClick={() => setView("table")}
            >
              <FiTable />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="script-assignment-grid">
            {[1, 2, 3].map((x) => (
              <div className="script-skeleton" key={x} />
            ))}
          </div>
        ) : (
          <Cards a={items} view={view} edit={edit} askDelete={setDeleteItem} />
        )}
      </section>
      {deleteItem && (
        <div
          className="script-confirm-backdrop"
          onMouseDown={() => busy !== "delete" && setDeleteItem(null)}
        >
          <section
            className="script-confirm-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="script-confirm-icon">
              <FiTrash2 />
            </div>
            <h2>Delete assignment?</h2>
            <p>
              This will permanently remove {deleteItem.agent_name}&apos;s lead
              and script assignment. This cannot be undone.
            </p>
            <div>
              <button
                className="admin-outline"
                onClick={() => setDeleteItem(null)}
                disabled={busy === "delete"}
              >
                Cancel
              </button>
              <button
                className="script-delete-confirm"
                onClick={del}
                disabled={busy === "delete"}
              >
                {busy === "delete" ? "Deleting..." : "Delete assignment"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Preview({
  title,
  file,
  empty,
  script,
  setScript,
}: {
  title: string;
  file: FileData | null;
  empty: string;
  script?: boolean;
  setScript?: React.Dispatch<React.SetStateAction<FileData | null>>;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = file
    ? Math.max(1, Math.ceil(file.rows.length / pageSize))
    : 1;
  const safePage = Math.min(page, totalPages);
  const rows =
    file?.rows.slice((safePage - 1) * pageSize, safePage * pageSize) ?? [];
  const changePage = (next: number) =>
    setPage(Math.max(1, Math.min(next, totalPages)));
  return (
    <section className="admin-card script-preview">
      <div className="card-heading">
        <div>
          <h2>{title}</h2>
          <p>{file?.fileName ?? "Upload a sheet."}</p>
        </div>
        {script ? <FiFileText /> : <FiDatabase />}
      </div>
      {file ? (
        script ? (
          <textarea
            rows={Math.max(10, file.text.split("\n").length + 1)}
            value={file.text}
            onChange={(e) => setScript?.({ ...file, text: e.target.value })}
          />
        ) : (
          <>
            <div className="script-table-wrap">
              <table>
                <thead>
                  <tr>
                    {file.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={(safePage - 1) * pageSize + i}>
                      {file.headers.map((_, c) => (
                        <td key={c}>{r[c] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="script-pagination">
              <small>
                Showing {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, file.rows.length)} of{" "}
                {file.rows.length} leads
              </small>
              <div>
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={safePage === 1}
                  onClick={() => changePage(safePage - 1)}
                >
                  ‹
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (number) => (
                    <button
                      type="button"
                      key={number}
                      className={number === safePage ? "selected" : ""}
                      onClick={() => changePage(number)}
                    >
                      {number}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={safePage === totalPages}
                  onClick={() => changePage(safePage + 1)}
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )
      ) : (
        <div className="script-empty-preview">{script ? <FiFileText /> : <FiDatabase />}<strong>{script ? "Your script preview" : "Your lead data preview"}</strong><span>{empty}</span></div>
      )}
    </section>
  );
}
function Cards({
  a,
  view,
  edit,
  askDelete,
}: {
  a: Assignment[];
  view: View;
  edit: (x: Assignment) => void;
  askDelete: (x: Assignment) => void;
}) {
  if (!a.length) return <div className="script-empty-assignments"><div><FiCode /></div><h3>Your first assignment starts here</h3><p>Choose an agent, upload a lead sheet and script, then assign them to your team.</p><button type="button" className="admin-outline" onClick={() => { document.querySelector(".script-form")?.scrollIntoView({ behavior: "smooth", block: "center" }); document.querySelector<HTMLButtonElement>(".script-form .custom-dropdown-trigger")?.focus(); }}><FiUpload /> Set up an assignment</button></div>;
  return (
    <div
      className={
        view === "grid" ? "script-assignment-grid" : "script-assignment-list"
      }
    >
      {a.map((x, i) => (
        <article className={`script-assignment-card tone-${i % 4}`} key={x.id}>
          <div className="script-card-actions">
            <button onClick={() => edit(x)}>
              <FiEdit2 />
            </button>
            <button onClick={() => askDelete(x)}>
              <FiTrash2 />
            </button>
          </div>
          <Avatar src={x.agent_avatar} name={x.agent_name} />
          <div>
            <b>{x.agent_name}</b>
            <small className="assignment-id">ID: {x.id}</small>
            <small>
              {x.lead_file_name} · {x.lead_rows.length} leads
            </small>
            <small>{x.script_file_name}</small>
          </div>
        </article>
      ))}
    </div>
  );
}
function K({
  icon,
  l,
  v,
  t,
}: {
  icon: React.ReactNode;
  l: string;
  v: number;
  t: string;
}) {
  return (
    <section className={`agent-kpi script-kpi ${t}`}>
      <span>{icon}</span>
      <div>
        <small>{l}</small>
        <strong>{v}</strong>
      </div>
    </section>
  );
}
function Upload({
  title,
  value,
  busy,
  onFile,
}: {
  title: string;
  value: FileData | null;
  busy: boolean;
  onFile: (f?: File) => void;
}) {
  return (
    <label className="script-upload">
      <input
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <FiUpload />
      <span>
        <b>{busy ? "Extracting..." : (value?.fileName ?? title)}</b>
        <small>PDF, DOCX, XLSX, CSV, TXT or MD</small>
      </span>
      <em>{value ? "Replace" : "Upload"}</em>
    </label>
  );
}
