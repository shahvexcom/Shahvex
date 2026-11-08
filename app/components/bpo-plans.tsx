"use client";

import { CustomSelect } from "@/app/components/custom-select";
import { useCallback, useEffect, useState } from "react";
import { FiCheckCircle, FiEdit3, FiPlus, FiRefreshCw, FiSave, FiSlash, FiTrash2, FiX } from "react-icons/fi";
import { CustomDropdown } from "./custom-dropdown";

type BpoPlan = {
  id: string;
  name: string;
  description: string;
  price: string;
  is_active: boolean;
  plan_badge: "STANDARD" | "RECOMMENDED" | "EXCLUSIVE" | "CUSTOM";
  plan_kind: "STANDARD" | "CUSTOM";
  assigned_bpo_id: string | null;
  benefits: string[];
  agent_limit: number;
  call_limit: number;
  total_minutes: number;
  storage_amount: number;
  storage_unit: "MB" | "GB";
  updated_at: string;
};

type BpoUser = { id: string; name: string; email: string | null; status: string };
type UsagePricing = { agentUnitPrice: number; callUnitPrice: number; minuteUnitPrice: number; recordingUnitPrice: number; storageUnitPrice: number; storageUnit: "MB" | "GB" };

type PlanForm = {
  id?: string;
  name: string;
  description: string;
  price: string;
  isActive: boolean;
  planBadge: "STANDARD" | "RECOMMENDED" | "EXCLUSIVE";
  planKind: "STANDARD" | "CUSTOM";
  assignedBpoId: string;
  benefits: string[];
  agentLimit: string;
  callLimit: string;
  totalMinutes: string;
  storageAmount: string;
  storageUnit: "MB" | "GB";
};

const newPlan = (planKind: PlanForm["planKind"] = "STANDARD"): PlanForm => ({ name: "", description: "", price: "", isActive: true, planBadge: "STANDARD", planKind, assignedBpoId: "", benefits: [""], agentLimit: "", callLimit: "", totalMinutes: "", storageAmount: "", storageUnit: "GB" });
const money = (value: number | string) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function json(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: `Request failed (${response.status}).` }; }
}

