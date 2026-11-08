"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { FiCheckCircle, FiCopy, FiKey, FiShield, FiX } from "react-icons/fi";
import toast from "react-hot-toast";
import QRCode from "qrcode";

type TwoFactorCardProps = {
  enabled: boolean;
  onStatusChange?: (enabled: boolean) => void;
};

const emptyOtp = () => Array.from({ length: 6 }, () => "");

export default function BpoTwoFactorCard({ enabled, onStatusChange }: TwoFactorCardProps) {
  const [active, setActive] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"setup" | "disable" | null>(null);
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [otp, setOtp] = useState<string[]>(emptyOtp);
  const [password, setPassword] = useState("");
  const otpInputs = useRef<Array<HTMLInputElement | null>>([]);
  const code = otp.join("");

  useEffect(() => {
    if (!uri) return;

    let cancelled = false;
    QRCode.toDataURL(uri, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#3c342d", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!cancelled) setQrCode(dataUrl);
    }).catch(() => {
      if (!cancelled) toast.error("QR code could not be generated. Please use the setup key.");
    });

    return () => { cancelled = true; };
  }, [uri]);

  const call = async (action: string, body: Record<string, string> = {}) => {
    setBusy(true);
    try {
      const response = await fetch("/api/bpo/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update two-factor authentication.");
      return data;
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    setModal(null);
    setSecret("");
    setUri("");
    setQrCode("");
    setOtp(emptyOtp());
    setPassword("");
  };

  const startSetup = async () => {
    setQrCode("");
    const data = await call("setup");
    if (!data) return;
    setSecret(data.secret);
    setUri(data.uri);
    setOtp(emptyOtp());
    setModal("setup");
  };

  const copySecret = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(secret);
      } else {
        const input = document.createElement("textarea");
        input.value = secret;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Copy failed");
      }
      toast.success("Authenticator key copied.");
    } catch {
      toast.error("Could not copy the key. Please copy it manually.");
    }
  };

  const updateOtp = (index: number, value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      const next = [...otp];
      digits.slice(0, 6 - index).split("").forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      setOtp(next);
      otpInputs.current[Math.min(index + digits.length, 5)]?.focus();
      return;
    }

    const next = [...otp];
    next[index] = digits;
    setOtp(next);
    if (digits && index < 5) otpInputs.current[index + 1]?.focus();
  };

  const pasteOtp = (index: number, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 6 - index);
    if (!digits) return;
    const next = [...otp];
    digits.split("").forEach((digit, offset) => {
      next[index + offset] = digit;
    });
    setOtp(next);
    otpInputs.current[Math.min(index + digits.length, 5)]?.focus();
  };

  const verify = async () => {
    const data = await call("verify", { code });
    if (!data) return;
    setActive(true);
    onStatusChange?.(true);
    closeModal();
    toast.success("2FA is now enabled.");
  };

  const disable = async () => {
    const data = await call("disable", { currentPassword: password });
    if (!data) return;
    setActive(false);
    onStatusChange?.(false);
    closeModal();
    toast.success("2FA has been disabled.");
  };

  return (
    <article className="bpo-account-card bpo-2fa-card">
      <h2><FiShield /> Two-factor authentication</h2>
      <p className="bpo-card-note">Use an authenticator app to add an extra layer of security to your BPO account.</p>

      {active ? (
        <>
          <div className="bpo-2fa-enabled"><FiCheckCircle /> 2FA is enabled</div>
          <button className="bpo-settings-secondary" type="button" onClick={() => setModal("disable")}>Disable 2FA</button>
        </>
      ) : (
        <button className="bpo-settings-primary" type="button" disabled={busy} onClick={startSetup}>
          {busy ? "Preparing…" : "Set up authenticator"}
        </button>
      )}

      {modal === "setup" && (
        <div className="bpo-2fa-overlay" role="presentation">
          <section className="bpo-2fa-modal" role="dialog" aria-modal="true" aria-labelledby="bpo-2fa-setup-title">
            <button className="bpo-2fa-close" type="button" onClick={closeModal} disabled={busy} aria-label="Close authenticator setup"><FiX /></button>
            <div className="bpo-2fa-modal-icon"><FiKey /></div>
            <h2 id="bpo-2fa-setup-title">Set up authenticator</h2>
            <p>Scan this QR code with your authenticator app, then enter the six-digit code it generates.</p>

            <div className="bpo-qr" aria-label="Authenticator setup QR code">
              {qrCode ? <Image src={qrCode} alt="Scan this QR code with your authenticator app" width={180} height={180} unoptimized /> : <span>Generating QR code…</span>}
            </div>
            <p className="bpo-manual-key-note">Or enter this key manually in your authenticator app.</p>

            <div className="bpo-secret-row">
              <code aria-label="Authenticator setup key">{secret}</code>
              <button type="button" onClick={copySecret} aria-label="Copy authenticator key" data-tooltip="Copy key"><FiCopy /></button>
            </div>

            <label className="bpo-otp-label" htmlFor="bpo-otp-0">Authenticator code</label>
            <div className="bpo-otp-boxes" aria-label="Six-digit authenticator code">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => { otpInputs.current[index] = element; }}
                  id={`bpo-otp-${index}`}
                  value={digit}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  aria-label={`Authenticator code digit ${index + 1}`}
                  onChange={(event) => updateOtp(index, event.target.value)}
                  onPaste={(event) => { event.preventDefault(); pasteOtp(index, event.clipboardData.getData("text")); }}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && !otp[index] && index > 0) otpInputs.current[index - 1]?.focus();
                  }}
                />
              ))}
            </div>
            <button className="bpo-settings-primary" type="button" disabled={busy || code.length !== 6} onClick={verify}>
              {busy ? "Verifying…" : "Verify and enable"}
            </button>
          </section>
        </div>
      )}

      {modal === "disable" && (
        <div className="bpo-2fa-overlay" role="presentation">
          <section className="bpo-2fa-modal bpo-2fa-disable-modal" role="dialog" aria-modal="true" aria-labelledby="bpo-2fa-disable-title">
            <button className="bpo-2fa-close" type="button" onClick={closeModal} disabled={busy}><FiX /></button>
            <h2 id="bpo-2fa-disable-title">Disable 2FA?</h2>
            <p>Enter your current password to turn off authenticator protection for this account.</p>
            <label className="bpo-disable-password" htmlFor="bpo-disable-password">Current password
              <input id="bpo-disable-password" type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button className="bpo-settings-danger" type="button" disabled={busy || !password} onClick={disable}>
              {busy ? "Disabling…" : "Disable 2FA"}
            </button>
          </section>
        </div>
      )}
    </article>
  );
}
