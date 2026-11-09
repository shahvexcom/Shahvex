"use client";
import { CustomDropdown } from "./custom-dropdown";
import { ResendOtp } from "./resend-otp";
import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  FiUser,
  FiAtSign,
  FiLock,
  FiEye,
  FiEyeOff,
  FiMic,
} from "react-icons/fi";

const accents = [
  "Natural",
  "Professional",
  "Deep",
  "Warm",
  "Conversational",
  "Calm",
];
const genders = ["Female", "Male", "Other"];
export function AuthForm({ mode, portal = "agent" }: { mode: "login" | "register"; portal?: "agent" | "bpo" }) {
  const isRegister = mode === "register";
  const [show, setShow] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [accent, setAccent] = useState("");
  const [gender, setGender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [legal, setLegal] = useState<"privacy" | "terms" | null>(null);
  const [availability, setAvailability] = useState({ name: "", username: "" });
  const [verifyMode, setVerifyMode] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [otp, setOtp] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  async function check(field: "name" | "username", value: string) {
    if (value.trim().length < 3) return;
    try {
      const r = await fetch(
        `/api/auth/check?field=${field}&value=${encodeURIComponent(value)}`,
      );
      const raw = await r.text();
      const d = raw ? JSON.parse(raw) : { available: false };
      setAvailability((x) => ({
        ...x,
        [field]: d.available ? "Available" : "Already in use",
      }));
    } catch {
      setAvailability((x) => ({ ...x, [field]: "Unable to check" }));
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verifyMode) return;
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    const values = {
      name: String(f.get("name") || ""),
      username: String(f.get("username") || ""),
      password: String(f.get("password") || ""),
    };
    if (isRegister && values.name.trim().length < 2)
      return setError("Full name must be at least 2 characters.");
    if (values.username.trim().length < 3)
      return setError("Username must be at least 3 characters.");
    if (isRegister && portal === "agent" && !gender) return setError("Please select a voice gender.");
    if (isRegister && portal === "agent" && !accent)
      return setError("Please select an accent / lehja.");
    if (values.password.length < 8)
      return setError("Password must be at least 8 characters.");
    if (isRegister && !confirmed)
      return setError(
        "Please turn on the confirmation switch before submitting.",
      );
    setBusy(true);
    try {
      const body: Record<string, unknown> = Object.fromEntries(f);
      body.portal = portal;
      body.gender = portal === "bpo" ? "OTHER" : gender.toUpperCase();
      body.accent = portal === "bpo" ? "Professional" : accent;
      body.confirmed = confirmed;
      if (requiresTwoFactor) body.otp = loginOtp;
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await r.text();
      const d = raw
        ? JSON.parse(raw)
        : { message: "The server returned an empty response." };
      setBusy(false);
      if (d.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setMessage("Enter the OTP from your authenticator app.");
      } else if (!r.ok) { setError(d.message); setTimeout(() => setError(""), 5000); }
      else {
        setMessage(d.message); setTimeout(() => setMessage(""), 5000);
        if (portal === "bpo" && isRegister) {
          setVerificationToken(d.verificationToken || "");
          setVerifyMode(true);
        } else if (d.redirectTo) window.location.assign(portal === "bpo" ? "/bpo/login" : "/agent");
      }
    } catch {
      setBusy(false);
      setError("Could not reach the server. Please try again.");
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-aside">
        <Link href="/" className="auth-logo">
          <img src="/img/logo.png.png" width="240" height="56" alt="Shahvex"  data-tooltip="" />
        </Link>
        <div className="auth-pitch">
          <p>{portal === "bpo" ? "BPO VOICE OPERATIONS" : "INTELLIGENT VOICE OPERATIONS"}</p>
          <h1>{portal === "bpo" ? "Scale every client conversation." : "Every conversation, in the right voice."}</h1>
          <span>
            Language-aware AI that adapts to every client in real time — with
            the accent and empathy your service deserves.
          </span>
          <div className="voice-orbit">
            <FiMic />
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="auth-dots">
          <i />
          <i />
          <i />
        </div>
      </section>
      <section className="auth-content">
        <div className="auth-card">
          <Link href="/" className="auth-mobile-logo">
            <img src="/img/logo.png.png" width="200" height="47" alt="Shahvex"  data-tooltip="" />
          </Link>
          <p className="eyebrow">
            {isRegister ? (portal === "bpo" ? "JOIN AS A BPO" : "JOIN THE WORKSPACE") : (portal === "bpo" ? "BPO ACCESS" : "WELCOME BACK")}
          </p>
          <h1>
            {isRegister ? (portal === "bpo" ? "Create your BPO profile" : "Create your agent profile") : "Ready when you are"}
          </h1>
          <p className="muted">
            {isRegister
              ? portal === "bpo" ? "Set up your BPO workspace and start managing calling operations." : "Your profile will be reviewed before you start calling."
              : "Sign in to continue your calling workflow."}
          </p>
          <form onSubmit={submit}>
            {isRegister && portal === "bpo" && verifyMode && <Field icon={<FiLock />} label="6-digit email OTP"><input name="otp" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Enter OTP from email" /><button type="button" className="auth-submit" onClick={async () => { setError(""); setVerifyBusy(true); try { const r = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: verificationToken, otp }) }); const d = await r.json(); if (r.ok) { setMessage(d.message); setTimeout(() => window.location.assign("/bpo/login"), 900); } else setError(d.message); } catch { setError("Could not reach the server. Please try again."); } finally { setVerifyBusy(false); } }} disabled={verifyBusy || otp.length !== 6}>{verifyBusy ? "Verifying..." : "Verify email"}</button></Field>}
            {verifyMode && <ResendOtp token={verificationToken} onResent={() => { setOtp(""); setError(""); }} />}
            {isRegister && !verifyMode && (
              <>
                <Field icon={<FiUser />} label="Full name">
                  <input
                    name="name"
                    placeholder="Ayesha Rahman"
                    onBlur={(e) => check("name", e.target.value)}
                  />
                  {availability.name && (
                    <small
                      className={
                        availability.name === "Available"
                          ? "available"
                          : "taken"
                      }
                    >
                      {availability.name}
                    </small>
                  )}
                </Field>
                {portal === "bpo" && <Field icon={<FiAtSign />} label="Email">
                  <input name="email" type="email" placeholder="you@company.com" required autoComplete="email" />
                </Field>}
                <Field icon={<FiAtSign />} label="Username">
                  <input
                    name="username"
                    placeholder="ayesha.rahman"
                    onBlur={(e) => check("username", e.target.value)}
                  />
                  {availability.username && (
                    <small
                      className={
                        availability.username === "Available"
                          ? "available"
                          : "taken"
                      }
                    >
                      {availability.username}
                    </small>
                  )}
                </Field>
                {portal === "agent" && <div className="two-fields">
                  <Field icon={<FiUser />} label="Voice gender">
                    <Picker
                      value={gender || "Select gender"}
                      options={genders}
                      onSelect={(v) => {
                        setGender(v);
                      }}
                    />
                  </Field>
                  <Field icon={<FiMic />} label="Accent / lehja">
                    <Picker
                      value={accent || "Choose accent"}
                      options={accents}
                      onSelect={(v) => {
                        setAccent(v);
                      }}
                    />
                  </Field>
                </div>}
              </>
            )}
            {!isRegister && (
              <Field icon={<FiAtSign />} label="Username">
                <input
                  name="username"
                  placeholder="Your username"
                  autoComplete="username"
                />
              </Field>
            )}
            {!verifyMode && <Field icon={<FiLock />} label="Password">
              <div className="password-wrap">
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  autoComplete={
                    isRegister ? "new-password" : "current-password"
                  }
                />
                <button type="button" onClick={() => setShow(!show)}>
                  {show ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
            </Field>}
            {!isRegister && portal === "bpo" && requiresTwoFactor && <Field icon={<FiLock />} label="Authenticator OTP"><input value={loginOtp} onChange={e=>setLoginOtp(e.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" maxLength={6} placeholder="6-digit OTP" required /></Field>}
            {isRegister && portal === "bpo" && !verifyMode && <Field icon={<FiLock />} label="Confirm password">
              <input name="confirmPassword" type="password" placeholder="Re-enter your password" required minLength={8} autoComplete="new-password" />
            </Field>}
            {isRegister && !verifyMode && (
              <label className="toggle-row">
                <button
                  type="button"
                  className={`switch ${confirmed ? "on" : ""}`}
                  onClick={() => setConfirmed(!confirmed)}
                >
                  <i />
                </button>
                <span>I agree to the Shahvex <button type="button" className="legal-link" onClick={() => setLegal("privacy")}>Privacy Policy</button> and <button type="button" className="legal-link" onClick={() => setLegal("terms")}>Terms &amp; Conditions</button>.</span>
              </label>
            )}
            {error && <p className="form-message error">{error}</p>}
            {message && <p className="form-message success">{message}</p>}
            {!verifyMode && <button className="auth-submit" disabled={busy}>
              {busy
                ? "Please wait..."
                : isRegister
                  ? portal === "bpo" ? "Register now" : "Submit for approval"
                  : "Sign in"}
            </button>}
          </form>
          <p className="auth-switch">
            {isRegister ? "Already registered?" : portal === "bpo" ? "New BPO?" : "New AI agent?"}{" "}
            <Link href={isRegister ? portal === "bpo" ? "/bpo/login" : "/login" : portal === "bpo" ? "/bpo/register" : "/register"}>
              {isRegister ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
      </section>
      {legal && <div className="legal-modal-backdrop" role="presentation" onClick={() => setLegal(null)}><section className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="auth-legal-title" onClick={(event) => event.stopPropagation()}><div className="legal-modal-head"><div><p className="public-eyebrow">Shahvex · POLICY CENTRE</p><h2 id="auth-legal-title">{legal === "privacy" ? "Privacy Policy" : "Terms & Conditions"}</h2><span>Last updated September 2026</span></div><button className="legal-modal-close" type="button" onClick={() => setLegal(null)} aria-label="Close policy">×</button></div><div className="legal-modal-body"><div className="legal-highlight"><b>{legal === "privacy" ? "Your privacy, clearly explained" : "Use the platform responsibly"}</b><span>{legal === "privacy" ? "We protect your account and calling data while operating your workspace." : "These guidelines keep calling operations safe and clear for every team."}</span></div>{legal === "privacy" ? <><h3>Information we collect</h3><p>We collect details you provide, including your name, email, phone number and account information.</p><h3>How we use information</h3><p>We use information to provide voice operations, secure accounts and improve the service. We do not sell personal information.</p></> : <><h3>Your account</h3><p>Provide accurate information and keep your login credentials secure.</p><h3>Calling operations</h3><p>Use Shahvex only for lawful, authorised communications and follow applicable privacy requirements.</p><h3>Platform access</h3><p>We may review or suspend access when an account is misused.</p></>}</div><div className="legal-modal-foot"><span>Use Shahvex responsibly and keep your workspace secure.</span><button type="button" onClick={() => setLegal(null)}>Got it</button></div></section></div>}
    </main>
  );
}
function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span>
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}
function Picker({value,options,onSelect}:{value:string;options:string[];onSelect:(v:string)=>void}) {
  return <CustomDropdown className="custom-picker" triggerClassName="custom-select" value={value} placeholder={value} options={options.map(option=>({value:option,label:option}))} onChange={onSelect} ariaLabel={options.includes("Male")?"Voice gender":"Accent"}/>;
}
