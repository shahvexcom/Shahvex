/** Conservative display categories derived only from the assigned script. */
const campaigns: { label: string; terms: RegExp[] }[] = [
  {
    label: "Final Expense",
    terms: [
      /\bfinal[-\s]+expense\b/i,
      /\b(?:burial|funeral)\s+(?:insurance|coverage|expenses)\b/i,
    ],
  },
  {
    label: "Life Insurance",
    terms: [/\blife\s+insurance\b/i, /\b(?:term|whole)\s+life\b/i],
  },
  {
    label: "Medicare",
    terms: [
      /\bmedicare\b/i,
      /\bmedigap\b/i,
      /\bpart\s+[ab]\s+(?:and|&)\s+(?:part\s+)?[ab]\b/i,
    ],
  },
  {
    label: "ACA / Health Insurance",
    terms: [
      /\b(?:aca|obamacare|affordable\s+care\s+act)\b/i,
      /\b(?:health\s+insurance|marketplace\s+coverage)\b/i,
    ],
  },
  { label: "Solar", terms: [/\bsolar\b/i, /\bphotovoltaic\b/i] },
  {
    label: "Home Improvement",
    terms: [
      /\bhome\s+improvement\b/i,
      /\b(?:roofing|hvac|window\s+replacement)\b/i,
    ],
  },
  {
    label: "Real Estate",
    terms: [
      /\breal\s+estate\b/i,
      /\b(?:property\s+(?:buyer|seller|listing)|mortgage)\b/i,
    ],
  },
  {
    label: "Debt Relief",
    terms: [
      /\bdebt\s+(?:relief|settlement|consolidation)\b/i,
      /\bcredit\s+repair\b/i,
    ],
  },
  {
    label: "Healthcare / Appointments",
    terms: [/\b(?:clinic|dental|patient)\b/i, /\bmedical\s+appointment\b/i],
  },
  {
    label: "Customer Support",
    terms: [/\bcustomer\s+(?:support|service)\b/i, /\btechnical\s+support\b/i],
  },
];

export function agentScriptCategory(script?: string | null): string {
  if (!script?.trim()) return "No script assigned";
  // An explicit script category takes precedence over inferred campaign terms.
  const explicit = script
    .match(
      /^\s*(?:#{1,6}\s*)?(?:category|campaign\s+category)\s*:\s*([^\r\n]{1,64})\s*$/im,
    )?.[1]
    .trim();
  if (explicit) return explicit;
  const matches = campaigns
    .map((campaign) => ({
      label: campaign.label,
      score: campaign.terms.reduce(
        (sum, term) =>
          sum +
          Math.min(
            4,
            [...script.matchAll(new RegExp(term.source, `${term.flags}g`))]
              .length,
          ),
        0,
      ),
    }))
    .filter((campaign) => campaign.score > 0);
  // Final-expense scripts routinely describe their product as life insurance.
  const candidates = matches.some(
    (campaign) => campaign.label === "Final Expense",
  )
    ? matches.filter((campaign) => campaign.label !== "Life Insurance")
    : matches;
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return "Uncategorized";
  if (candidates[1]?.score === candidates[0].score) return "Multiple campaigns";
  return candidates[0].label;
}
