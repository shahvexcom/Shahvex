"use client";
import { useCurrency, CurrencySelector } from "./currency-provider";
import { SignOutConfirmation } from "@/app/components/sign-out-button";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  FiClock,
  FiCreditCard,
  FiFileText,
  FiLogOut,
  FiMenu,
  FiMic,
  FiPhone,
  FiPlus,
  FiUser,
  FiUserPlus,
  FiX,
  FiZap,
  FiMessageCircle,
  FiSend,
} from "react-icons/fi";
import { FaWhatsapp, FaInstagram, FaFacebookMessenger } from "react-icons/fa6";
import BpoScriptPanel from "./bpo-script-workspace";
import BpoHistory from "./bpo-history";
import BpoAccountSettings from "./bpo-account-settings";
import BpoVoicesWorkspace from "./bpo-voices-workspace";
import BpoPlansWorkspace from "./bpo-plans-workspace";
import BpoAgentsWorkspace from "./bpo-agents-workspace";
import BpoDialingWorkspace from "./bpo-dialing-workspace";
import BpoQuickDial from "./bpo-quick-dial";
import "./bpo-workspace.css";
import "./bpo-layout-fix.css";
import "./bpo-equal-grid.css";
import "./bpo-final-grid.css";
import "./bpo-height-fix.css";
import "./bpo-2fa-modal.css";
import "./bpo-account-fixes.css";
type User = { name: string; email?: string; username?: string; avatar_url?: string; two_factor_enabled?: boolean; remaining_credits?: number };
type CreditContacts = { whatsappUrl: string; instagramUrl: string; messengerUrl: string };
const defaultCreditContacts: CreditContacts = {
  whatsappUrl: process.env.NEXT_PUBLIC_BPO_WHATSAPP || "https://wa.me/",
  instagramUrl: process.env.NEXT_PUBLIC_BPO_INSTAGRAM || "https://instagram.com/",
  messengerUrl: process.env.NEXT_PUBLIC_BPO_MESSENGER || "https://m.me/",
};
const dialing = ["Create Agent", "Voices", "Auto Dialing", "Manual Dialing", "Quick Dial"];
const availableTabs = ["Script", "History", "Plans", "Settings", ...dialing];
export default function BpoWorkspace({ user }: { user: User }) {
  const { formatMoney } = useCurrency();
  const [liveUser, setLiveUser] = useState(user);
  const [creditContacts, setCreditContacts] = useState(defaultCreditContacts);
  const [creditContactsLoading, setCreditContactsLoading] = useState(false);
  const [active, setActive] = useState("Script"),
    [menu, setMenu] = useState(false),
    [dialingOpen, setDialingOpen] = useState(false),
    [logoutOpen, setLogoutOpen] = useState(false),
    [creditsOpen, setCreditsOpen] = useState(false),
    [creditTab, setCreditTab] = useState<"crypto" | "manual" | "contact">("contact"),
    [mobileNavOpen, setMobileNavOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const initials = user.name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  useEffect(() => {
    const saved = localStorage.getItem("bpo-active-tab");
    const requested = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requested === "manual") setActive("Manual Dialing");
    else if (requested === "auto") setActive("Auto Dialing");
    else if (requested === "quick") setActive("Quick Dial");
    else if (saved && availableTabs.includes(saved)) setActive(saved);
    else if (saved) localStorage.removeItem("bpo-active-tab");
  }, []);
  useEffect(() => {
    let mounted = true;
    let syncing = false;
    const syncAccount = async () => {
      if (syncing || document.visibilityState === "hidden") return;
      syncing = true;
      try {
        const response = await fetch("/api/auth/me?portal=bpo", { cache: "no-store" });
        if (response.status === 401 || response.status === 404) {
          window.location.replace("/bpo/login");
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        if (data.agent?.status !== "APPROVED") {
          window.location.replace("/bpo/blocked");
          return;
        }
        if (mounted) {
          setLiveUser(current => ({
            ...current,
            name: data.agent.name ?? current.name,
            email: data.agent.email ?? current.email,
            username: data.agent.username ?? current.username,
            avatar_url: data.agent.avatar_url ?? current.avatar_url,
            two_factor_enabled: Boolean(data.agent.two_factor_enabled),
            remaining_credits: Number(data.agent.remaining_credits || 0),
          }));
        }
      } catch {
        // Keep the current balance during a temporary network interruption.
      } finally {
        syncing = false;
      }
    };
    const syncWhenVisible = () => { if (document.visibilityState === "visible") void syncAccount(); };
    const interval = window.setInterval(() => void syncAccount(), 3000);
    window.addEventListener("focus", syncAccount);
    document.addEventListener("visibilitychange", syncWhenVisible);
    void syncAccount();
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", syncAccount);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, []);
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setMenu(false);
      if (!(event.target as Element).closest(".bpo-dialing-menu")) setDialingOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);
  const select = (tab: string) => {
    setActive(tab);
    setMobileNavOpen(false);
    setDialingOpen(false);
    localStorage.setItem("bpo-active-tab", tab);
    const query = tab === "Manual Dialing" ? "?tab=manual" : tab === "Auto Dialing" ? "?tab=auto" : tab === "Quick Dial" ? "?tab=quick" : "";
    window.history.replaceState(null, "", `/bpo${query}`);
  };
  const openCredits = async () => {
    setCreditsOpen(true);
    setCreditContactsLoading(true);
    try {
      const response = await fetch("/api/bpo/credit-contacts", { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.creditContacts) {
        setCreditContacts(current => ({ ...current, ...data.creditContacts }));
      }
    } catch {
      // Keep the last available links if refreshing them temporarily fails.
    } finally {
      setCreditContactsLoading(false);
    }
  };
  return (
    <div className="bpo-shell">
      <header className="bpo-header">
        <Link className="bpo-logo" href="/">
          <img src="/img/logo.png.png" alt="Shahvex" />
        </Link>
        <nav className={`bpo-tabs ${mobileNavOpen ? "mobile-open" : ""}`}>
          <button
            className={active === "Script" ? "active" : ""}
            onClick={() => select("Script")}
          >
            <FiFileText />
            Script
          </button>
          <div
            className="bpo-dialing-menu"
          >
            <button
              className={
                dialing.includes(active) || active === "Dialing" ? "active" : ""
              }
              aria-expanded={dialingOpen}
              aria-haspopup="true"
              onClick={() => setDialingOpen(!dialingOpen)}
            >
              <FiPhone />
              Dialing
            </button>
            {dialingOpen && (
              <div className="bpo-dialing-dropdown">
                {dialing.map((item) => (
                  <button
                    key={item}
                    className={active === item ? "selected" : ""}
                    onClick={() => {
                      select(item);
                      setDialingOpen(false);
                    }}
                  >
                    {item === "Create Agent" ? (
                      <FiUserPlus />
                    ) : item === "Voices" ? (
                      <FiMic />
                    ) : item === "Auto Dialing" ? (
                      <FiZap />
                    ) : item === "Manual Dialing" ? (
                      <FiPhone />
                    ) : item === "Quick Dial" ? (
                      <FiPhone />
                    ) : null}
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={active === "History" ? "active" : ""}
            onClick={() => select("History")}
          >
            <FiClock />
            History
          </button>
          <button
            className={active === "Plans" ? "active" : ""}
            onClick={() => select("Plans")}
          >
            <FiCreditCard />
            Plans
          </button>
        </nav>
        <div className="bpo-actions"><CurrencySelector />
          <div className="bpo-credits">
            <span>
              <FiCreditCard /> Balance
            </span>
            <strong aria-live="polite">{formatMoney(liveUser.remaining_credits || 0)}</strong>
            <button aria-label="Add funds" onClick={() => void openCredits()}>
              <FiPlus />
            </button>
          </div>
          <div className="bpo-profile-wrap" ref={profileRef}>
            <button
              aria-label="Open BPO profile"
              aria-expanded={menu}
              className="bpo-profile-trigger"
              onClick={() => setMenu(!menu)}
            >
              {liveUser.avatar_url ? (
                <img src={liveUser.avatar_url} alt="" onError={() => setLiveUser(current => ({ ...current, avatar_url: "" }))} />
              ) : (
                <span>{initials}</span>
              )}
            </button>
            {menu && (
              <div className="bpo-menu">
                <div className="bpo-menu-user">
                  {liveUser.avatar_url ? (
                    <img src={liveUser.avatar_url} alt="" onError={() => setLiveUser(current => ({ ...current, avatar_url: "" }))} />
                  ) : (
                    <span>{initials}</span>
                  )}
                  <div>
                    <strong>{liveUser.name}</strong>
                    <small>{liveUser.email || "No email added"}</small>
                  </div>
                </div>
                <hr />
                <button onClick={() => { setMenu(false); select("Settings"); }}>
                  <FiUser />
                  Account settings
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    setLogoutOpen(true);
                  }}
                >
                  <FiLogOut />
                  Sign out
                </button>
              </div>
            )}
          </div>
          <button
            className={`bpo-mobile-menu ${mobileNavOpen ? "open" : ""}`}
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            {mobileNavOpen ? <FiX /> : <FiMenu />}
          </button>
        </div>
      </header>
      {active === "Settings" ? <BpoAccountSettings initial={{name:liveUser.name,email:liveUser.email||"",username:liveUser.username||"",avatar_url:liveUser.avatar_url||"",two_factor_enabled:!!liveUser.two_factor_enabled}} onUserUpdated={(next) => setLiveUser({...liveUser,...next})} /> : active === "Script" ? (
        <BpoScriptPanel />
      ) : active === "History" ? (
        <BpoHistory />
      ) : active === "Plans" ? (
        <BpoPlansWorkspace onAddCredits={() => void openCredits()} onBalanceUpdated={(remaining_credits) => setLiveUser(current => ({ ...current, remaining_credits }))} />
      ) : active === "Create Agent" ? (
        <BpoAgentsWorkspace />
      ) : active === "Voices" ? (
        <BpoVoicesWorkspace />
      ) : active === "Auto Dialing" ? (
        <BpoDialingWorkspace mode="AUTO" />
      ) : active === "Manual Dialing" ? (
        <BpoDialingWorkspace mode="MANUAL" />
      ) : active === "Quick Dial" ? (
        <BpoQuickDial />
      ) : (
        <main className="bpo-main">
          <h1>{active}</h1>
          <p>Manage your calling workspace from one place.</p>
        </main>
      )}
      {logoutOpen && <SignOutConfirmation portal="bpo" onCancel={() => setLogoutOpen(false)} />}
      {creditsOpen && <div className="bpo-credit-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setCreditsOpen(false)}>
        <section className="bpo-credit-modal" role="dialog" aria-modal="true" aria-labelledby="credit-title">
          <button className="bpo-credit-close" onClick={() => setCreditsOpen(false)} aria-label="Close"><FiX /></button>
          <p className="bpo-eyebrow">ACCOUNT BALANCE</p><h2 id="credit-title">Add funds</h2>
          <p className="bpo-credit-intro">Choose a payment method to recharge your BPO account.</p>
          <div className="bpo-credit-tabs">
            <button className={creditTab === "crypto" ? "active" : ""} onClick={() => setCreditTab("crypto")}><FiCreditCard /> Crypto</button>
            <button className={creditTab === "manual" ? "active" : ""} onClick={() => setCreditTab("manual")}><FiFileText /> Manual</button>
            <button className={creditTab === "contact" ? "active" : ""} onClick={() => setCreditTab("contact")}><FiMessageCircle /> Contact <em>Recommended</em></button>
          </div>
          {creditTab === "crypto" && <div className="bpo-credit-panel bpo-coming-soon"><div className="bpo-qr-placeholder">QR</div><h3>Crypto payments are coming soon</h3><p>NOWPayments checkout and QR payments will be available here shortly.</p><span>Coming soon</span></div>}
          {creditTab === "manual" && <div className="bpo-credit-panel bpo-coming-soon"><div className="bpo-qr-placeholder bpo-manual-placeholder"><FiFileText /></div><h3>Manual payments are coming soon</h3><p>Manual recharge with JazzCash, Easypaisa and payment proof will be available here shortly.</p><span>Coming soon</span></div>}
          {creditTab === "contact" && <div className="bpo-credit-panel" aria-busy={creditContactsLoading}><p>Need a quick recharge? Contact our support team and share the amount you want to add.</p>{creditContactsLoading ? <div className="bpo-credit-contact-loading"><i /><i /><i /></div> : <><a className="bpo-contact-option whatsapp" href={creditContacts.whatsappUrl} target="_blank" rel="noopener noreferrer"><FaWhatsapp /><span><strong>WhatsApp</strong><small>Recommended · fastest response</small></span><FiSend /></a><a className="bpo-contact-option instagram" href={creditContacts.instagramUrl} target="_blank" rel="noopener noreferrer"><FaInstagram /><span><strong>Instagram</strong><small>Message us on Instagram</small></span><FiSend /></a><a className="bpo-contact-option messenger" href={creditContacts.messengerUrl} target="_blank" rel="noopener noreferrer"><FaFacebookMessenger /><span><strong>Messenger</strong><small>Chat with support</small></span><FiSend /></a></>}</div>}
        </section>
      </div>}
      <footer className="bpo-footer mt-20!">
        © 2026 Shahvex. All rights reserved.
      </footer>
    </div>
  );
}
