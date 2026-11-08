"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiEdit3, FiKey, FiMic, FiPhoneCall, FiPlus, FiTrash2, FiUsers, FiX } from "react-icons/fi";
import { CustomDropdown } from "./custom-dropdown";
import "./admin-voices.css";

type Credential = { id: string; provider: "GROQ" | "TELNYX"; label: string; config?: { assistantId?: string; ttsModel?: string } };
type BpoOption = { id: string; name: string; email: string | null; status: string };
type AssignedBpo = { id: string; name: string; email: string | null };
type AdminVoice = {
  id: string;
  name: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  accent: string;
  status: "ACTIVE" | "INACTIVE";
  telnyx_credential_id: string | null;
  groq_credential_id: string | null;
  telnyx_label: string | null;
  groq_label: string | null;
  assigned_bpos: AssignedBpo[];
};
type VoiceForm = { id: string; name: string; gender: AdminVoice["gender"]; accent: string; status: AdminVoice["status"]; telnyxCredentialId: string; groqCredentialId: string; bpoIds: string[] };
type VoiceData = { voices: AdminVoice[]; bpoUsers: BpoOption[]; credentials: Credential[] };

const blank: VoiceForm = { id: "", name: "", gender: "FEMALE", accent: "Professional", status: "ACTIVE", telnyxCredentialId: "", groqCredentialId: "", bpoIds: [] };

async function json(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: `Request failed (${response.status}).` }; }
}

