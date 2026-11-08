"use client";
import { CustomSelect } from "@/app/components/custom-select";
import { useState } from "react";
import { FiKey, FiSave, FiX } from "react-icons/fi";
import { LocalAgentVoiceTest } from "./local-agent-voice-test";

type Credential = { id: string; provider: "GROQ" | "TELNYX"; label: string };
type Assignment = {
  agent_id: string;
  provider: "GROQ" | "TELNYX";
  credential_id: string;
};

export function AgentCredentialCell({
  agentId,
  groqLabel,
  telnyxLabel,
  agentName,
  avatarUrl,
}: {
  agentId: string;
  groqLabel?: string;
  telnyxLabel?: string;
  agentName?: string;
  avatarUrl?: string;
}) {
  const [open, setOpen] = useState(false),
    [credentials, setCredentials] = useState<Credential[]>([]),
    [groq, setGroq] = useState(""),
    [telnyx, setTelnyx] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const show = async () => {
    setOpen(true);
    setError("");
    try {
      const response = await fetch("/api/admin/agent-credentials");
      const data = await response.json();
      if (!response.ok) throw Error(data.message);
      const mine = data.assignments.filter(
        (item: Assignment) => item.agent_id === agentId,
      );
      setCredentials(data.credentials);
      setGroq(
        mine.find((item: Assignment) => item.provider === "GROQ")
          ?.credential_id || "",
      );
      setTelnyx(
        mine.find((item: Assignment) => item.provider === "TELNYX")
          ?.credential_id || "",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load credentials.",
      );
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/agent-credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          groqCredentialId: groq || null,
          telnyxCredentialId: telnyx || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.message);
      setOpen(false);
      window.location.reload();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save credentials.",
      );
    } finally {
      setBusy(false);
    }
  };
  const groqOptions = credentials.filter((item) => item.provider === "GROQ"),
    telnyxOptions = credentials.filter((item) => item.provider === "TELNYX");
  return (
    <>
      <div className="agent-credential-summary">
        <LocalAgentVoiceTest agentId={agentId} agentName={agentName} avatarUrl={avatarUrl} />
        <small>
          Groq: <b>{groqLabel || "Not assigned"}</b>
        </small>
        <small>
          Telnyx: <b>{telnyxLabel || "Not assigned"}</b>
        </small>
        <button type="button" onClick={show}>
          <FiKey /> Manage
        </button>
      </div>
      {open && (
        <div className="credential-modal-backdrop">
          <section className="credential-modal" role="dialog" aria-modal="true">
            <header>
              <div>
                <p>AGENT AI ACCESS</p>
                <h2>Assign credentials</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <FiX />
              </button>
            </header>
            <label>
              Groq AI credential
              <CustomSelect
                value={groq}
                onChange={(event) => setGroq(event.target.value)}
              >
                <option value="">No Groq access</option>
                {groqOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </CustomSelect>
            </label>
            <label>
              Telnyx credential
              <CustomSelect
                value={telnyx}
                onChange={(event) => setTelnyx(event.target.value)}
              >
                <option value="">No Telnyx access</option>
                {telnyxOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </CustomSelect>
            </label>
            {error && <p className="agent-form-error">{error}</p>}
            <footer>
              <button
                type="button"
                className="admin-outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-primary"
                disabled={busy}
                onClick={save}
              >
                <FiSave /> {busy ? "Saving..." : "Save assignment"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
