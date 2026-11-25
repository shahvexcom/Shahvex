"use client";
import { useEffect, useRef, useState } from "react";
import { FiVolume2 } from "react-icons/fi";
import { conversationStyles } from "@/lib/agent-script-details";
import { CustomSelect } from "./custom-select";
import { AdminSkeleton } from "./admin-skeleton";

type Settings = {
  company_name?: string;
  campaign_definition_id?: string;
  local_voice_id?: string;
  conversation_style?: string;
  speaks_first?: string;
  language?: string;
  accent?: string;
  gender?: string;
};
type Voice = {
  id: string;
  name: string;
  gender: string;
  accent: string;
  language: string;
};

export function AgentVoiceFields({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (value: Settings) => void;
}) {
  const [voices, setVoices] = useState<Voice[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [previewing, setPreviewing] = useState(false);
  const output = useRef<AudioContext | null>(null),
    cancel = useRef<AbortController | null>(null);
  useEffect(() => {
    let valid = true;
    fetch("/api/admin/local-voices", { signal: AbortSignal.timeout(20000) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (valid) {
          setVoices(d.voices);
          setServiceReady(d.serviceReady !== false);
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
      cancel.current?.abort();
      if (output.current?.state !== "closed")
        void output.current?.close().catch(() => {});
    };
  }, [retry]);
  const [serviceReady, setServiceReady] = useState(true);
  const selected = voices.find((v) => v.id === value.local_voice_id);
  const preview = async () => {
    if (!selected) return;
    setError("");
    setPreviewing(true);
    const control = new AbortController();
    cancel.current?.abort();
    cancel.current = control;
    if (output.current?.state !== "closed")
      void output.current?.close().catch(() => {});
    try {
      const ctx = new AudioContext();
      output.current = ctx;
      await ctx.resume();
      const r = await fetch("/api/admin/agent-test?action=preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: selected.id }),
        signal: control.signal,
      });
      if (!r.ok) throw Error((await r.json()).error);
      const audio = await ctx.decodeAudioData(await r.arrayBuffer());
      control.signal.throwIfAborted();
      const source = ctx.createBufferSource();
      source.buffer = audio;
      source.connect(ctx.destination);
      source.onended = () => {
        if (output.current === ctx) setPreviewing(false);
        if (ctx.state !== "closed") void ctx.close();
      };
      source.start();
    } catch (e) {
      if (!control.signal.aborted) {
        setError(e instanceof Error ? e.message : "Preview failed");
        setPreviewing(false);
      }
    }
  };
  return (
    <div className="sv-agent-ai-fields">
      <label>
        Gender
        <CustomSelect
          value={value.gender || "OTHER"}
          onChange={(e) =>
            onChange({ gender: e.target.value, local_voice_id: "" })
          }
        >
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Any voice</option>
        </CustomSelect>
      </label>
      {loading ? (
        <AdminSkeleton rows={3} label="Loading local agent voices" />
      ) : (
        <>
          <label>
            Agent Voice
            <CustomSelect
              required
              aria-label="Agent Voice"
              value={value.local_voice_id || ""}
              onChange={(e) => {
                cancel.current?.abort();
                if (output.current?.state !== "closed")
                  void output.current?.close().catch(() => {});
                setPreviewing(false);
                const v = voices.find((v) => v.id === e.target.value);
                if (v)
                  onChange({
                    local_voice_id: v.id,
                    gender:
                      v.gender.toUpperCase() === "MALE"
                        ? "MALE"
                        : v.gender.toUpperCase() === "FEMALE"
                          ? "FEMALE"
                          : "OTHER",
                    accent: v.accent,
                    language: "English",
                  });
              }}
            >
              <option value="">Select a voice</option>
              {value.local_voice_id && !selected && (
                <option value={value.local_voice_id}>
                  Saved voice unavailable: {value.local_voice_id}
                </option>
              )}
              {voices
                .filter(
                  (v) =>
                    !value.gender ||
                    value.gender === "OTHER" ||
                    v.gender.toUpperCase() === value.gender,
                )
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.gender} · {v.accent || "Accent not provided"}{" "}
                    · English
                  </option>
                ))}
            </CustomSelect>
          </label>
          <button
            className="admin-outline sv-agent-preview"
            type="button"
            disabled={
              !selected ||
              previewing ||
              (!serviceReady &&
                !["emma", "olivia", "lauren"].includes(
                  value.local_voice_id || "",
                ))
            }
            onClick={() => void preview()}
          >
            <FiVolume2 aria-hidden="true" />
            {previewing ? "Playing preview…" : "Preview voice"}
          </button>
        </>
      )}
      <label>
        Conversation Style
        <CustomSelect
          aria-label="Conversation Style"
          value={value.conversation_style || "Professional"}
          onChange={(e) => onChange({ conversation_style: e.target.value })}
        >
          {conversationStyles.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </CustomSelect>
      </label>
      <label>
        Who Speaks First
        <CustomSelect
          aria-label="Who Speaks First"
          value={value.speaks_first || "customer"}
          onChange={(e) => onChange({ speaks_first: e.target.value })}
        >
          <option value="customer">Customer Speaks First</option>
          <option value="ai">AI Speaks First</option>
        </CustomSelect>
      </label>
      {!serviceReady && (
        <p role="status">
          Saved previews are available for Emma, Olivia, and Lauren. Start the
          voice service for live calls.
        </p>
      )}
      {error && (
        <p role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setError("");
              setLoading(true);
              setRetry((v) => v + 1);
            }}
          >
            Reload voices
          </button>
        </p>
      )}
    </div>
  );
}