export function AdminVoices({ onAction }: { onAction: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<VoiceData | null>(null);
  const [form, setForm] = useState<VoiceForm | null>(null);
  const [confirm, setConfirm] = useState<AdminVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const onActionRef = useRef(onAction);
  useEffect(() => { onActionRef.current = onAction; }, [onAction]);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/voices", { cache: "no-store" });
    const result = await json(response);
    if (!response.ok) throw new Error(result.message || "Unable to load admin voices.");
    setData(result);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(error => onActionRef.current(error instanceof Error ? error.message : "Unable to load admin voices.", "error"));
  }, [load]);

  const edit = (voice: AdminVoice) => setForm({
    id: voice.id,
    name: voice.name,
    gender: voice.gender,
    accent: voice.accent,
    status: voice.status,
    telnyxCredentialId: voice.telnyx_credential_id || "",
    groqCredentialId: voice.groq_credential_id || "",
    bpoIds: voice.assigned_bpos.map(item => item.id),
  });

  const update = <K extends keyof VoiceForm>(key: K, value: VoiceForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  const toggleBpo = (id: string) => update("bpoIds", form?.bpoIds.includes(id) ? form.bpoIds.filter(item => item !== id) : [...(form?.bpoIds || []), id]);
  const allBposSelected = Boolean(data?.bpoUsers.length) && data!.bpoUsers.every(user => form?.bpoIds.includes(user.id));
  const toggleAllBpos = () => update("bpoIds", allBposSelected ? [] : (data?.bpoUsers.map(user => user.id) || []));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/voices", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, telnyxCredentialId: form.telnyxCredentialId || null, groqCredentialId: form.groqCredentialId || null }),
      });
      const result = await json(response);
      if (!response.ok) throw new Error(result.message || "Unable to save admin voice.");
      await load(); setForm(null); onAction(result.message, "success");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save admin voice.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/voices?id=${encodeURIComponent(confirm.id)}`, { method: "DELETE" });
      const result = await json(response);
      if (!response.ok) throw new Error(result.message || "Unable to delete admin voice.");
      setData(current => current ? { ...current, voices: current.voices.filter(voice => voice.id !== result.deletedId) } : current);
      setConfirm(null); onAction(result.message, "success");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to delete admin voice.");
    } finally { setBusy(false); }
  };

  return <section className="admin-voices-section">
    <div className="admin-voices-heading">
      <div><p>VOICE PROFILES</p><h2>Admin Voices</h2><span>Create reusable Telnyx AI Assistant and Groq voice profiles, then assign them to BPO users.</span></div>
      <button className="admin-primary" onClick={() => { setError(""); setForm({ ...blank }); }}><FiPlus /> Create voice</button>
    </div>

    {!data ? <div className="admin-voice-grid" aria-busy="true">{[1, 2, 3].map(item => <div className="admin-voice-skeleton bpo-shimmer" key={item} />)}</div>
      : data.voices.length ? <div className="admin-voice-grid">{data.voices.map(voice => <article className="admin-voice-card" key={voice.id}>
        <header><span><FiMic /></span><div><h3>{voice.name}</h3><p>{voice.gender.charAt(0) + voice.gender.slice(1).toLowerCase()} · {voice.accent}</p></div><em className={voice.status.toLowerCase()}>{voice.status}</em></header>
        <div className="admin-voice-providers">
          <span className={voice.telnyx_label ? "ready" : "missing"}><FiPhoneCall /><small>Telnyx Assistant</small><b>{voice.telnyx_label || "Not configured"}</b></span>
          <span className={voice.groq_label ? "ready" : "missing"}><FiKey /><small>Groq AI</small><b>{voice.groq_label || "Not configured"}</b></span>
        </div>
        <div className="admin-voice-assigned"><FiUsers /><div><small>Assigned BPO users</small>{voice.assigned_bpos.length ? <p>{voice.assigned_bpos.map(user => <span key={user.id}>{user.name}</span>)}</p> : <b>Not assigned yet</b>}</div></div>
        <footer><button onClick={() => edit(voice)}><FiEdit3 /> Edit voice</button><button className="danger" onClick={() => { setError(""); setConfirm(voice); }}><FiTrash2 /></button></footer>
      </article>)}</div>
      : <div className="admin-voices-empty"><FiMic /><h3>Give your team a voice</h3><p>Create a voice profile, connect its AI credentials and assign it to your BPO teams.</p><button type="button" className="admin-primary" onClick={() => { setError(""); setForm({ ...blank }); }}><FiPlus /> Create your first voice</button></div>}

    {form && data && <div className="agent-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && setForm(null)}><form className="agent-modal admin-voice-modal" onSubmit={save}>
      <header><div><p>{form.id ? "EDIT ADMIN VOICE" : "NEW ADMIN VOICE"}</p><h2>{form.id ? `Edit ${form.name}` : "Create agent voice"}</h2></div><button type="button" disabled={busy} onClick={() => setForm(null)}><FiX /></button></header>
      <div className="admin-voice-form-grid">
        <label>Voice name<input required value={form.name} onChange={event => update("name", event.target.value)} placeholder="e.g. Sales Voice UK" /></label>
        <label>Accent / persona<input required value={form.accent} onChange={event => update("accent", event.target.value)} placeholder="Professional British" /></label>
        <label>Gender<CustomDropdown value={form.gender} onChange={value => update("gender", value as VoiceForm["gender"])} ariaLabel="Voice gender" options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} /></label>
        <label>Status<CustomDropdown value={form.status} onChange={value => update("status", value as VoiceForm["status"])} ariaLabel="Voice status" options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]} /></label>
        <label>Telnyx AI Assistant<CustomDropdown value={form.telnyxCredentialId} onChange={value => update("telnyxCredentialId", value)} ariaLabel="Telnyx AI Assistant" options={[{ value: "", label: "No Telnyx assistant" }, ...data.credentials.filter(item => item.provider === "TELNYX").map(item => ({ value: item.id, label: `${item.label}${item.config?.assistantId ? ` · ${item.config.assistantId}` : ""}` }))]} /></label>
        <label>Groq voice<CustomDropdown value={form.groqCredentialId} onChange={value => update("groqCredentialId", value)} ariaLabel="Groq voice" options={[{ value: "", label: "No Groq voice" }, ...data.credentials.filter(item => item.provider === "GROQ").map(item => ({ value: item.id, label: `${item.label}${item.config?.ttsModel ? ` · ${item.config.ttsModel}` : ""}` }))]} /></label>
      </div>
      <fieldset className="admin-voice-bpo-picker"><legend><span>Assign to BPO users</span>{data.bpoUsers.length > 0 && <button type="button" className="admin-voice-select-all" onClick={toggleAllBpos}>{allBposSelected ? "Deselect all BPO users" : "Select all BPO users"}</button>}</legend>{data.bpoUsers.length ? <div>{data.bpoUsers.map(user => <label key={user.id} className={form.bpoIds.includes(user.id) ? "is-selected" : ""}><input type="checkbox" checked={form.bpoIds.includes(user.id)} onChange={() => toggleBpo(user.id)} /><span className="admin-voice-bpo-switch" aria-hidden="true"><i /></span><span><b>{user.name}</b><small>{user.email || "No email"}</small></span><em>{user.status}</em></label>)}</div> : <p>No BPO users are available yet.</p>}</fieldset>
      {error && <p className="agent-form-error">{error}</p>}
      <footer><button type="button" className="admin-outline" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="admin-primary" disabled={busy || (!form.telnyxCredentialId && !form.groqCredentialId)}>{busy ? "Saving…" : form.id ? "Save changes" : "Create voice"}</button></footer>
    </form></div>}

    {confirm && <div className="agent-modal-backdrop"><section className="agent-modal admin-voice-delete"><header><div><p>DELETE ADMIN VOICE</p><h2>Delete {confirm.name}?</h2></div><button disabled={busy} onClick={() => setConfirm(null)}><FiX /></button></header><p>This removes the voice from every assigned BPO workspace.</p>{error && <p className="agent-form-error">{error}</p>}<footer><button className="admin-outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button className="admin-primary danger-button" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete voice"}</button></footer></section></div>}
  </section>;
}
