# Reserve agents and configured capacity

Adapter environment `SHAHVEX_PC_AI_MAX_SESSIONS=100`; adapter admission clamp now supports 100. Both protected native bridge configs have `maxCalls=100`. Local manual callback validation now accepts up to 100. Health readback verified adapter and both bridges at 100 with zero active/busy/starting calls. Original restart was performed only after confirming idle. Prefix router recognizes 3531–3550.

Created ten unique female agents with Lissa and illustrated avatars in the Unassigned team category: Natalie, Victoria, Isabella, Madison, Ava, Mia, Ella, Olivia, Charlotte and Lily. They reserve 78611–78620 / 3541–3550 in order. No campaign_agent_assignments rows were created; VoIP assignment campaign IDs and campaign preferences are empty. These are reserved app mappings, not provisioned native remote agents. No calls were originated. Existing twenty route owners are distinct and the previous ten were preserved.

Agents now use consistent responsive cards with avatar, identity, assignment, route, extension, call/lead metrics, editable voice and visible actions. Campaign categories remain separate and cards sort by remote number. Groups sort by first remote number. Unassigned profiles are not ready; backend rejects starting native intake without a campaign.

Validation: 53 targeted tests passed, two preexisting opt-in tests skipped; includes admitting 100 independent sessions and rejecting the 101st, dedicated route ownership, rejection of unassigned campaign starts, and prefix routing through 3550. TypeScript passed. Actual controller components passed edit/single-delete/bulk-delete/cancel checks using isolated API fixtures. Twenty-card/two-category desktop and mobile preview passed with no page errors or horizontal overflow. No 100-call audio load test was performed.

Agent creation audit: `restore/reports/unassigned-ten-agents-20261114.json`. Updated complete route table: workspace `artifacts/agent-extension-routes.csv`. Runtime capacity remains editable in the same environment/config files.
