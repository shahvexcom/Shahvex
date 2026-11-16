# Controller agent roster and routes

Implemented category grouping, numeric dedicated-route ordering, avatars, extension/remote labels, responsive agent cards, visible edit/delete and bulk removal. Controller scheduling controls and automatic scheduling endpoints are paused; BPO scheduling remains separate. Dedicated routes cannot be borrowed by another agent.

Seven agents were created in the existing USA Outbond / DIALER campaign with editable Lissa voice: Sarah, Emily, Sophia, Amelia, Hannah, Grace and Chloe. Original route owners were preserved. Jenifer remains unmapped by explicit user choice. The route CSV is at workspace `artifacts/agent-extension-routes.csv`.

Verified 105 targeted regression tests, TypeScript no-emit validation, isolated Chromium tests for actual controller components and live cards, mobile overflow and route order. UI fixtures did not delete actual agents. All eleven active agents have avatar paths. No customer calls were originated during verification.

The conversation adapter, both native bridges and audio prefix router were restarted only after adapter sessions and bridge active/starting counts were all zero. Runtime concurrency remains three; ten mappings do not imply ten simultaneous calls. Extension dialplan setup in VICIdial remains the user's planned step.

Native readback verified all ten Remote Agent entries in DIALER. Newly added 78604–78610 are INACTIVE with one line each and extension 3534–3540 on the existing voice server. Original 78601–78603 rows were compared before/after and preserved. Native membership audit: `restore/reports/native-campaign-membership-20261114.json`.

Final database readback: ten non-deleted controller agents, all ten with avatars and Lissa. Jenifer was deleted independently during the session (12:27:49 UTC); her unmapped route state and deletion were preserved. No agent was restored.
