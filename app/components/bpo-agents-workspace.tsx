"use client";

import { useCallback, useEffect, useState } from "react";
import { FiBarChart2, FiCamera, FiCheck, FiEdit3, FiFileText, FiKey, FiMic, FiPause, FiPhoneCall, FiPlay, FiRefreshCw, FiUserPlus, FiUsers, FiX } from "react-icons/fi";
import { CustomDropdown } from "./custom-dropdown";
import "./bpo-agents-workspace.css";
import "./bpo-agent-form-polish.css";
import "./bpo-agent-activity.css";
import "./bpo-agent-progress.css";

type Voice = { id: string; name: string; gender: string; accent: string; telnyx_label: string | null; groq_label: string | null };
type Script = { id: string; script_file_name: string; lead_file_name: string; created_at: string };
type CallingAgent = {
  id: string;
  name: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  accent: string;
  status: string;
  created_at: string;
  avatar_url: string;
  voice_id: string;
  voice_name: string;
  source_script_id: string;
  script_name: string;
  source_lead_id: string | null;
  lead_file_name: string;
  is_active: boolean;
  dialing_mode: "AUTO" | "MANUAL" | "BOTH";
  voice_status: "ACTIVE" | "INACTIVE";
  telnyx_label: string | null;
  groq_label: string | null;
  progress: { calls: number; leadsCompleted: number; leadsTotal: number; leadsPercent: number; tasksCompleted: number; tasksTotal: number; tasksPercent: number };
};
type Form = { name: string; gender: "MALE" | "FEMALE" | "OTHER"; voiceId: string; scriptId: string; leadSheetId: string; dialingMode: "AUTO" | "MANUAL" | "BOTH"; avatarUrl: string };

const genderLabel = (gender: string) => gender.charAt(0) + gender.slice(1).toLowerCase();
const initialForm: Form = { name: "", gender: "OTHER", voiceId: "", scriptId: "", leadSheetId: "", dialingMode: "BOTH", avatarUrl: "" };
const dialingLabel = (mode: CallingAgent["dialing_mode"]) => mode === "AUTO" ? "Auto dialing" : mode === "MANUAL" ? "Manual dialing" : "Auto + manual";

