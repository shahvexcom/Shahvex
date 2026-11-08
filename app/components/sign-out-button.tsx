"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FiLogOut, FiX } from "react-icons/fi";

type Portal = "agent" | "admin" | "bpo";

export function SignOutConfirmation({ portal, onCancel }: { portal: Portal; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  async function confirm() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portal }) });
      if (!response.ok) throw new Error("Could not sign out. Please try again.");
      window.location.assign(portal === "admin" ? "/controler/login" : portal === "bpo" ? "/bpo/login" : "/login");
    } catch { setError("Could not sign out. Please try again."); setBusy(false); }
  }
  return createPortal(<dialog className="shahvex-signout" ref={dialog} aria-labelledby="signout-title" aria-describedby="signout-description"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onCancel(); } }}>
    <button className="signout-close" type="button" aria-label="Close confirmation" disabled={busy} onClick={onCancel}><FiX /></button>
    <div className="signout-symbol"><FiLogOut /></div>
    <h2 id="signout-title">Sign out of Shahvex?</h2>
    <p id="signout-description">You’ll need to sign in again to access your workspace.</p>
    {error && <p role="alert" className="signout-error">{error}</p>}
    <div className="signout-actions"><button type="button" autoFocus disabled={busy} onClick={onCancel}>Stay signed in</button><button type="button" className="signout-confirm" disabled={busy} onClick={() => void confirm()}>{busy ? "Signing out…" : "Sign out"}</button></div>
  </dialog>, document.body);
}

export function SignOutButton({ portal, className, children, ariaLabel }: { portal: Portal; className?: string; children?: ReactNode; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={className} aria-label={ariaLabel} data-tooltip={ariaLabel} onClick={() => setOpen(true)}>{children || <><FiLogOut /> Sign out</>}</button>{open && <SignOutConfirmation portal={portal} onCancel={() => setOpen(false)} />}</>;
}
