"use client";
import { CustomSelect } from "@/app/components/custom-select";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { FiKey, FiSave } from "react-icons/fi";

type Agent = { id: string; name: string; username: string };
type Credential = { id: string; provider: "GROQ" | "TELNYX"; label: string };
type Assignment = { agent_id: string; provider: "GROQ" | "TELNYX"; credential_id: string };

async function responseData(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : { message: `Request failed (${response.status}).` };
  } catch {
    return { message: `Request failed (${response.status}). Please try again.` };
  }
}

export function AgentCredentialAssignments({ onAction }: { onAction: (message: string) => void }) {
  const [agents, setAgents] = useState<Agent[]>([]), [credentials, setCredentials] = useState<Credential[]>([]), [assignments, setAssignments] = useState<Assignment[]>([]), [agentId, setAgentId] = useState(""), [groqCredentialId, setGroqCredentialId] = useState(""), [telnyxCredentialId, setTelnyxCredentialId] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { const response = await fetch("/api/admin/agent-credentials"); const data = await responseData(response); if (!response.ok) return onAction(data.message || "Unable to load agent credentials."); setAgents(data.agents); setCredentials(data.credentials); setAssignments(data.assignments); if (!agentId && data.agents[0]) setAgentId(data.agents[0].id); };
  useEffect(() => { load(); }, []);
  const current = useMemo(() => assignments.filter(item => item.agent_id === agentId), [assignments, agentId]);
  useEffect(() => { setGroqCredentialId(current.find(item => item.provider === "GROQ")?.credential_id || ""); setTelnyxCredentialId(current.find(item => item.provider === "TELNYX")?.credential_id || ""); }, [agentId, current]);
  const save = async () => { if (!agentId) return onAction("Create an agent first."); setBusy(true); try { const response = await fetch("/api/admin/agent-credentials", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, groqCredentialId: groqCredentialId || null, telnyxCredentialId: telnyxCredentialId || null }) }); const data = await responseData(response); if (!response.ok) throw Error(data.message); onAction(data.message); await load(); } catch (error) { onAction(error instanceof Error ? error.message : "Unable to save credential assignment."); } finally { setBusy(false); } };
  const groq = credentials.filter(item => item.provider === "GROQ"), telnyx = credentials.filter(item => item.provider === "TELNYX");
  return <section className="admin-card agent-credential-assignment"><div className="card-heading"><div><h2>Assign credentials to agent</h2><p>Each agent can only use the Groq and Telnyx credentials selected here.</p></div><FiKey /></div><div className="agent-credential-fields"><label>Agent<CustomSelect value={agentId} onChange={event => setAgentId(event.target.value)}><option value="">Select agent</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} (@{agent.username})</option>)}</CustomSelect></label><label>Groq AI credential<CustomSelect value={groqCredentialId} onChange={event => setGroqCredentialId(event.target.value)}><option value="">No Groq access</option>{groq.map(credential => <option key={credential.id} value={credential.id}>{credential.label}</option>)}</CustomSelect></label><label>Telnyx credential<CustomSelect value={telnyxCredentialId} onChange={event => setTelnyxCredentialId(event.target.value)}><option value="">No Telnyx access</option>{telnyx.map(credential => <option key={credential.id} value={credential.id}>{credential.label}</option>)}</CustomSelect></label></div><button type="button" className="admin-primary" disabled={busy || !agentId} onClick={save}><FiSave /> {busy ? "Saving..." : "Save assignment"}</button></section>;
}
