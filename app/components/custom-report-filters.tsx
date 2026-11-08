"use client";
import { useEffect } from "react";

function enhance() {
  const root = document.querySelector<HTMLElement>(".call-report-filters");
  if (!root) return;
  const selects = Array.from(root.querySelectorAll<HTMLSelectElement>("select"));
  const optionCount = selects.map((select) => select.options.length).join(",");
  if (root.dataset.customized === optionCount) return;
  root.querySelectorAll(".custom-report-select").forEach((item) => item.remove());
  selects.forEach((select) => { select.style.display = ""; });
  root.dataset.customized = optionCount;
  selects.forEach((select) => {
    const wrap = document.createElement("div"), button = document.createElement("button"), menu = document.createElement("div");
    wrap.className = "custom-report-select"; button.type = "button"; button.className = "custom-report-select-button"; menu.className = "custom-report-select-menu";
    const sync = () => { button.textContent = select.selectedOptions[0]?.text || "Select"; menu.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", (item as HTMLElement).dataset.value === select.value)); };
    Array.from(select.options).forEach((option) => { const item = document.createElement("button"); item.type = "button"; item.dataset.value = option.value; item.textContent = option.text; item.onclick = () => { select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); sync(); wrap.classList.remove("open"); }; menu.appendChild(item); });
    button.onclick = () => { const wasOpen = wrap.classList.contains("open"); root.querySelectorAll(".custom-report-select.open").forEach((item) => item.classList.remove("open")); if (!wasOpen) wrap.classList.add("open"); };
    select.style.display = "none"; wrap.append(button, menu); select.parentElement?.insertBefore(wrap, select); sync();
  });
}
export function CustomReportFilters() { useEffect(() => { enhance(); let disposed = false; const loadAgents = async () => { const root = document.querySelector<HTMLElement>(".call-report-filters"); const agentSelect = root?.querySelector<HTMLSelectElement>("select:nth-of-type(2)"); if (!agentSelect) return; if (!agentSelect.options.length) { const loading = document.createElement("option"); loading.value = "__LOADING__"; loading.text = "Loading agents..."; loading.disabled = true; agentSelect.appendChild(loading); } try { const response = await fetch("/api/admin/agents", { cache: "no-store" }); const data = await response.json(); if (disposed) return; agentSelect.querySelector('option[value="__LOADING__"]')?.remove(); (data.agents ?? []).forEach((agent: { id: string; name: string; username?: string }) => { const label = `${agent.name}${agent.username ? ` (@${agent.username})` : ""}`; if (![...agentSelect.options].some((option) => option.value === agent.name)) { const option = document.createElement("option"); option.value = agent.name; option.text = label; agentSelect.appendChild(option); } }); enhance(); } catch { agentSelect.querySelector('option[value="__LOADING__"]')?.remove(); } }; void loadAgents(); const observer = new MutationObserver(() => { enhance(); void loadAgents(); }); observer.observe(document.body, { childList: true, subtree: true }); return () => { disposed = true; observer.disconnect(); }; }, []); return null; }
