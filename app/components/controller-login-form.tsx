"use client";

import { FormEvent, useState } from "react";
import { FiArrowRight, FiEye, FiEyeOff, FiLock, FiShield, FiUser } from "react-icons/fi";

export function ControllerLoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password"), portal: "admin" }) }); const data = await response.json(); if (!response.ok) setMessage(data.message || "Unable to sign in."); else window.location.assign("/controler"); } catch { setMessage("Could not reach the server. Please try again."); } finally { setBusy(false); }
  }
  return (
    <main className="controller-login admin-login-page">
      <a className="admin-login-home" href="/" aria-label="Shahvex home"><img src="/img/logo.png.png" width="220" height="73" alt="Shahvex" /></a>
      <section className="controller-login-card admin-login-card" aria-labelledby="admin-login-title">
        <div className="controller-lock"><FiShield /></div>
        <p>YOUR CONTROL CENTER</p>
        <h1 id="admin-login-title">Welcome back.</h1>
        <span>Sign in to keep your team, calls and workspace connected.</span>
        <form onSubmit={submit}>
          <label><span className="admin-login-label"><FiUser /> Username</span><input name="username" autoComplete="username" placeholder="Enter your admin username" required disabled={busy} /></label>
          <label><span className="admin-login-label"><FiLock /> Password</span><div className="controller-password"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required disabled={busy} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <FiEyeOff /> : <FiEye />}</button></div></label>
          {message && <div className="controller-error" role="alert">{message}</div>}
          <button className="controller-submit" disabled={busy}>{busy ? "Signing in..." : <>Sign in to control center <FiArrowRight /></>}</button>
        </form>
        <div className="admin-login-bpo"><span>Managing a BPO team?</span><a href="/bpo/login">BPO sign in <FiArrowRight /></a></div>
        <small className="admin-login-secure"><FiLock /> Secure access for your admin account</small>
      </section>
    </main>
  );
}
