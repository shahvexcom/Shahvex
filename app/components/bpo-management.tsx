"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiCalendar,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiCreditCard,
  FiEdit3,
  FiFilter,
  FiMail,
  FiMinusCircle,
  FiRefreshCw,
  FiSearch,
  FiSave,
  FiShield,
  FiSlash,
  FiTrash2,
  FiUserCheck,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { FaFacebookMessenger, FaInstagram, FaWhatsapp } from "react-icons/fa6";

import "./voip-manager.css";
import "./bpo-card-polish.css";

import { BpoPlans } from "./bpo-plans";
import { CustomDropdown } from "./custom-dropdown";
import "./bpo-management.css";

type BpoUser = {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string;
  two_factor_enabled: boolean;
  created_at: string;
  status: string;
  overall_credits: number;
  remaining_credits: number;
  active_agents: number;
  total_calls: number;
  spend_amount: number;
  blocked_at: string | null;
  block_reason: string;
};

type BpoAction = { kind: "credits" | "reduce" | "block" | "approve" | "delete"; user: BpoUser } | null;

type CreditContacts = {
  whatsappUrl: string;
  instagramUrl: string;
  messengerUrl: string;
  updatedAt: string | null;
};

const defaultCreditContacts: CreditContacts = {
  whatsappUrl: "https://wa.me/",
  instagramUrl: "https://instagram.com/",
  messengerUrl: "https://m.me/",
  updatedAt: null,
};

