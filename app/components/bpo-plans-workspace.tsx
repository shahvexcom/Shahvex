"use client";
import { useCurrency, CurrencySelector } from "./currency-provider";

import { useCallback, useEffect, useState } from "react";
import { FiArchive, FiCheck, FiChevronLeft, FiChevronRight, FiCreditCard, FiLayers, FiMessageCircle, FiPhoneCall, FiPlus, FiRefreshCw, FiSend, FiStar, FiUsers, FiX } from "react-icons/fi";
import { FaFacebookMessenger, FaInstagram, FaWhatsapp } from "react-icons/fa6";

type PlanBadge = "STANDARD" | "RECOMMENDED" | "EXCLUSIVE" | "CUSTOM";
type BpoPlan = {
  id: string;
  name: string;
  description: string;
  price: number | string;
  plan_badge: PlanBadge;
  plan_kind: "STANDARD" | "CUSTOM";
  benefits: string[];
  agent_limit: number;
  call_limit: number;
  total_minutes: number;
  storage_amount: number;
  storage_unit: "MB" | "GB";
};
type ActivePurchase = Omit<BpoPlan, "id" | "name" | "description" | "plan_kind"> & { id: string; plan_id: string; plan_name: string; purchased_at: string };
type LowBalance = { balance: number; required: number; shortfall: number };
type CreditContacts = { whatsappUrl: string; instagramUrl: string; messengerUrl: string };
type PlanCategory = "ALL" | "SMALL_BUSINESS" | "GROWTH_BUSINESS" | "ENTERPRISE" | "CUSTOM";
type PlanUsage = {
  agents: number;
  calls: number;
  minutes: number;
  recordings: number;
  storageBytes: number;
  limits: { agents: number; calls: number; minutes: number; recordings: number; storageBytes: number };
};
type UsagePricing = { agentUnitPrice: number; callUnitPrice: number; minuteUnitPrice: number; recordingUnitPrice: number; storageUnitPrice: number; storageUnit: "MB" | "GB" };
type AddonProduct = "AGENT" | "CALL" | "MINUTE" | "RECORDING" | "STORAGE";
type Addon = { product: AddonProduct; label: string; unit: string; price: number };

const number = (value: number | string) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const storage = (amount: number, unit: "MB" | "GB") => `${number(amount)} ${unit}`;
const byteSize = (value: number) => {
  if (value >= 1024 ** 3) return `${number(value / 1024 ** 3)} GB`;
  if (value >= 1024 ** 2) return `${number(value / 1024 ** 2)} MB`;
  if (value >= 1024) return `${number(value / 1024)} KB`;
  return `${number(value)} B`;
};
const percentage = (used: number, limit: number) => limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
const badgeLabel = (badge: PlanBadge) => badge === "CUSTOM" ? "Custom" : badge === "EXCLUSIVE" ? "Exclusive" : "Recommended";
const emptyUsage: PlanUsage = { agents: 0, calls: 0, minutes: 0, recordings: 0, storageBytes: 0, limits: { agents: 0, calls: 0, minutes: 0, recordings: 0, storageBytes: 0 } };
const defaultContacts: CreditContacts = { whatsappUrl: "https://wa.me/", instagramUrl: "https://instagram.com/", messengerUrl: "https://m.me/" };
const customPlanRequest: BpoPlan = {
  id: "custom-plan-request",
  name: "Build your custom plan",
  description: "Choose the team size, calls, minutes and storage that suit your business.",
  price: 0,
  plan_badge: "CUSTOM",
  plan_kind: "CUSTOM",
  benefits: ["Tailored agent allowance", "Custom call and minute limits", "Storage sized for your workflow"],
  agent_limit: 0,
  call_limit: 0,
  total_minutes: 0,
  storage_amount: 0,
  storage_unit: "GB",
};
const planCategories: { id: PlanCategory; label: string }[] = [
  { id: "ALL", label: "All plans" },
  { id: "SMALL_BUSINESS", label: "Small business" },
  { id: "GROWTH_BUSINESS", label: "Growth business" },
  { id: "ENTERPRISE", label: "Enterprise" },
  { id: "CUSTOM", label: "Custom" },
];
const PLANS_PER_PAGE = 6;
const planCategory = (plan: BpoPlan): PlanCategory => {
  if (plan.plan_kind === "CUSTOM") return "CUSTOM";
  if (plan.total_minutes <= 1_000) return "SMALL_BUSINESS";
  if (plan.total_minutes <= 3_500) return "GROWTH_BUSINESS";
  return "ENTERPRISE";
};

