# Shahvex AI telephony migration

Current implementation update: loader neutralization and retired-test diagnosis are in [security-review.md](security-review.md); the confirmed separate Windows engine and authenticated SSH bridge are in [physical-engine-bridge.md](physical-engine-bridge.md). The gateway now has a local full-duplex mock transport, streaming Ollama parsing, Chatterbox WAV conversion and an isolated Whisper library wrapper. Live physical-server/VICIdial tests and website RBAC wiring remain pending. The initial audit below is historical context, not deployment instructions for legacy calling.

## Inspection and backup (before code changes)

The current application is Next.js 16 / React 19 with PostgreSQL (`lib/database.ts`, schema version 24), Prisma definitions, signed cookie sessions, controller (`/controler`), agent and BPO portals. Runtime SQL is authoritative for many operational tables; Prisma alone is not a complete backup/migration mechanism.

Keep every page, component, stylesheet, navigation, responsive layout and animation unchanged. Reuse existing script assignments, lead suppression and claims, BPO ownership/entitlements, schedules, account approval and call reports. No voice engine settings are changed.

Telnyx dependencies: `@telnyx/webrtc`, `lib/call-start.ts`, `lib/agent-call-detail.ts`, `/api/telnyx/webhook`, admin/BPO call commands and recording routes, quick-dial routes and browser components, credentials and voice assignment routes, provider-specific fields in SQL/Prisma, `.env.example`, README and legacy tests. Groq currently supplies conversation inference. These are coupled to provider-specific identifiers; changing only the dial request would break controls and reporting.

Source snapshots of call-start, call-detail, webhook and Prisma schema are in `backups/telephony`. Existing Git history provides the remaining source snapshot. No secrets were copied. Before any database migration, the operator must create an encrypted `pg_dump --format=custom` backup, separately escrow secrets, and demonstrate restore into an isolated database. No database backup or live migration has been performed by this task.

## Stages and rollback

1. Add isolated, dependency-free gateway core and explicit telephony contracts; run synthetic tests. Existing calling stays operational.
2. Engineer confirms interfaces below. Implement a version-specific adapter and locally installed STT/TTS clients against captured fixtures; never guess endpoints or codecs.
3. Add reviewed additive SQL for provider-neutral call IDs, campaign/agent configuration, event deduplication and results. Retain legacy IDs, secrets, enums and accounts. Reuse existing role/ownership checks on all configuration and call routes.
4. Connect existing start/command/report routes to provider selection per call, retaining reservation locks, suppression, budgets and uncertain-submission handling. Browser Quick Dial needs separately verified SIP/WebRTC support. Do not switch global provider while legacy calls are active.
5. Test inbound/outbound audio, transfers, recording, transcripts, event retries/reordering, ownership and cleanup in the client's test environment. Restore rehearsal and operator sign-off precede a limited canary.
6. Drain legacy calls, switch new calls, monitor, then remove the SDK and old services only after replacement integration tests pass. Roll back new-call routing while retaining all new records for reconciliation. Do not drop columns on rollback.

## Required from VICIdial engineer

Supply VICIdial/Asterisk versions, topology and test tenant; enabled and authorized call-control interface (including exact request/response examples); supported media interface and dialplan ownership; sample rates, codecs, packetization and framing; TLS/mTLS/auth and network allowlists; stable call correlation IDs, ordered lifecycle events and retry semantics; inbound routes and outbound caller IDs/trunks; campaign/list ownership; transfer types, allowlisted destinations and failure behavior; recording consent, storage/auth/retention; disposition/report writeback contract. No client server installation or configuration is authorized here.

## Local verification and deployment gates

Run `node --test tests/gateway.test.cjs tests/agent-calls.test.cjs` and `node node_modules/typescript/bin/tsc --noEmit --incremental false`. Gateway smoke check: set a random 32+ character `SHAHVEX_GATEWAY_TOKEN`, run `node gateway/server.cjs`, then request `/health` on port 8787 with a Bearer token. Unauthenticated requests must return 401.

The core is a foundation, not a live VICIdial integration. STT/TTS wire protocols, streaming transport, persistence, role-authorized website routes and real adapter remain gated on confirmed contracts. Installed voice verification is required before advertising any profile, including the supplied female development voice. Existing UI configuration is not evidence of an installed model.

Deployment checklist: resolve the existing obfuscated remote-code loaders in `init` and `postcss.config.mjs` through a separate security review before running build/dev; restore backup; provision separate gateway identity/token and private network; keep model ports 11434/8765 and STT private; enable TLS at a controlled proxy; enforce tenant ownership and campaign assignment server-side; configure consent/disclosure requirements with campaign owners; bound request/audio/session sizes; add durable event/outbox storage, idle expiry and crash reconciliation; test redaction/retention; measure queue wait, STT/LLM/TTS and first-audio p50/p95/p99, cancellation latency, VRAM and CPU at 1/5/10 calls before increasing admission.

100 active calls is a design target only. The RTX 4060 8GB is development hardware. Deploy multiple GPU-tagged inference workers with sticky per-call ownership, bounded broker queues and global admission limits only after measured sizing. The included queue is process-local and must not be interpreted as a distributed scheduler or capacity benchmark.