export function BpoPlans({ onAction }: { onAction: (message: string, kind?: "success" | "error") => void }) {
  const [plans, setPlans] = useState<BpoPlan[]>([]);
  const [bpoUsers, setBpoUsers] = useState<BpoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<PlanForm | null>(null);
  const [confirm, setConfirm] = useState<BpoPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [usagePricing, setUsagePricing] = useState<UsagePricing>({ agentUnitPrice: 0, callUnitPrice: 0, minuteUnitPrice: 0, recordingUnitPrice: 0, storageUnitPrice: 0, storageUnit: "GB" });
  const [pricingBusy, setPricingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/bpo/plans", { cache: "no-store" });
      const data = await json(response);
      if (!response.ok) throw new Error(data.message || "Unable to load plans.");
      setPlans(data.plans ?? []);
      setBpoUsers(data.bpoUsers ?? []);
      if (data.usagePricing) setUsagePricing({ agentUnitPrice: Number(data.usagePricing.agentUnitPrice || 0), callUnitPrice: Number(data.usagePricing.callUnitPrice || 0), minuteUnitPrice: Number(data.usagePricing.minuteUnitPrice || 0), recordingUnitPrice: Number(data.usagePricing.recordingUnitPrice || 0), storageUnitPrice: Number(data.usagePricing.storageUnitPrice || 0), storageUnit: data.usagePricing.storageUnit === "MB" ? "MB" : "GB" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load plans."); }
    finally { setLoading(false); }
  }, []);

  // The plan list intentionally loads after this client panel mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const edit = (plan: BpoPlan) => {
    setError("");
    setForm({
      id: plan.id, name: plan.name, description: plan.description, price: String(plan.price), isActive: plan.is_active,
      planBadge: plan.plan_badge === "CUSTOM" ? "STANDARD" : plan.plan_badge || "STANDARD", planKind: plan.plan_kind || "STANDARD", assignedBpoId: plan.assigned_bpo_id || "",
      benefits: Array.isArray(plan.benefits) && plan.benefits.length ? plan.benefits : [""], agentLimit: String(plan.agent_limit), callLimit: String(plan.call_limit),
      totalMinutes: String(plan.total_minutes), storageAmount: String(plan.storage_amount), storageUnit: plan.storage_unit,
    });
  };

  const change = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm(current => current ? { ...current, [key]: value } : null);
  const changeBenefit = (index: number, value: string) => setForm(current => current ? { ...current, benefits: current.benefits.map((benefit, item) => item === index ? value : benefit) } : null);
  const addBenefit = () => setForm(current => current ? { ...current, benefits: [...current.benefits, ""] } : null);
  const removeBenefit = (index: number) => setForm(current => current ? { ...current, benefits: current.benefits.length === 1 ? current.benefits : current.benefits.filter((_, item) => item !== index) } : null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (!form.price || !form.agentLimit || !form.callLimit || !form.totalMinutes || !form.storageAmount) {
      setError("Enter the price, allowed agents, calls, total minutes and storage.");
      return;
    }
    if (form.planKind === "CUSTOM" && !form.assignedBpoId) {
      setError("Choose the BPO user who should receive this custom offer.");
      return;
    }
    setBusy(true); setError("");
    const body = {
      ...(form.id ? { id: form.id } : {}),
      name: form.name,
      description: form.description,
      price: Number(form.price),
      isActive: form.isActive,
      planBadge: form.planBadge,
      planKind: form.planKind === "CUSTOM" ? "CUSTOM" : "STANDARD",
      ...(form.planKind === "CUSTOM" ? { assignedBpoId: form.assignedBpoId } : {}),
      benefits: form.benefits.map(item => item.trim()).filter(Boolean),
      agentLimit: Number(form.agentLimit),
      callLimit: Number(form.callLimit),
      totalMinutes: Number(form.totalMinutes),
      storageAmount: Number(form.storageAmount),
      storageUnit: form.storageUnit,
    };
    try {
      const response = await fetch("/api/admin/bpo/plans", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await json(response);
      if (!response.ok) throw new Error(data.message || "Unable to save plan.");
      setPlans(current => form.id ? current.map(plan => plan.id === data.plan.id ? data.plan : plan) : [data.plan, ...current]);
      setForm(null); onAction(data.message, "success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save plan."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/bpo/plans?id=${encodeURIComponent(confirm.id)}`, { method: "DELETE" });
      const data = await json(response);
      if (!response.ok) throw new Error(data.message || "Unable to delete plan.");
      setPlans(current => current.filter(plan => plan.id !== data.deletedId));
      setConfirm(null); onAction(data.message, "success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete plan."); }
    finally { setBusy(false); }
  };

  const saveUsagePricing = async (event: React.FormEvent) => {
    event.preventDefault();
    setPricingBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/bpo/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-usage-pricing", ...usagePricing }) });
      const data = await json(response);
      if (!response.ok) throw new Error(data.message || "Unable to update usage prices.");
      setUsagePricing(data.usagePricing);
      onAction(data.message, "success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update usage prices."); }
    finally { setPricingBusy(false); }
  };

  return <section className="bpo-plan-section">
    <div className="bpo-section-heading">
      <div><p>PLAN CREATOR</p><h1>BPO plans</h1><span>Create regular plans or a private custom offer for one selected BPO user.</span></div>
      <div><button className="admin-outline" type="button" onClick={() => void load()} disabled={loading}><FiRefreshCw /> Refresh</button><button className="admin-outline bpo-create-custom-offer" type="button" onClick={() => { setError(""); setForm(newPlan("CUSTOM")); }}><FiPlus /> Create custom offer</button><button className="admin-primary" type="button" onClick={() => { setError(""); setForm(newPlan()); }}><FiPlus /> Create regular plan</button></div>
    </div>

    <form className="bpo-usage-pricing" onSubmit={saveUsagePricing}>
      <div><p>SEPARATE USAGE PRICES</p><h2>Agent, calling &amp; recording prices</h2><span>These prices power one-by-one add-ons. Quick Dial charges the call-minute and recording prices directly from the BPO balance.</span></div>
      <label>Agent slot <small>PKR each</small><input type="number" min="0" step="0.01" value={usagePricing.agentUnitPrice} onChange={event => setUsagePricing(current => ({ ...current, agentUnitPrice: Number(event.target.value) }))} /></label>
      <label>Extra call <small>PKR each</small><input type="number" min="0" step="0.01" value={usagePricing.callUnitPrice} onChange={event => setUsagePricing(current => ({ ...current, callUnitPrice: Number(event.target.value) }))} /></label>
      <label>Call minute <small>PKR / min</small><input type="number" min="0" step="0.01" value={usagePricing.minuteUnitPrice} onChange={event => setUsagePricing(current => ({ ...current, minuteUnitPrice: Number(event.target.value) }))} /></label>
      <label>Recording <small>PKR each</small><input type="number" min="0" step="0.01" value={usagePricing.recordingUnitPrice} onChange={event => setUsagePricing(current => ({ ...current, recordingUnitPrice: Number(event.target.value) }))} /></label>
      <label>Storage <small>PKR / {usagePricing.storageUnit}</small><span className="bpo-storage-price"><input type="number" min="0" step="0.01" value={usagePricing.storageUnitPrice} onChange={event => setUsagePricing(current => ({ ...current, storageUnitPrice: Number(event.target.value) }))} /><CustomDropdown value={usagePricing.storageUnit} onChange={value => setUsagePricing(current => ({ ...current, storageUnit: value as "MB" | "GB" }))} ariaLabel="Storage billing unit" options={[{ value: "MB", label: "MB" }, { value: "GB", label: "GB" }]} /></span></label>
      <button className="admin-primary" disabled={pricingBusy}><FiSave /> {pricingBusy ? "Saving..." : "Save prices"}</button>
    </form>

    {loading ? <div className="bpo-plan-grid" aria-busy="true">{[1, 2, 3].map(item => <div className="bpo-plan-skeleton bpo-shimmer" key={item} />)}</div>
      : error && !form && !confirm ? <div className="bpo-admin-error"><FiSlash /><h2>Could not load plans</h2><p>{error}</p><button className="admin-primary" onClick={() => void load()}>Try again</button></div>
        : plans.length ? <div className="bpo-plan-grid">{plans.map(plan => {
          const isCustom = plan.plan_kind === "CUSTOM";
          const recipient = bpoUsers.find(user => user.id === plan.assigned_bpo_id);
          return <article className={`bpo-plan-card ${plan.is_active ? "" : "is-inactive"} ${isCustom ? "is-custom" : ""}`} key={plan.id}>
          <header><div><span className="bpo-plan-status"><i className={plan.is_active ? "active" : "inactive"} />{plan.is_active ? "Active" : "Inactive"}</span>{isCustom ? <span className="bpo-plan-badge custom">Custom</span> : plan.plan_badge !== "STANDARD" && <span className={`bpo-plan-badge ${plan.plan_badge.toLowerCase()}`}>{plan.plan_badge === "EXCLUSIVE" ? "Exclusive" : "Recommended"}</span>}<h2>{plan.name}</h2></div><strong>{isCustom ? "Custom" : <>{money(plan.price)} <small>PKR</small></>}</strong></header>
          <p className="bpo-plan-description">{plan.description}</p>
          {isCustom && <p className="bpo-plan-recipient"><b>Assigned to</b> {recipient ? `${recipient.name}${recipient.email ? ` · ${recipient.email}` : ""}` : "Selected BPO user"}</p>}
          <dl><div><dt>Allowed agents</dt><dd>{Number(plan.agent_limit).toLocaleString()} agents</dd></div><div><dt>Call allowance</dt><dd>{Number(plan.call_limit).toLocaleString()} calls</dd></div><div><dt>Total minutes</dt><dd>{Number(plan.total_minutes).toLocaleString()} min</dd></div><div><dt>Storage</dt><dd>{plan.storage_amount} {plan.storage_unit}</dd></div></dl>
          <div className="bpo-plan-benefits"><small>Plan benefits</small><ul>{plan.benefits.map((benefit, index) => <li key={`${plan.id}-${index}`}><FiCheckCircle />{benefit}</li>)}</ul></div>
          <footer><small>Updated {new Date(plan.updated_at).toLocaleDateString()}</small><span><button type="button" onClick={() => edit(plan)}><FiEdit3 /> Edit</button><button type="button" className="danger" onClick={() => { setError(""); setConfirm(plan); }} aria-label={`Delete ${plan.name}`}><FiTrash2 /></button></span></footer>
        </article>})}</div>
        : <div className="bpo-plans-empty"><FiPlus /><h2>No plans yet</h2><p>Create a regular plan or make a private custom offer for one BPO user.</p><button className="admin-primary" onClick={() => setForm(newPlan())}>Create regular plan</button><button className="admin-outline bpo-empty-custom-offer" onClick={() => setForm(newPlan("CUSTOM"))}>Create custom offer</button></div>}

    {form && <div className="agent-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && setForm(null)}><form className="agent-modal bpo-plan-modal" onSubmit={save}>
      <header><div><p>{form.id ? "EDIT BPO PLAN" : form.planKind === "CUSTOM" ? "NEW PRIVATE OFFER" : "NEW BPO PLAN"}</p><h2>{form.id ? `Edit ${form.name}` : form.planKind === "CUSTOM" ? "Create custom offer" : "Create regular plan"}</h2></div><button type="button" disabled={busy} onClick={() => setForm(null)} aria-label="Close"><FiX /></button></header>
      {form.id && form.planKind === "CUSTOM" && <p className="bpo-custom-edit-note">You can edit the custom plan details below. Saving refreshes this user&apos;s active limits immediately; the assigned user and amount already charged stay protected.</p>}
      <div className="bpo-plan-form-grid"><label>Plan name<input required maxLength={100} value={form.name} onChange={event => change("name", event.target.value)} placeholder="e.g. Growth plan" /></label><label>Plan type<CustomDropdown value={form.planKind} disabled={Boolean(form.id)} onChange={value => change("planKind", value as PlanForm["planKind"])} ariaLabel="Plan type" options={[{ value: "STANDARD", label: "Regular PKR plan" }, { value: "CUSTOM", label: "Custom offer (one user)" }]} /><small>{form.id ? "Plan type cannot change after creation." : "Custom offers are visible only to the BPO user you select."}</small></label>{form.planKind === "CUSTOM" ? <label>PKR amount to deduct<input required disabled={Boolean(form.id)} type="number" min="0.01" max="10000000" step="0.01" value={form.price} onChange={event => change("price", event.target.value)} placeholder="e.g. 999" /><small>{form.id ? "This was charged when the custom plan was activated." : "This amount is deducted immediately. The BPO user still sees Custom, not this price."}</small></label> : <label>Amount (PKR)<input required type="number" min="0" max="10000000" step="0.01" value={form.price} onChange={event => change("price", event.target.value)} placeholder="e.g. 999" /></label>}{form.planKind === "CUSTOM" && <label className="wide">Assign to BPO user<CustomSelect required disabled={Boolean(form.id)} value={form.assignedBpoId} onChange={event => change("assignedBpoId", event.target.value)}><option value="">Select the only user who can see this offer</option>{bpoUsers.map(user => <option key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ""}{user.status === "APPROVED" ? "" : ` (${user.status.toLowerCase()})`}</option>)}</CustomSelect><small>{form.id ? "This custom plan is already active for this user." : "Creating this plan immediately deducts the amount and activates it for this user."}</small></label>}<label className="wide">Description<textarea required maxLength={2000} rows={3} value={form.description} onChange={event => change("description", event.target.value)} placeholder="Describe who this plan is for." /></label><label>Allowed agents<input required type="number" min="0" max="10000000" step="1" value={form.agentLimit} onChange={event => change("agentLimit", event.target.value)} placeholder="e.g. 5" /><small>How many agents this plan allows you to create.</small></label><label>Call allowance<input required type="number" min="0" max="10000000" step="1" value={form.callLimit} onChange={event => change("callLimit", event.target.value)} placeholder="e.g. 300" /><small>How many calls this plan includes.</small></label><label>Total minutes<input required type="number" min="0" max="10000000" step="1" value={form.totalMinutes} onChange={event => change("totalMinutes", event.target.value)} placeholder="e.g. 1,500" /><small>Total call minutes included in this plan.</small></label><label>Storage allowance<span className="bpo-storage-input"><input required type="number" min="0.01" max="10000000" step="0.01" value={form.storageAmount} onChange={event => change("storageAmount", event.target.value)} placeholder="e.g. 5" /><CustomDropdown className="bpo-storage-dropdown" value={form.storageUnit} onChange={value => change("storageUnit", value as "MB" | "GB")} ariaLabel="Storage unit" options={[{ value: "MB", label: "MB" }, { value: "GB", label: "GB" }]} /></span><small>Enter storage in MB or GB.</small></label>{form.planKind === "STANDARD" && <><label>Plan status<CustomDropdown value={form.isActive ? "active" : "inactive"} onChange={value => change("isActive", value === "active")} ariaLabel="Plan status" options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /></label><label>Plan badge<CustomDropdown value={form.planBadge} onChange={value => change("planBadge", value as PlanForm["planBadge"])} ariaLabel="Plan badge" options={[{ value: "STANDARD", label: "Not recommended" }, { value: "RECOMMENDED", label: "Recommended" }, { value: "EXCLUSIVE", label: "Exclusive" }]} /><small>Show this badge to BPO users.</small></label></>}</div>
      <fieldset className="bpo-benefit-editor"><legend>What does the user get?</legend><p>Add as many benefits as you need, for example: “300 calls included”.</p>{form.benefits.map((benefit, index) => <div key={index}><input required maxLength={300} value={benefit} onChange={event => changeBenefit(index, event.target.value)} placeholder={`Benefit ${index + 1}`} /><button type="button" disabled={form.benefits.length === 1} onClick={() => removeBenefit(index)} aria-label={`Remove benefit ${index + 1}`}><FiTrash2 /></button></div>)}<button className="bpo-add-benefit" type="button" onClick={addBenefit}><FiPlus /> Add another benefit</button></fieldset>
      {error && <p className="agent-form-error">{error}</p>}
      <footer><button type="button" className="admin-outline" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="admin-primary" disabled={busy}><FiSave /> {busy ? "Saving…" : form.id ? "Save changes" : "Create plan"}</button></footer>
    </form></div>}

    {confirm && <div className="agent-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && setConfirm(null)}><section className="agent-modal bpo-plan-delete"><header><div><p>DELETE BPO PLAN</p><h2>Delete {confirm.name}?</h2></div><button disabled={busy} onClick={() => setConfirm(null)} aria-label="Close"><FiX /></button></header><p>This permanently removes the plan. Existing customer data will not be changed.</p>{error && <p className="agent-form-error">{error}</p>}<footer><button className="admin-outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button className="admin-primary danger-button" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete plan"}</button></footer></section></div>}
  </section>;
}