export default function BpoPlansWorkspace({ onAddCredits, onBalanceUpdated }: { onAddCredits: () => void; onBalanceUpdated: (balance: number) => void }) {
  const { formatMoney } = useCurrency();
  const [plans, setPlans] = useState<BpoPlan[]>([]);
  const [activePurchases, setActivePurchases] = useState<ActivePurchase[]>([]);
  const [usage, setUsage] = useState<PlanUsage>(emptyUsage);
  const [usagePricing, setUsagePricing] = useState<UsagePricing>({ agentUnitPrice: 0, callUnitPrice: 0, minuteUnitPrice: 0, recordingUnitPrice: 0, storageUnitPrice: 0, storageUnit: "GB" });
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<BpoPlan | null>(null);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [lowBalance, setLowBalance] = useState<LowBalance | null>(null);
  const [customContactPlan, setCustomContactPlan] = useState<BpoPlan | null>(null);
  const [creditContacts, setCreditContacts] = useState<CreditContacts>(defaultContacts);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<PlanCategory>("ALL");
  const [planPage, setPlanPage] = useState(1);
  const [selectedAddon, setSelectedAddon] = useState<Addon | null>(null);
  const [addonQuantity, setAddonQuantity] = useState(1);
  const [addonBusy, setAddonBusy] = useState(false);
  const [addonError, setAddonError] = useState("");

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bpo/plans", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load plans.");
      setPlans(Array.isArray(data.plans) ? data.plans : []);
      setActivePurchases(Array.isArray(data.activePurchases) ? data.activePurchases : []);
      setUsage({
        agents: Number(data.usage?.agents || 0),
        calls: Number(data.usage?.calls || 0),
        minutes: Number(data.usage?.minutes || 0),
        recordings: Number(data.usage?.recordings || 0),
        storageBytes: Number(data.usage?.storageBytes || 0),
        limits: {
          agents: Number(data.usage?.limits?.agents || 0),
          calls: Number(data.usage?.limits?.calls || 0),
          minutes: Number(data.usage?.limits?.minutes || 0),
          recordings: Number(data.usage?.limits?.recordings || 0),
          storageBytes: Number(data.usage?.limits?.storageBytes || 0),
        },
      });
      if (data.usagePricing) setUsagePricing({ agentUnitPrice: Number(data.usagePricing.agentUnitPrice || 0), callUnitPrice: Number(data.usagePricing.callUnitPrice || 0), minuteUnitPrice: Number(data.usagePricing.minuteUnitPrice || 0), recordingUnitPrice: Number(data.usagePricing.recordingUnitPrice || 0), storageUnitPrice: Number(data.usagePricing.storageUnitPrice || 0), storageUnit: data.usagePricing.storageUnit === "MB" ? "MB" : "GB" });
      setBalance(Number(data.balance || 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load plans.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // The published plan list is loaded only after the authenticated workspace mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const metrics = [
    { label: "Agents used", used: usage.agents, limit: usage.limits.agents, value: `${number(usage.agents)} / ${number(usage.limits.agents)}`, icon: FiUsers, tone: "purple", addon: { product: "AGENT", label: "agent slot", unit: "agent", price: usagePricing.agentUnitPrice } as Addon },
    { label: "Calls used", used: usage.calls, limit: usage.limits.calls, value: `${number(usage.calls)} / ${number(usage.limits.calls)}`, icon: FiPhoneCall, tone: "blue", addon: { product: "CALL", label: "call allowance", unit: "call", price: usagePricing.callUnitPrice } as Addon },
    { label: "Minutes used", used: usage.minutes, limit: usage.limits.minutes, value: `${number(usage.minutes)} / ${number(usage.limits.minutes)}`, icon: FiLayers, tone: "green", addon: { product: "MINUTE", label: "call minute", unit: "minute", price: usagePricing.minuteUnitPrice } as Addon },
    { label: "Recordings used", used: usage.recordings, limit: usage.limits.recordings, value: `${number(usage.recordings)} / ${number(usage.limits.recordings)}`, icon: FiArchive, tone: "orange", addon: { product: "RECORDING", label: "recording", unit: "recording", price: usagePricing.recordingUnitPrice } as Addon },
    { label: "Storage used", used: usage.storageBytes, limit: usage.limits.storageBytes, value: `${byteSize(usage.storageBytes)} / ${byteSize(usage.limits.storageBytes)}`, icon: FiArchive, tone: "slate", addon: { product: "STORAGE", label: "storage", unit: usagePricing.storageUnit, price: usagePricing.storageUnitPrice } as Addon },
  ];
  const regularActivePlans = activePurchases.filter(purchase => purchase.plan_badge !== "CUSTOM");
  const catalogPlans = [...plans, customPlanRequest].sort((first, second) =>
    Number(first.price) - Number(second.price) || first.name.localeCompare(second.name),
  );
  const filteredPlans = catalogPlans.filter(plan => selectedCategory === "ALL" || planCategory(plan) === selectedCategory);
  const pageCount = Math.max(1, Math.ceil(filteredPlans.length / PLANS_PER_PAGE));
  const currentPage = Math.min(planPage, pageCount);
  const visiblePlans = filteredPlans.slice((currentPage - 1) * PLANS_PER_PAGE, currentPage * PLANS_PER_PAGE);

  const purchase = async () => {
    if (!selectedPlan) return;
    setPurchaseBusy(true);
    setPurchaseError("");
    try {
      const response = await fetch("/api/bpo/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: selectedPlan.id }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 402) {
        setSelectedPlan(null);
        setLowBalance({ balance: Number(data.balance || 0), required: Number(data.required || selectedPlan.price), shortfall: Number(data.shortfall || 0) });
        return;
      }
      if (!response.ok) throw new Error(data.message || "Unable to buy this plan.");
      const nextBalance = Number(data.balance || 0);
      setActivePurchases(Array.isArray(data.activePurchases) ? data.activePurchases : []);
      setBalance(nextBalance);
      onBalanceUpdated(nextBalance);
      setSelectedPlan(null);
      await load(false);
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : "Unable to buy this plan.");
    } finally {
      setPurchaseBusy(false);
    }
  };

  const purchaseAddon = async () => {
    if (!selectedAddon) return;
    setAddonBusy(true); setAddonError("");
    try {
      const response = await fetch("/api/bpo/addons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: selectedAddon.product, quantity: addonQuantity }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 402) {
        setSelectedAddon(null);
        setLowBalance({ balance: Number(data.balance || 0), required: Number(data.required || selectedAddon.price * addonQuantity), shortfall: Number(data.shortfall || 0) });
        return;
      }
      if (!response.ok) throw new Error(data.message || "Unable to purchase this add-on.");
      const nextBalance = Number(data.balance || 0);
      setBalance(nextBalance); onBalanceUpdated(nextBalance); setSelectedAddon(null);
      await load(false);
    } catch (cause) { setAddonError(cause instanceof Error ? cause.message : "Unable to purchase this add-on."); }
    finally { setAddonBusy(false); }
  };

  const openCustomContact = async (plan: BpoPlan) => {
    setCustomContactPlan(plan);
    setContactsLoading(true);
    try {
      const response = await fetch("/api/bpo/credit-contacts", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.creditContacts) setCreditContacts(current => ({ ...current, ...data.creditContacts }));
    } finally {
      setContactsLoading(false);
    }
  };

  return <main className="bpo-plans-page">
    <div className="bpo-plans-heading">
      <div>
        <p className="bpo-eyebrow">PLANS &amp; PRICING</p>
        <h1>{activePurchases.length ? "Your active plans" : "Choose the right plan"}</h1>
        <p>{activePurchases.length ? "Your active plans are combined below. You can hold up to two regular plans, plus a custom plan assigned by your administrator." : "Explore plans published by your administrator, including any custom offer created just for your business."}</p>
        {activePurchases.length > 0 && <div className="bpo-active-plan-names"><small>ACTIVE</small>{activePurchases.map(purchase => <span key={purchase.id}>{purchase.plan_name}</span>)}</div>}
      </div>
      <div className="bpo-plan-balance"><div className="plan-balance-top"><small>Available balance</small><CurrencySelector /></div><div className="plan-balance-bottom"><strong>{formatMoney(balance)}</strong><button className="bpo-plans-refresh" type="button" onClick={() => void load()} disabled={loading}><FiRefreshCw /> Refresh</button></div></div>
    </div>

    <section className="bpo-plans-kpis bpo-plan-usage-kpis" aria-label="Combined plan usage">
      {metrics.map(({ label, value, used, limit, icon: Icon, tone, addon }) => <article className={tone} key={label}>
        <span><Icon /></span>
        <div><small>{label}</small><strong>{value}</strong><em>{percentage(used, limit)}% used</em></div>
        <i aria-label={`${percentage(used, limit)}% used`}><b style={{ width: `${percentage(used, limit)}%` }} /></i>
        {addon && <button type="button" className="bpo-kpi-add" aria-label={`Buy more ${addon.label}`} data-tooltip={`Buy more ${addon.label}`} onClick={() => { setAddonQuantity(1); setAddonError(""); setSelectedAddon(addon); }}><FiPlus /></button>}
      </article>)}
    </section>

    <section className="bpo-published-plans" aria-live="polite">
      <div className="bpo-published-plans-head">
        <div><h2>Available plans</h2><p>Buy up to two regular plans using your balance, or contact us about a custom offer.</p></div>
        {!loading && <span>{plans.length} {plans.length === 1 ? "plan" : "plans"} · {activePurchases.length}/2 active</span>}
      </div>

      {!loading && !error && <div className="bpo-plan-category-tabs" role="tablist" aria-label="Plan categories">{planCategories.map(category => <button key={category.id} type="button" role="tab" aria-selected={selectedCategory === category.id} className={selectedCategory === category.id ? "active" : ""} onClick={() => { setSelectedCategory(category.id); setPlanPage(1); }}>{category.label}</button>)}</div>}

      {loading ? <div className="bpo-public-plan-grid" aria-busy="true">{[1, 2, 3].map(item => <article className="bpo-public-plan-skeleton" key={item}><i /><b /><em /><span /><span /></article>)}</div>
        : error ? <div className="bpo-public-plan-state error"><FiX /><h3>Plans could not be loaded</h3><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>
          : <>{!visiblePlans.length && <div className="bpo-category-empty"><h3>No plans in this category yet</h3><p>Explore another category or talk to us about a plan built around your team.</p><button type="button" onClick={() => { setSelectedCategory("CUSTOM"); setPlanPage(1); }}>Explore custom plans</button></div>}<div className="bpo-public-plan-grid">{visiblePlans.map(plan => {
            const isCustom = plan.plan_kind === "CUSTOM";
            const isCustomRequest = plan.id === customPlanRequest.id;
            const current = activePurchases.some(purchase => purchase.plan_id === plan.id);
            const planLimitReached = regularActivePlans.length >= 2;
            const badge = isCustom ? "CUSTOM" : plan.plan_badge === "STANDARD" ? null : plan.plan_badge;
            return <article className={`bpo-public-plan-card ${badge ? `is-${badge.toLowerCase()}` : ""}`} key={plan.id}>
              <header><div><p>{isCustomRequest ? "CUSTOM PLAN" : isCustom ? "CUSTOM OFFER" : "PLAN"}</p><h3>{plan.name}</h3></div>{badge && <span>{badge === "EXCLUSIVE" ? <FiStar /> : badge === "CUSTOM" ? <FiMessageCircle /> : <FiCheck />}{badgeLabel(badge)}</span>}</header>
              <p className="bpo-public-plan-description">{plan.description}</p>
              <strong className={`bpo-public-plan-price ${isCustom ? "is-custom" : ""}`}>{isCustom ? <>Custom <small>Contact us to arrange it</small></> : <>{formatMoney(plan.price)}</>}</strong>
              {isCustomRequest ? <dl>
                <div><dt>Agents</dt><dd>Your requirement</dd></div>
                <div><dt>Calls &amp; minutes</dt><dd>Your requirement</dd></div>
                <div><dt>Storage</dt><dd>Your requirement</dd></div>
              </dl> : <dl>
                <div><dt>Allowed agents</dt><dd>{number(plan.agent_limit)} agents</dd></div>
                <div><dt>Call allowance</dt><dd>{number(plan.call_limit)} calls</dd></div>
                <div><dt>Total minutes</dt><dd>{number(plan.total_minutes)} min</dd></div>
                <div><dt>Storage</dt><dd>{storage(plan.storage_amount, plan.storage_unit)}</dd></div>
              </dl>}
              {Array.isArray(plan.benefits) && plan.benefits.length > 0 && <div className="bpo-public-plan-benefits"><small>What&apos;s included</small><ul>{plan.benefits.map((benefit, index) => <li key={`${plan.id}-${index}`}><FiCheck />{benefit}</li>)}</ul></div>}
              {isCustom
                ? <button className="bpo-buy-plan bpo-custom-plan-contact" type="button" disabled={current} onClick={() => void openCustomContact(plan)}>{current ? "Active custom plan" : "Contact to buy"} <FiMessageCircle /></button>
                : <button className="bpo-buy-plan" type="button" disabled={current || planLimitReached} onClick={() => { setPurchaseError(""); setSelectedPlan(plan); }}>{current ? "Already purchased" : planLimitReached ? "2 plans active" : "Buy plan"} <FiCreditCard /></button>}
            </article>;
          })}</div>{pageCount > 1 && <nav className="bpo-plan-pagination" aria-label="Available plan pages"><button type="button" aria-label="Previous page" data-tooltip="Previous page" disabled={currentPage === 1} onClick={() => setPlanPage(currentPage - 1)}><FiChevronLeft /></button>{Array.from({ length: pageCount }, (_, index) => index + 1).map(page => <button type="button" key={page} className={page === currentPage ? "active" : ""} aria-current={page === currentPage ? "page" : undefined} onClick={() => setPlanPage(page)}>{page}</button>)}<button type="button" aria-label="Next page" data-tooltip="Next page" disabled={currentPage === pageCount} onClick={() => setPlanPage(currentPage + 1)}><FiChevronRight /></button></nav>}</>}
    </section>

    {selectedPlan && <div className="bpo-plan-buy-backdrop" onMouseDown={event => event.target === event.currentTarget && !purchaseBusy && setSelectedPlan(null)}>
      <section className="bpo-plan-buy-modal" role="dialog" aria-modal="true" aria-labelledby="bpo-buy-plan-title">
        <button type="button" className="bpo-plan-buy-close" disabled={purchaseBusy} onClick={() => setSelectedPlan(null)} aria-label="Close"><FiX /></button>
        <span><FiCreditCard /></span><p className="bpo-eyebrow">PLAN PURCHASE</p><h2 id="bpo-buy-plan-title">Buy {selectedPlan.name}</h2>
        <p>This adds the plan to your active plans and uses <strong>{formatMoney(selectedPlan.price)}</strong> from your available balance of <strong>{formatMoney(balance)}</strong>.</p>
        {purchaseError && <p className="bpo-plan-buy-error">{purchaseError}</p>}
        <div><button type="button" disabled={purchaseBusy} onClick={() => setSelectedPlan(null)}>Cancel</button><button type="button" disabled={purchaseBusy} onClick={() => void purchase()}>{purchaseBusy ? "Buying..." : `Buy for ${formatMoney(selectedPlan.price)}`}</button></div>
      </section>
    </div>}

    {selectedAddon && <div className="bpo-plan-buy-backdrop" onMouseDown={event => event.target === event.currentTarget && !addonBusy && setSelectedAddon(null)}>
      <section className="bpo-plan-buy-modal" role="dialog" aria-modal="true" aria-labelledby="bpo-addon-buy-title">
        <button type="button" className="bpo-plan-buy-close" disabled={addonBusy} onClick={() => setSelectedAddon(null)} aria-label="Close"><FiX /></button>
        <span><FiCreditCard /></span><p className="bpo-eyebrow">BUY MORE</p><h2 id="bpo-addon-buy-title">Add {selectedAddon.label}</h2>
        <p>Price: <strong>{formatMoney(selectedAddon.price)}</strong> per {selectedAddon.unit}. Quick Dial is billed separately from plan call and minute allowances.</p>
        <label className="bpo-addon-quantity">Quantity<input type="number" min="1" max="1000000" value={addonQuantity} onChange={event => setAddonQuantity(Math.max(1, Math.floor(Number(event.target.value) || 1)))} /></label>
        <p>Total: <strong>{formatMoney(selectedAddon.price * addonQuantity)}</strong> from your available balance of <strong>{formatMoney(balance)}</strong>.</p>
        {addonError && <p className="bpo-plan-buy-error">{addonError}</p>}
        <div><button type="button" disabled={addonBusy} onClick={() => setSelectedAddon(null)}>Cancel</button><button type="button" disabled={addonBusy} onClick={() => void purchaseAddon()}>{addonBusy ? "Buying..." : "Confirm purchase"}</button></div>
      </section>
    </div>}

    {lowBalance && <div className="bpo-plan-buy-backdrop" onMouseDown={event => event.target === event.currentTarget && setLowBalance(null)}>
      <section className="bpo-plan-buy-modal bpo-low-balance-modal" role="dialog" aria-modal="true" aria-labelledby="bpo-low-balance-title">
        <button type="button" className="bpo-plan-buy-close" onClick={() => setLowBalance(null)} aria-label="Close"><FiX /></button>
        <span><FiCreditCard /></span><p className="bpo-eyebrow">LOW BALANCE</p><h2 id="bpo-low-balance-title">Top up your balance</h2>
        <p>This plan needs <strong>{formatMoney(lowBalance.required)}</strong>. Your balance is <strong>{formatMoney(lowBalance.balance)}</strong>, so you need <strong>{formatMoney(lowBalance.shortfall)}</strong> more.</p>
        <div><button type="button" onClick={() => setLowBalance(null)}>Cancel</button><button type="button" onClick={() => { setLowBalance(null); onAddCredits(); }}>Add funds</button></div>
      </section>
    </div>}

    {customContactPlan && <div className="bpo-plan-buy-backdrop" onMouseDown={event => event.target === event.currentTarget && setCustomContactPlan(null)}>
      <section className="bpo-plan-buy-modal bpo-custom-plan-contact-modal" role="dialog" aria-modal="true" aria-labelledby="bpo-custom-contact-title">
        <button type="button" className="bpo-plan-buy-close" onClick={() => setCustomContactPlan(null)} aria-label="Close"><FiX /></button>
        <span><FiMessageCircle /></span><p className="bpo-eyebrow">YOUR CUSTOM OFFER</p><h2 id="bpo-custom-contact-title">Arrange {customContactPlan.name}</h2>
        <p>{customContactPlan.id === customPlanRequest.id ? "Tell our team what you need and we will prepare a custom offer for your BPO account." : "This offer is prepared only for your BPO account. Contact our team to confirm pricing and activate it."}</p>
        {contactsLoading ? <div className="bpo-custom-contact-loading"><i /><i /><i /></div> : <div className="bpo-custom-plan-contact-links">
          <a className="bpo-contact-option whatsapp" href={creditContacts.whatsappUrl} target="_blank" rel="noopener noreferrer"><FaWhatsapp /><span><strong>WhatsApp</strong><small>Recommended · fastest response</small></span><FiSend /></a>
          <a className="bpo-contact-option instagram" href={creditContacts.instagramUrl} target="_blank" rel="noopener noreferrer"><FaInstagram /><span><strong>Instagram</strong><small>Message our support team</small></span><FiSend /></a>
          <a className="bpo-contact-option messenger" href={creditContacts.messengerUrl} target="_blank" rel="noopener noreferrer"><FaFacebookMessenger /><span><strong>Messenger</strong><small>Chat with our support team</small></span><FiSend /></a>
        </div>}
      </section>
    </div>}
  </main>;
}