function initials(name: string) {
  return name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function credits(value: number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function joined(value: string) {
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

const PAGE_SIZE = 8;

type BpoTab = "users" | "plans" | "finance";

const bpoTabs: { id: BpoTab; label: string; icon: React.ReactNode }[] = [
  { id: "users", label: "BPO Users", icon: <FiUsers /> },
  { id: "plans", label: "Plans", icon: <FiCreditCard /> },
  { id: "finance", label: "Finance", icon: <FiCreditCard /> },
];

function initialBpoTab(): BpoTab {
  if (typeof window === "undefined") return "users";
  const requested = new URLSearchParams(window.location.search).get("bpoTab");
  return requested && bpoTabs.some(tab => tab.id === requested) ? requested as BpoTab : "users";
}

export function BpoManagement({ query, setQuery, onAction }: { query: string; setQuery: (value: string) => void; onAction: (message: string, kind?: "success" | "error") => void }) {
  const [activeTab, setActiveTab] = useState<BpoTab>(initialBpoTab);

  const selectTab = (tab: BpoTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "bpo");
    url.searchParams.set("bpoTab", tab);
    window.history.replaceState(null, "", url);
  };

  return <div className="bpo-admin-workspace">
    <div className="bpo-admin-tabs" role="tablist">
      {bpoTabs.map(tab => <button key={tab.id} role="tab" type="button" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => selectTab(tab.id)}>{tab.icon}<span>{tab.label}</span></button>)}
    </div>
    <div className="bpo-admin-tab-panel" role="tabpanel">
      {activeTab === "users" && <BpoUsers query={query} setQuery={setQuery} onAction={onAction} />}
      {activeTab === "plans" && <BpoPlans onAction={onAction} />}
      {activeTab === "finance" && <BpoFinance onAction={onAction} />}
    </div>
  </div>;
}

function BpoUsers({ query, setQuery, onAction }: { query: string; setQuery: (value: string) => void; onAction: (message: string, kind?: "success" | "error") => void }) {
  const [users, setUsers] = useState<BpoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [action, setAction] = useState<BpoAction>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [creditContacts, setCreditContacts] = useState<CreditContacts>(defaultCreditContacts);
  const [savedCreditContacts, setSavedCreditContacts] = useState<CreditContacts>(defaultCreditContacts);
  const [contactsBusy, setContactsBusy] = useState(false);
  const [contactsError, setContactsError] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/bpo", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load BPO users.");
      setUsers(data.users ?? []);
      if (data.creditContacts) {
        const next = { ...defaultCreditContacts, ...data.creditContacts };
        setCreditContacts(next);
        setSavedCreditContacts(next);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load BPO users.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial data is intentionally client-loaded so the tab has a real skeleton state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadUsers(); }, [loadUsers]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return users.filter(user => (status === "ALL" || user.status === status) && (!search || `${user.name} ${user.email ?? ""}`.toLowerCase().includes(search)));
  }, [query, status, users]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const totals = useMemo(() => ({
    total: users.length,
    active: users.filter(user => user.status === "APPROVED").length,
    blocked: users.filter(user => user.status === "SUSPENDED").length,
    credits: users.reduce((sum, user) => sum + Number(user.overall_credits || 0), 0),
  }), [users]);

  const openAction = (kind: "credits" | "reduce" | "block" | "approve" | "delete", user: BpoUser) => {
    setMenuId(null);
    setAmount("");
    setReason("");
    setConfirmed(false);
    setFormError("");
    setAction({ kind, user });
  };

  const submitAction = async () => {
    if (!action) return;
    setBusy(true);
    setFormError("");
    try {
      const isDelete = action.kind === "delete";
      const body = isDelete
        ? { id: action.user.id }
        : action.kind === "credits"
          ? { action: "load-credits", id: action.user.id, amount: Number(amount) }
          : action.kind === "reduce"
            ? { action: "reduce-credits", id: action.user.id, amount: Number(amount) }
            : action.kind === "approve"
              ? { action: "approve", id: action.user.id }
              : { action: "block", id: action.user.id, reason: reason.trim() };
      const response = await fetch("/api/admin/bpo", {
        method: isDelete ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to complete this action.");
      if (isDelete) setUsers(current => current.filter(user => user.id !== data.deletedId));
      else setUsers(current => current.map(user => user.id === data.user.id ? { ...user, ...data.user, spend_amount: Math.max(0, Number(data.user.overall_credits || 0) - Number(data.user.remaining_credits || 0)) } : user));
      setAction(null);
      onAction(`${data.message}${data.emailSent ? " Email sent." : " Email delivery unavailable."}`, "success");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to complete this action.");
    } finally {
      setBusy(false);
    }
  };

  const saveCreditContacts = async (event: React.FormEvent) => {
    event.preventDefault();
    setContactsBusy(true);
    setContactsError("");
    try {
      const response = await fetch("/api/admin/bpo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-credit-contacts", ...creditContacts }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update credit contact URLs.");
      const next = { ...creditContacts, ...data.creditContacts };
      setCreditContacts(next);
      setSavedCreditContacts(next);
      onAction(data.message, "success");
    } catch (error) {
      setContactsError(error instanceof Error ? error.message : "Unable to update credit contact URLs.");
    } finally {
      setContactsBusy(false);
    }
  };

  const contactsChanged = creditContacts.whatsappUrl !== savedCreditContacts.whatsappUrl
    || creditContacts.instagramUrl !== savedCreditContacts.instagramUrl
    || creditContacts.messengerUrl !== savedCreditContacts.messengerUrl;

  if (loading) return <BpoSkeleton />;

  return <>
    <div className="admin-page-head bpo-admin-heading">
      <div><p>BPO MANAGEMENT</p><h1>BPO users</h1></div>
      <button className="admin-outline" onClick={() => void loadUsers()}><FiRefreshCw /> Refresh</button>
    </div>

    <div className="bpo-admin-kpis">
      <BpoKpi icon={<FiUsers />} label="Total BPO users" value={String(totals.total)} tone="purple" />
      <BpoKpi icon={<FiUserCheck />} label="Active users" value={String(totals.active)} tone="green" />
      <BpoKpi icon={<FiSlash />} label="Blocked users" value={String(totals.blocked)} tone="red" />
      <BpoKpi icon={<FiCreditCard />} label="Credits loaded" value={credits(totals.credits)} tone="blue" />
    </div>

    <form className="bpo-credit-contact-card bpo-credit-contact-card-in-users" onSubmit={saveCreditContacts}>
      <header>
        <div><p>CREDIT RECHARGE</p><h2>Credit contact URLs</h2><span>These links appear in the Contact tab of every BPO user&apos;s Add credits popup.</span></div>
        <button className="admin-primary" disabled={contactsBusy || !contactsChanged} type="submit"><FiSave /> {contactsBusy ? "Saving…" : "Save URLs"}</button>
      </header>
      <div className="bpo-credit-contact-grid">
        <label><span className="whatsapp"><FaWhatsapp /></span><b>WhatsApp</b><input type="url" required maxLength={500} value={creditContacts.whatsappUrl} onChange={event => setCreditContacts(current => ({ ...current, whatsappUrl: event.target.value }))} placeholder="https://wa.me/923001234567" /></label>
        <label><span className="instagram"><FaInstagram /></span><b>Instagram</b><input type="url" required maxLength={500} value={creditContacts.instagramUrl} onChange={event => setCreditContacts(current => ({ ...current, instagramUrl: event.target.value }))} placeholder="https://instagram.com/yourpage" /></label>
        <label><span className="messenger"><FaFacebookMessenger /></span><b>Messenger</b><input type="url" required maxLength={500} value={creditContacts.messengerUrl} onChange={event => setCreditContacts(current => ({ ...current, messengerUrl: event.target.value }))} placeholder="https://m.me/yourpage" /></label>
      </div>
      <footer>
        <small>{savedCreditContacts.updatedAt ? `Last updated ${new Date(savedCreditContacts.updatedAt).toLocaleString()}` : "Using the default contact links."}</small>
        {contactsError && <p>{contactsError}</p>}
      </footer>
    </form>

    <div className="bpo-admin-tools">
      <label><FiSearch /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search BPO user by name or email" /></label>
      <div className="bpo-status-filter"><FiFilter /><CustomDropdown value={status} onChange={value => { setStatus(value); setPage(1); }} ariaLabel="Filter BPO users by status" options={[{ value: "ALL", label: "All statuses" }, { value: "APPROVED", label: "Active" }, { value: "PENDING", label: "Pending" }, { value: "SUSPENDED", label: "Blocked" }, { value: "REJECTED", label: "Rejected" }]} /></div>
      <span>{filtered.length} user{filtered.length === 1 ? "" : "s"}</span>
    </div>

    {loadError ? <section className="admin-card bpo-admin-error"><FiSlash /><h2>Could not load BPO users</h2><p>{loadError}</p><button className="admin-primary" onClick={() => void loadUsers()}>Try again</button></section>
      : filtered.length ? <div className="bpo-user-grid">{visibleUsers.map(user => <article className={`bpo-user-card ${user.status === "SUSPENDED" ? "is-blocked" : ""} ${menuId === user.id ? "menu-open" : ""}`} key={user.id}>
        <header>
          <div className="bpo-user-identity">
            {user.avatar_url ? <img src={user.avatar_url} alt={`${user.name}'s avatar`} /> : <span>{initials(user.name)}</span>}
            <div><h2>{user.name}</h2><p><FiMail /> {user.email || "No email provided"}</p></div>
          </div>
          <div className="bpo-user-action">
            <button type="button" className="bpo-action-trigger" aria-label={`Manage ${user.name}`} aria-haspopup="menu" aria-expanded={menuId === user.id} onClick={() => setMenuId(current => current === user.id ? null : user.id)}><FiEdit3 /></button>
            {menuId === user.id && <><button type="button" className="bpo-action-menu-backdrop" onClick={() => setMenuId(null)} /><div className="bpo-action-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => openAction("credits", user)}><FiCreditCard /> Load credit</button>
              <button type="button" role="menuitem" className="reduce" onClick={() => openAction("reduce", user)}><FiMinusCircle /> Reduce credit</button>
              {user.status === "SUSPENDED"
                ? <button type="button" role="menuitem" className="approve" onClick={() => openAction("approve", user)}><FiCheckCircle /> Approve again</button>
                : <button type="button" role="menuitem" onClick={() => openAction("block", user)}><FiSlash /> Block user</button>}
              <button type="button" role="menuitem" className="danger" onClick={() => openAction("delete", user)}><FiTrash2 /> Delete user</button>
            </div></>}
          </div>
        </header>

        <div className="bpo-user-security">
          <span className={user.two_factor_enabled ? "enabled" : "disabled"}><FiShield /> 2FA {user.two_factor_enabled ? "enabled" : "disabled"}</span>
          <span className={`bpo-user-status status-${user.status.toLowerCase()}`}>{user.status === "SUSPENDED" ? "Blocked" : user.status.charAt(0) + user.status.slice(1).toLowerCase()}</span>
        </div>

        <dl className="bpo-user-details">
          <div><dt><FiCalendar /> Joining date</dt><dd>{joined(user.created_at)}</dd></div>
          <div><dt>Overall credits</dt><dd>{credits(user.overall_credits)}</dd></div>
          <div className="bpo-credit-balance"><dt>Remaining credits</dt><dd>{credits(user.remaining_credits)}</dd></div>
          <div><dt>Active agents</dt><dd>{Number(user.active_agents || 0).toLocaleString()}</dd></div>
          <div><dt>Total calls</dt><dd>{Number(user.total_calls || 0).toLocaleString()}</dd></div>
          <div><dt>Spend amount</dt><dd>{credits(user.spend_amount)}</dd></div>
        </dl>

        {user.status === "SUSPENDED" && <div className="bpo-block-note"><strong>Blocked</strong><span>{user.block_reason || "No reason provided"}</span>{user.blocked_at && <small>{new Date(user.blocked_at).toLocaleString()}</small>}</div>}
      </article>)}</div>
      : <section className="admin-card bpo-admin-empty"><div className="bpo-empty-symbol">{query.trim() || status !== "ALL" ? <FiSearch /> : <FiUsers />}</div><h2>{query.trim() || status !== "ALL" ? "No matching BPO users" : "Your BPO network starts here"}</h2><p>{query.trim() || status !== "ALL" ? "Try another name or clear your filters to see all registered accounts." : "Registered teams will appear here. Manage their access, credits and calling operations in one place."}</p>{query.trim() || status !== "ALL" ? <button className="admin-outline" type="button" onClick={() => { setQuery(""); setStatus("ALL"); setPage(1); }}><FiRefreshCw /> Clear filters</button> : <a className="bpo-empty-register" href="/bpo/register" target="_blank" rel="noopener noreferrer"><FiUsers /> Open BPO registration</a>}</section>}

    {!loadError && filtered.length > 0 && <nav className="bpo-admin-pagination" aria-label="BPO user pages"><div className="bpo-page-summary"><b>{(currentPage - 1) * PAGE_SIZE + 1}&ndash;{Math.min(currentPage * PAGE_SIZE, filtered.length)} <span>of {filtered.length} BPO users</span></b><small>Page {currentPage} of {pageCount}</small></div><div className="bpo-page-controls"><button className="bpo-page-direction" aria-label="Previous BPO page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><FiChevronLeft/><span>Previous</span></button>{Array.from({length:pageCount},(_,i)=>i+1).filter(n=>n===1||n===pageCount||Math.abs(n-currentPage)<=1).map((number,index,list)=><span className="bpo-page-number-wrap" key={number}>{index>0&&number-list[index-1]>1&&<span className="bpo-page-gap" aria-hidden="true">&hellip;</span>}<button aria-label={`BPO page ${number}`} aria-current={number===currentPage?'page':undefined} className={number===currentPage?'active':''} onClick={()=>setPage(number)}>{number}</button></span>)}<button className="bpo-page-direction" aria-label="Next BPO page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><span>Next</span><FiChevronRight/></button></div></nav>}


    {action && <div className="agent-modal-backdrop bpo-action-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && setAction(null)}>
      <section className="agent-modal bpo-action-modal" role="dialog" aria-modal="true" aria-labelledby="bpo-action-title">
        <header><div><p>{action.kind === "credits" ? "ACCOUNT CREDIT" : action.kind === "reduce" ? "CREDIT CORRECTION" : action.kind === "block" ? "CONFIRM BLOCK" : action.kind === "approve" ? "CONFIRM APPROVAL" : "CONFIRM DELETE"}</p><h2 id="bpo-action-title">{action.kind === "credits" ? `Load credit for ${action.user.name}` : action.kind === "reduce" ? `Reduce credit for ${action.user.name}` : action.kind === "block" ? `Block ${action.user.name}?` : action.kind === "approve" ? `Approve ${action.user.name} again?` : `Delete ${action.user.name}?`}</h2></div><button disabled={busy} onClick={() => setAction(null)} aria-label="Close"><FiX /></button></header>

        {action.kind === "credits" && <><p className="bpo-modal-copy">Enter the credits to add. The amount will be added to both overall and remaining credits.</p><label className="bpo-modal-field">Credit amount<input type="number" min="0.01" max="1000000" step="0.01" autoFocus value={amount} onChange={event => setAmount(event.target.value)} placeholder="e.g. 500" /></label><div className="bpo-balance-preview"><span>Current balance <b>{credits(action.user.remaining_credits)}</b></span><span>New balance <b>{credits(action.user.remaining_credits + (Number(amount) || 0))}</b></span></div></>}
        {action.kind === "reduce" && <><p className="bpo-modal-copy">Correct an accidental credit load. The amount will be removed from both overall and remaining credits without changing recorded spend.</p><label className="bpo-modal-field">Amount to remove<input type="number" min="0.01" max={action.user.remaining_credits} step="0.01" autoFocus value={amount} onChange={event => setAmount(event.target.value)} placeholder="e.g. 100" /></label><div className="bpo-balance-preview"><span>Current balance <b>{credits(action.user.remaining_credits)}</b></span><span>New balance <b>{credits(Math.max(0, action.user.remaining_credits - (Number(amount) || 0)))}</b></span></div><p className="bpo-credit-note">Maximum removable: <b>{credits(action.user.remaining_credits)} PKR</b>. The user will receive a credit adjustment email.</p></>}
        {action.kind === "block" && <><p className="bpo-modal-copy">This user will be unable to sign in again. The email will include the block date, time and reason.</p><label className="bpo-modal-field">Reason<textarea autoFocus maxLength={500} rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is this account being blocked?" /></label></>}
        {action.kind === "approve" && <div className="bpo-approve-notice"><FiCheckCircle /><div><strong>Restore BPO access</strong><p>This user will be approved again and can immediately sign in to the BPO workspace. A confirmation email will be sent to {action.user.email || "the user"}.</p></div></div>}
        {action.kind === "delete" && <div className="bpo-delete-warning"><FiTrash2 /><div><strong>This action cannot be undone</strong><p>The BPO account and its related workspace data will be deleted. A confirmation email will be sent to {action.user.email || "the user"}.</p></div></div>}

        {(action.kind === "block" || action.kind === "approve" || action.kind === "delete") && <label className="bpo-confirm-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{action.kind === "block" ? "I confirm that I want to block this BPO user." : action.kind === "approve" ? "I confirm that I want to restore this BPO user's access." : "I understand this account will be permanently deleted."}</span></label>}

        {formError && <p className="agent-form-error">{formError}</p>}
        <footer><button className="admin-outline" disabled={busy} onClick={() => setAction(null)}>Cancel</button><button className={action.kind === "delete" ? "admin-primary danger-button" : action.kind === "reduce" ? "admin-primary reduce-button" : action.kind === "approve" ? "admin-primary approve-button" : "admin-primary"} disabled={busy || ((action.kind === "credits" || action.kind === "reduce") && (!Number(amount) || Number(amount) <= 0 || (action.kind === "reduce" && Number(amount) > action.user.remaining_credits))) || (action.kind === "block" && reason.trim().length < 3) || ((action.kind === "block" || action.kind === "approve" || action.kind === "delete") && !confirmed)} onClick={() => void submitAction()}>{busy ? "Please wait…" : action.kind === "credits" ? "Load credit" : action.kind === "reduce" ? "Reduce credit" : action.kind === "block" ? "Confirm block" : action.kind === "approve" ? "Confirm approval" : "Confirm delete"}</button></footer>
      </section>
    </div>}
  </>;
}

function BpoFinance({ onAction }: { onAction: (message: string, kind?: "success" | "error") => void }) {
  const [creditContacts, setCreditContacts] = useState<CreditContacts>(defaultCreditContacts);
  const [savedCreditContacts, setSavedCreditContacts] = useState<CreditContacts>(defaultCreditContacts);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/bpo", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load finance settings.");
      const next = { ...defaultCreditContacts, ...(data.creditContacts ?? {}) };
      setCreditContacts(next);
      setSavedCreditContacts(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load finance settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  // This settings form is intentionally loaded when the Finance tab opens.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/bpo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-credit-contacts", ...creditContacts }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update credit contact URLs.");
      const next = { ...creditContacts, ...data.creditContacts };
      setCreditContacts(next);
      setSavedCreditContacts(next);
      onAction(data.message, "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update credit contact URLs.");
    } finally {
      setBusy(false);
    }
  };

  const changed = creditContacts.whatsappUrl !== savedCreditContacts.whatsappUrl
    || creditContacts.instagramUrl !== savedCreditContacts.instagramUrl
    || creditContacts.messengerUrl !== savedCreditContacts.messengerUrl;

  return <section className="bpo-finance-section">
    <div className="bpo-section-heading">
      <div><p>FINANCE</p><h1>Credit recharge</h1><span>Manage the contact options BPO users see when they add PKR to their account.</span></div>
      <button className="admin-outline" type="button" onClick={() => void load()} disabled={loading || busy}><FiRefreshCw /> Refresh</button>
    </div>
    <form className="bpo-credit-contact-card" onSubmit={save} aria-busy={loading}>
      <header><div><p>CREDIT RECHARGE</p><h2>Credit contact URLs</h2><span>These links appear in the Contact tab of every BPO user&apos;s Add credits popup.</span></div><button className="admin-primary" disabled={loading || busy || !changed} type="submit"><FiSave /> {busy ? "Saving..." : "Save URLs"}</button></header>
      <div className="bpo-credit-contact-grid">
        <label><span className="whatsapp"><FaWhatsapp /></span><b>WhatsApp</b><input type="url" required maxLength={500} disabled={loading} value={creditContacts.whatsappUrl} onChange={event => setCreditContacts(current => ({ ...current, whatsappUrl: event.target.value }))} placeholder="https://wa.me/923001234567" /></label>
        <label><span className="instagram"><FaInstagram /></span><b>Instagram</b><input type="url" required maxLength={500} disabled={loading} value={creditContacts.instagramUrl} onChange={event => setCreditContacts(current => ({ ...current, instagramUrl: event.target.value }))} placeholder="https://instagram.com/yourpage" /></label>
        <label><span className="messenger"><FaFacebookMessenger /></span><b>Messenger</b><input type="url" required maxLength={500} disabled={loading} value={creditContacts.messengerUrl} onChange={event => setCreditContacts(current => ({ ...current, messengerUrl: event.target.value }))} placeholder="https://m.me/yourpage" /></label>
      </div>
      <footer><small>{savedCreditContacts.updatedAt ? `Last updated ${new Date(savedCreditContacts.updatedAt).toLocaleString()}` : "Using the default contact links."}</small>{error && <p>{error}</p>}</footer>
    </form>
  </section>;
}

function BpoKpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return <section className={`bpo-admin-kpi ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></section>;
}

function BpoSkeleton() {
  return <div className="bpo-admin-loading" aria-busy="true">
    <div className="bpo-heading-skeleton bpo-shimmer" />
    <div className="bpo-admin-kpis">{[1, 2, 3, 4].map(item => <div className="bpo-kpi-skeleton bpo-shimmer" key={item} />)}</div>
    <div className="bpo-user-grid">{[1, 2, 3, 4].map(item => <div className="bpo-card-skeleton" key={item}><i className="bpo-shimmer" /><span className="bpo-shimmer" /><span className="bpo-shimmer short" /><div><b className="bpo-shimmer" /><b className="bpo-shimmer" /><b className="bpo-shimmer" /></div></div>)}</div>
  </div>;
}