export default function BpoAgentsWorkspace() {
  const [agents, setAgents] = useState<CallingAgent[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [agentLimit, setAgentLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<CallingAgent | null>(null);
  const [form, setForm] = useState<Form>(initialForm);
  const [busy, setBusy] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [activityBusy, setActivityBusy] = useState("");

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bpo/agents", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load calling agents.");
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      setVoices(Array.isArray(data.voices) ? data.voices : []);
      setScripts(Array.isArray(data.scripts) ? data.scripts : []);
      setAgentLimit(Number(data.agentLimit || 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load calling agents.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const remainingSlots = Math.max(0, agentLimit - agents.length);
  const readyAgents = agents.filter(agent => agent.telnyx_label || agent.groq_label).length;
  const assignedScripts = agents.filter(agent => Boolean(agent.script_name)).length;
  const canCreate = remainingSlots > 0 && voices.length > 0 && scripts.length > 0;
  const blocker = !agentLimit
    ? "Buy a plan with agent slots to create a calling agent."
    : !remainingSlots
      ? "All plan agent slots are in use."
      : !voices.length
        ? "Activate a controller-assigned AI voice in the Voices tab first."
        : !scripts.length
          ? "Upload a script and customer sheet first."
          : "";

  const openForm = () => {
    if (!canCreate) return;
    setMessage("");
    setEditingAgent(null);
    setForm({ ...initialForm, voiceId: voices[0]?.id || "", scriptId: scripts[0]?.id || "", leadSheetId: scripts[0]?.id || "" });
    setAvatarPreview("");
    setShowForm(true);
  };

  const openEdit = (agent: CallingAgent) => {
    setMessage("");
    setError("");
    setEditingAgent(agent);
    setForm({ name: agent.name, gender: agent.gender, voiceId: agent.voice_id, scriptId: agent.source_script_id, leadSheetId: agent.source_lead_id || agent.source_script_id, dialingMode: agent.dialing_mode, avatarUrl: agent.avatar_url || "" });
    setAvatarPreview(agent.avatar_url || "");
    setShowForm(true);
  };

  const closeForm = () => {
    if (busy || avatarUploading) return;
    setShowForm(false);
    setEditingAgent(null);
  };

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setError("Choose an image smaller than 5 MB.");
      return;
    }
    const temporaryPreview = URL.createObjectURL(file);
    setAvatarPreview(temporaryPreview);
    setAvatarUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("avatar", file);
      const response = await fetch("/api/upload/avatar", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Picture upload failed.");
      setForm(current => ({ ...current, avatarUrl: String(data.url || "") }));
      setAvatarPreview(String(data.url || temporaryPreview));
    } catch (cause) {
      setAvatarPreview(form.avatarUrl);
      setError(cause instanceof Error ? cause.message : "Picture upload failed.");
    } finally {
      setAvatarUploading(false);
    }
  };

  const saveAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/bpo/agents", {
        method: editingAgent ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingAgent ? { ...form, action: "edit", agentId: editingAgent.id } : form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Unable to ${editingAgent ? "update" : "create"} calling agent.`);
      setMessage(data.message || `Calling agent ${editingAgent ? "updated" : "created"}.`);
      setShowForm(false);
      setEditingAgent(null);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create calling agent.");
    } finally {
      setBusy(false);
    }
  };

  const setAgentActivity = async (agent: CallingAgent) => {
    const isActive = !agent.is_active;
    setActivityBusy(agent.id);
    setError("");
    try {
      const response = await fetch("/api/bpo/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activity", agentId: agent.id, isActive }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to update agent status.");
      setAgents(current => current.map(item => item.id === agent.id ? { ...item, is_active: isActive, status: isActive ? "APPROVED" : "SUSPENDED" } : item));
      setMessage(data.message || "Agent status updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update agent status.");
    } finally { setActivityBusy(""); }
  };

  if (loading) return <main className="bpo-agent-page"><div className="bpo-agent-title-skeleton bpo-agent-shimmer" /><section className="bpo-agent-kpis">{[1, 2, 3, 4].map(item => <article className="bpo-agent-shimmer" key={item} />)}</section><section className="bpo-agent-grid">{[1, 2].map(item => <article className="bpo-agent-shimmer" key={item} />)}</section></main>;

  return <main className="bpo-agent-page">
    <div className="bpo-agent-heading">
      <div><p className="bpo-eyebrow">DIALING TEAM</p><h1>Create calling agents</h1><p>Create an AI calling agent with one controller-assigned voice and an uploaded script from your workspace.</p></div>
      <div className="bpo-agent-heading-actions"><button type="button" className="bpo-agent-refresh" onClick={() => void load()}><FiRefreshCw /> Refresh</button><button type="button" className="bpo-agent-create" disabled={!canCreate} data-tooltip={blocker} onClick={openForm}><FiUserPlus /> Create agent</button></div>
    </div>

    <section className="bpo-agent-kpis" aria-label="Calling agent overview">
      <Kpi icon={<FiUsers />} tone="purple" label="Created agents" value={agents.length} />
      <Kpi icon={<FiUserPlus />} tone="blue" label="Available slots" value={`${remainingSlots} / ${agentLimit}`} />
      <Kpi icon={<FiKey />} tone="green" label="AI ready agents" value={readyAgents} />
      <Kpi icon={<FiFileText />} tone="orange" label="Scripts assigned" value={assignedScripts} />
    </section>

    {message && <p className="bpo-agent-message success"><FiCheck /> {message}</p>}
    {error && <p className="bpo-agent-message error">{error}</p>}

    <section className="bpo-agent-section">
      <header><div><h2>Your calling agents</h2><p>Every agent keeps the AI credentials and script selected when it was created.</p></div><span>{agents.length} {agents.length === 1 ? "agent" : "agents"}</span></header>
      {agents.length ? <div className="bpo-agent-grid">{agents.map(agent => <article className={`bpo-created-agent ${agent.is_active ? "" : "is-inactive"}`} key={agent.id}>
        <header><span className="bpo-agent-avatar">{agent.avatar_url ? <img src={agent.avatar_url} alt="" /> : agent.name.slice(0, 2).toUpperCase()}</span><div><h3>{agent.name}</h3><p>{genderLabel(agent.gender)} · {agent.accent}</p></div><em className={agent.is_active && agent.voice_status === "ACTIVE" ? "ready" : "inactive"}>{agent.is_active ? agent.voice_status === "ACTIVE" ? "Ready" : "Voice inactive" : "Inactive"}</em></header>
        <dl>
          <div><dt><FiMic /> AI voice</dt><dd>{agent.voice_name}</dd></div>
          <div><dt><FiFileText /> Assigned script</dt><dd data-tooltip={agent.script_name}>{agent.script_name}</dd></div>
          <div><dt><FiUsers /> Customer sheet</dt><dd data-tooltip={agent.lead_file_name}>{agent.lead_file_name || "Not available"}</dd></div>
          <div><dt><FiPhoneCall /> Dialing access</dt><dd>{dialingLabel(agent.dialing_mode)}</dd></div>
        </dl>
        <AgentProgress progress={agent.progress} />
        <footer><span><FiPhoneCall /> {agent.telnyx_label || "No VoIP"}</span><span><FiKey /> {agent.groq_label || "No Knowledge base"}</span></footer>
        <div className="bpo-agent-card-actions"><button className="bpo-agent-edit" type="button" onClick={() => openEdit(agent)}><FiEdit3 /> Edit agent</button><button className={`bpo-agent-activity ${agent.is_active ? "active" : "inactive"}`} type="button" disabled={activityBusy === agent.id} onClick={() => void setAgentActivity(agent)}>{activityBusy === agent.id ? "Saving..." : agent.is_active ? <><FiPause /> Set inactive</> : <><FiPlay /> Set active</>}</button></div>
      </article>)}</div>
        : <div className="bpo-agent-empty"><FiUsers /><h3>No calling agents yet</h3><p>{blocker || "Create your first agent to connect an AI voice and an uploaded script."}</p>{canCreate && <button type="button" onClick={openForm}><FiUserPlus /> Create agent</button>}</div>}
    </section>

    {showForm && <div className="bpo-agent-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && closeForm()}>
      <form className="bpo-agent-modal" onSubmit={saveAgent}>
        <button type="button" className="bpo-agent-modal-close" disabled={busy || avatarUploading} onClick={closeForm} aria-label="Close"><FiX /></button>
        <p className="bpo-eyebrow">{editingAgent ? "EDIT CALLING AGENT" : "NEW CALLING AGENT"}</p><h2>{editingAgent ? `Edit ${editingAgent.name}` : "Set up your agent"}</h2><p>Pick a profile picture if you want—then link an assigned AI voice and your uploaded campaign script.</p>
        <div className="bpo-agent-photo-picker">
          <div>{avatarPreview ? <img src={avatarPreview} alt="Agent preview" /> : <span>{form.name.trim().slice(0, 2).toUpperCase() || "AI"}</span>}</div>
          <label><input type="file" accept="image/*" onChange={event => void uploadAvatar(event.target.files?.[0])} /><FiCamera /><span>{avatarUploading ? "Uploading picture..." : form.avatarUrl ? "Change picture" : "Add a picture"}</span><small>Optional · JPG, PNG or WEBP · max 5 MB</small></label>
        </div>
        <div className="bpo-agent-form-grid">
          <label>Agent name<input required minLength={2} maxLength={80} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Sarah Collections" /></label>
          <label>Gender<CustomDropdown value={form.gender} onChange={value => setForm(current => ({ ...current, gender: value as Form["gender"] }))} ariaLabel="Agent gender" options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} /></label>
        </div>
        <label>AI voice &amp; credentials<CustomDropdown value={form.voiceId} onChange={value => setForm(current => ({ ...current, voiceId: value }))} ariaLabel="AI voice and credentials" options={voices.map(voice => ({ value: voice.id, label: `${voice.name} · ${voice.telnyx_label || "No VoIP"} / ${voice.groq_label || "No Knowledge base"}` }))} /></label>
        <label>Dialing access<CustomDropdown value={form.dialingMode} onChange={value => setForm(current => ({ ...current, dialingMode: value as Form["dialingMode"] }))} ariaLabel="Dialing access" options={[{ value: "AUTO", label: "Auto dialing only" }, { value: "MANUAL", label: "Manual dialing only" }, { value: "BOTH", label: "Auto + manual dialing" }]} /></label>
        <label>Uploaded script<CustomDropdown value={form.scriptId} onChange={value => setForm(current => ({ ...current, scriptId: value }))} ariaLabel="Uploaded script" options={scripts.map(script => ({ value: script.id, label: script.script_file_name }))} /></label>
        <label>Customer sheet<CustomDropdown value={form.leadSheetId} onChange={value => setForm(current => ({ ...current, leadSheetId: value }))} ariaLabel="Customer sheet" options={scripts.map(script => ({ value: script.id, label: script.lead_file_name }))} /></label>
        <div className="bpo-agent-modal-actions"><button type="button" disabled={busy || avatarUploading} onClick={closeForm}>Cancel</button><button type="submit" disabled={busy || avatarUploading}>{busy ? "Saving..." : editingAgent ? "Save changes" : "Create agent"} {editingAgent ? <FiCheck /> : <FiUserPlus />}</button></div>
      </form>
    </div>}
  </main>;
}

function Kpi({ icon, tone, label, value }: { icon: React.ReactNode; tone: string; label: string; value: string | number }) {
  return <article><span className={tone}>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function AgentProgress({ progress }: { progress: CallingAgent["progress"] }) {
  const callPercent = progress.leadsTotal > 0 ? Math.min(100, Math.round((progress.calls / progress.leadsTotal) * 100)) : 0;
  const rows = [
    { label: "Calls made", value: `${progress.calls}`, percent: callPercent, tone: "calls" },
    { label: "Customer sheet progress", value: `${progress.leadsCompleted} / ${progress.leadsTotal}`, percent: progress.leadsPercent, tone: "leads" },
    { label: "Script tasks collected", value: `${progress.tasksCompleted} / ${progress.tasksTotal}`, percent: progress.tasksPercent, tone: "tasks" },
  ];
  return <section className="bpo-agent-progress" aria-label="Agent task progress"><header><span><FiBarChart2 /> Progress</span><small>Customer data collection</small></header>{rows.map(row => <div className={`bpo-agent-progress-row ${row.tone}`} key={row.label}><div><small>{row.label}</small><strong>{row.value}</strong><em>{row.percent}%</em></div><i><b style={{ width: `${row.percent}%` }} /></i></div>)}</section>;
}
