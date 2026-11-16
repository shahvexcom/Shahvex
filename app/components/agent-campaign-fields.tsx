"use client";
import { useEffect, useState } from "react";
import { CustomSelect } from "./custom-select";

type Assignment = {
  campaign_definition_id?: string;
  preferred_category_id?: string;
  preferred_campaign_id?: string;
};
type Campaign = { id: string; name: string; category_id: string | null; external_campaign_id: string };
type Category = { id: string; name: string };
export function AgentCampaignFields({ value, onChange }: { value: Assignment; onChange: (next: Assignment) => void }) {
  const [data, setData] = useState<{ campaigns: Campaign[]; categories: Category[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/campaigns", { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw Error(result.error || "Unable to load campaigns"); setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  const current = data?.campaigns.find(c => c.id === value.campaign_definition_id);
  const category = value.preferred_category_id || current?.category_id || "";
  return <>
    <div className="agent-form-section"><span>Campaign assignment<small>Assign a campaign now, or select a category and campaign ID for a future campaign.</small></span></div>
    {error && <p role="alert" className="agent-form-error">{error}</p>}
    <label>Category<CustomSelect disabled={!data} value={category} onChange={event => onChange({ preferred_category_id: event.target.value, campaign_definition_id: "", preferred_campaign_id: "" })}>
      <option value="">No category preference</option>{data?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </CustomSelect></label>
    <label>Campaign<CustomSelect disabled={!data} value={value.campaign_definition_id || ""} onChange={event => {
      const campaign = data?.campaigns.find(c => c.id === event.target.value);
      onChange({ campaign_definition_id: event.target.value, preferred_category_id: campaign?.category_id || category, preferred_campaign_id: campaign?.external_campaign_id || "" });
    }}><option value="">Future campaign / unassigned</option>{data?.campaigns.filter(c => !category || c.category_id === category).map(c => <option key={c.id} value={c.id}>{c.name} · {c.external_campaign_id}</option>)}</CustomSelect></label>
    {!value.campaign_definition_id && <label>Future VICIdial campaign ID (optional)<input maxLength={80} pattern="[A-Za-z0-9_-]*" placeholder="e.g. CPA_01" value={value.preferred_campaign_id || ""} onChange={event => onChange({ preferred_campaign_id: event.target.value })} /><small>Matching campaigns will show this agent selected when you create them. Leave blank to match any new campaign in this category.</small></label>}
  </>;
}
