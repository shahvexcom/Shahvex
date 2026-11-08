"use client";

import { useEffect, useState } from "react";
import { FiCheckCircle, FiChevronLeft, FiChevronRight, FiEdit2, FiKey, FiMic, FiPhoneCall, FiPlus, FiTrash2 } from "react-icons/fi";
import { AgentCredentialAssignments } from "./agent-credential-assignments";

type Provider = "GROQ" | "TELNYX";
type Credential = { id: string; provider: Provider; label: string; config: { ttsModel?: string; sttModel?: string; connectionId?: string; outboundNumber?: string; assistantId?: string }; created_at: string; updated_at: string };
type Data = { credentials: Credential[]; kpis: { groq: number; telnyx: number; total: number; updated_this_month: number } };
const blank = { id: "", label: "", apiKey: "", ttsModel: "canopylabs/orpheus-v1-english", sttModel: "whisper-large-v3-turbo", connectionId: "", outboundNumber: "", assistantId: "" };
const PAGE_SIZE = 5;

async function responseData(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : { message: `Request failed (${response.status}).` };
  } catch {
    return { message: `Request failed (${response.status}). Please try again.` };
  }
}

export function AiCredentials({ onAction }: { onAction: (message: string) => void }) {
  const [data, setData] = useState<Data | null>(null), [provider, setProvider] = useState<Provider>("GROQ"), [form, setForm] = useState(blank), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [confirm, setConfirm] = useState<Credential | null>(null), [page, setPage] = useState(1);
  const load = async () => {
    try { const response = await fetch("/api/admin/credentials"); const json = await responseData(response); if (!response.ok) throw Error(json.message); setData(json); } catch (error) { onAction(error instanceof Error ? error.message : "Unable to load credentials."); }
  };
  useEffect(() => {
    fetch("/api/admin/credentials")
      .then(async response => {
        const json = await responseData(response);
        if (!response.ok) throw Error(json.message);
        return json as Data;
      })
      .then(setData)
      .catch(error => onAction(error instanceof Error ? error.message : "Unable to load credentials."));
  }, [onAction]);
  const reset = (next = provider) => { setProvider(next); setForm(blank); setEditing(false); setPage(1); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      // An empty edit field means "keep the encrypted key", not an invalid key.
      const { apiKey, ...credential } = form;
      const payload = { ...credential, provider, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
      const response = await fetch("/api/admin/credentials", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await responseData(response); if (!response.ok) throw Error(json.message);
      onAction(json.message); reset(provider); await load();
    } catch (error) { onAction(error instanceof Error ? error.message : "Unable to save credential."); } finally { setBusy(false); }
  };
  const edit = (credential: Credential) => { setProvider(credential.provider); setEditing(true); setForm({ ...blank, id: credential.id, label: credential.label, ttsModel: credential.config.ttsModel || "", sttModel: credential.config.sttModel || "", connectionId: credential.config.connectionId || "", outboundNumber: credential.config.outboundNumber || "", assistantId: credential.config.assistantId || "" }); };
  const remove = async () => {
    if (!confirm) return; setBusy(true);
    try { const response = await fetch(`/api/admin/credentials?id=${encodeURIComponent(confirm.id)}`, { method: "DELETE" }); const json = await responseData(response); if (!response.ok) throw Error(json.message); onAction(json.message); setConfirm(null); await load(); } catch (error) { onAction(error instanceof Error ? error.message : "Unable to delete credential."); } finally { setBusy(false); }
  };
  if (!data) return <CredentialsSkeleton />;
  const credentials = data.credentials.filter(item => item.provider === provider), pageCount = Math.max(1, Math.ceil(credentials.length / PAGE_SIZE)), currentPage = Math.min(page, pageCount), visibleCredentials = credentials.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), from = credentials.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0, to = Math.min(currentPage * PAGE_SIZE, credentials.length);
  const update = (key: keyof typeof blank, value: string) => setForm(current => ({ ...current, [key]: value }));
  return <>
    <div className="admin-page-head"><div><p>SECURE INTEGRATIONS</p><h1>AI Credentials</h1></div></div>
    <div className="credentials-kpis">
      <CredentialKpi icon={<FiKey />} label="Total credentials" value={data.kpis.total} />
      <CredentialKpi icon={<FiMic />} label="Groq voice keys" value={data.kpis.groq} />
      <CredentialKpi icon={<FiPhoneCall />} label="Telnyx VoIP keys" value={data.kpis.telnyx} />
      <CredentialKpi icon={<FiCheckCircle />} label="Updated this month" value={data.kpis.updated_this_month} />
    </div>
    <div className="credentials-tabs"><button className={provider === "GROQ" ? "active" : ""} onClick={() => reset("GROQ")}><FiMic /> Groq <small>TTS + STT</small></button><button className={provider === "TELNYX" ? "active" : ""} onClick={() => reset("TELNYX")}><FiPhoneCall /> Telnyx <small>VoIP</small></button></div>
    <div className="credentials-layout">
      <form className="admin-card credential-form" onSubmit={submit}>
        <div className="credentials-form-heading"><div><h2>{editing ? `Edit ${provider === "GROQ" ? "Groq" : "Telnyx"} credential` : `Add ${provider === "GROQ" ? "Groq" : "Telnyx"} credential`}</h2><p>{editing ? "Leave API key empty to keep the currently encrypted key." : "You can save as many credentials as your team needs."}</p></div><FiPlus /></div>
        <label>Credential name<input required value={form.label} onChange={e => update("label", e.target.value)} placeholder={provider === "GROQ" ? "Production voice account" : "Main calling account"} /></label>
        <label>{provider === "GROQ" ? "Groq API key" : "Telnyx API key"}<input type="password" required={!editing} value={form.apiKey} onChange={e => update("apiKey", e.target.value)} placeholder={editing ? "Leave empty to keep current key" : "Paste API key"} autoComplete="new-password" /></label>
        {provider === "GROQ" ? <div className="credential-fields"><label>TTS model<input value={form.ttsModel} onChange={e => update("ttsModel", e.target.value)} placeholder="TTS model" /></label><label>STT model<input value={form.sttModel} onChange={e => update("sttModel", e.target.value)} placeholder="STT model" /></label></div> : <div className="credential-fields"><label>Call Control App ID<small>Telnyx Portal → Call Control → your App ID. This is not a SIP Connection ID.</small><input value={form.connectionId} onChange={e => update("connectionId", e.target.value)} placeholder="Call Control App ID" /></label><label>Outbound number<input value={form.outboundNumber} onChange={e => update("outboundNumber", e.target.value)} placeholder="+1 555 000 0000" /></label><label>AI Assistant ID<small>Telnyx Portal → AI Assistants. This assistant handles live conversation and voice.</small><input value={form.assistantId} onChange={e => update("assistantId", e.target.value)} placeholder="assistant-..." /></label></div>}
        <div className="credential-form-actions">{editing && <button className="admin-outline" type="button" onClick={() => reset(provider)}>Cancel</button>}<button className="admin-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Update credential" : "Save credential"}</button></div>
      </form>
      <section className="admin-card credentials-list"><div className="card-heading"><div><h2>Saved {provider === "GROQ" ? "Groq" : "Telnyx"} credentials</h2><p>API keys are encrypted and never displayed.</p></div><span>{credentials.length}</span></div>{credentials.length ? <><div className="credentials-table-head"><span>Credential</span><span>Configuration</span><span>Updated</span><span>Actions</span></div>{visibleCredentials.map(credential => <article key={credential.id}><div className="credential-provider-icon">{provider === "GROQ" ? <FiMic /> : <FiPhoneCall />}</div><div><b>{credential.label}</b><small>{provider === "GROQ" ? "Groq TTS + STT" : "Telnyx VoIP"}</small></div><small className="credential-config">{provider === "GROQ" ? `${credential.config.ttsModel || "TTS"} · ${credential.config.sttModel || "STT"}` : credential.config.outboundNumber || credential.config.connectionId || "VoIP configuration"}</small><time>Updated {new Date(credential.updated_at).toLocaleDateString()}</time><span className="credential-actions"><button aria-label={`Edit ${credential.label}`} onClick={() => edit(credential)}><FiEdit2 /></button><button aria-label={`Delete ${credential.label}`} className="credential-delete" onClick={() => setConfirm(credential)}><FiTrash2 /></button></span></article>)}<div className="credentials-pagination"><small>Showing {from}–{to} of {credentials.length}</small><div><button aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><FiChevronLeft /></button>{Array.from({ length: pageCount }, (_, index) => index + 1).map(number => <button key={number} className={number === currentPage ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}<button aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><FiChevronRight /></button></div></div></> : <div className="credentials-empty"><FiKey /><b>No credentials saved yet</b><p>Add your first {provider === "GROQ" ? "Groq TTS/STT" : "Telnyx VoIP"} credential using this form.</p></div>}</section>
    </div>
    <AgentCredentialAssignments onAction={onAction} />
    {confirm && <div className="settings-confirm"><div><FiTrash2 /><h2>Delete credential?</h2><p>{confirm.label} will be permanently removed.</p><button onClick={() => setConfirm(null)}>Cancel</button><button className="danger" disabled={busy} onClick={remove}>Delete</button></div></div>}
  </>;
}
function CredentialKpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) { return <section className="admin-stat"><span>{icon}</span><p>{label}</p><strong>{value}</strong></section>; }
function CredentialsSkeleton() {
  return <>
    <div className="admin-page-head"><div><p>SECURE INTEGRATIONS</p><h1>AI Credentials</h1></div></div>
    <div className="credentials-kpis" aria-label="Loading credential statistics">
      {["total", "groq", "telnyx", "updates"].map(item => <section className="admin-stat credential-skeleton-card" key={item}><i /><b /><strong /></section>)}
    </div>
    <div className="credentials-tabs credentials-tabs-loading"><span /><span /></div>
    <div className="credentials-layout" aria-label="Loading saved credentials">
      <section className="admin-card credential-form credential-skeleton-form"><i /><b /><b /><div><b /><b /></div><em /></section>
      <section className="admin-card credentials-list credential-skeleton-list"><i />{[1, 2, 3].map(item => <article key={item}><span /><div><b /><small /><small /></div></article>)}</section>
    </div>
  </>;
}
