"use client";
import { useEffect, useState } from "react";

export function ResendOtp({ token, initialDelay = 60, onResent }: { token: string; initialDelay?: number; onResent: () => void }) {
  const [deadline, setDeadline] = useState(() => Date.now() + initialDelay * 1000);
  const [remaining, setRemaining] = useState(initialDelay);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  async function resend() {
    if (busy || remaining) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/resend-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json();
      if (data.retryAfter) { setRemaining(data.retryAfter); setDeadline(Date.now() + data.retryAfter * 1000); }
      setMessage(data.message || "Could not resend. Please try again.");
      if (response.ok) onResent();
    } catch { setMessage("Could not reach the server. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="otp-resend"><p>Didn’t receive your code?</p><button type="button" disabled={busy || remaining > 0} onClick={() => void resend()}>{busy ? "Sending…" : remaining ? `Resend in ${remaining >= 3600 ? `${Math.ceil(remaining / 3600)}h` : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}` : "Resend OTP"}</button><small>Up to 5 resends daily and 150 monthly across all email verification processes.</small>{message && <p role="status">{message}</p>}</div>;
}
