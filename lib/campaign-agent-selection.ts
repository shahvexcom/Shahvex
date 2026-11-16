type Candidate = {
  id: string;
  call_id?: string | null;
  campaign_id?: string | null;
  enabled?: boolean;
  preferred_category_id?: string | null;
  preferred_campaign_id?: string | null;
};
/** Preferences suggest a team; saving the campaign commits the reviewed selection. */
export function suggestedCampaignAgents(agents: Candidate[], categoryId: string | null, externalId: string) {
  return agents.filter(agent =>
    !agent.call_id && !agent.campaign_id &&
    Boolean(agent.preferred_category_id || agent.preferred_campaign_id) &&
    (!agent.preferred_category_id || agent.preferred_category_id === categoryId) &&
    (!agent.preferred_campaign_id || agent.preferred_campaign_id === externalId)
  ).map(agent => agent.id);
}
