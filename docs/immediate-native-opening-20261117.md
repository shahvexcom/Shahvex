# Immediate native introductions — 17 November 2026

Activated on the running website, adapter, and both native bridges. Customer-first and AI-first native sessions now request the introduction immediately after media admission. There is no intentional customer-speech wait. Native identity, reservation, and media activation checks remain enforced.

Observed before activation: production bridge logs showed 2.75–2.81 seconds admission and 9.5–9.9 seconds to first PCM from AudioSocket acceptance. A conflicting Next development server occupied port 3000 while the production unit repeatedly failed with EADDRINUSE. Cold synthetic intro synthesis took 3.3–5.4 seconds.

Changes:

- Deterministic first introductions use a private persistent PCM cache shared by the website and adapter under the project working directory `.data/opening-pcm-v1`. Only introductions are persisted here; customer audio is excluded. Cache keys include exact wording, voice, and emotion. Changed wording or voice gets a different key. Increment `SHAHVEX_OPENING_CACHE_REVISION` or clear the opening directory when replacing voice models under an existing voice ID.
- Adapter session allocation starts nonblocking intro preparation. All 20 currently assigned agent profiles were explicitly prewarmed using their queued config and campaign script, without dialing customers. Existing identical introductions share cache entries.
- Production website now runs through its supervised unit with `SHAHVEX_NEXT_DIST_DIR=.next-live-ready`; the conflicting development server was stopped. Each service activation followed signed zero-call/zero-session checks. Stuck idle website shutdowns were completed before pending restarts.
- `restore/tools/prepare-agent-openings.cjs` can prepare assigned introductions after script/voice updates. It reads campaign/profile configuration and uses temporary local synthetic sessions, closing each session afterward. It does not originate calls or activate remote agents.

Validation:

- Production builds and TypeScript passed.
- 22 stream tests, 29 VICIdial/bridge regressions, one persistent-cache regression, and two recovery/presence regressions passed. The bridge regression now explicitly checks that customer-first calls send opening audio before any customer speech, then still process customer speech and exclude human handoff audio.
- After restarting the adapter, all 20 configured intros replayed first PCM in 1–9 ms. Final synthetic customer-first opening: allocation 61 ms, first PCM 9 ms, total 70 ms. AI-first: allocation 1 ms, first PCM 3 ms, total 4 ms. Both say “Hello, this is Lauren. How are you today?” in the synthetic test config.
- Signed final health: campaign/manual bridges and adapter healthy; zero calls/connections/starting sessions; configured capacity remains 101. Website unit and all three voice/bridge units active.
- The broader adapter lifecycle suite has three unresolved assertions (six pass/two skip), including follow-up prompt expectations and leaked session capacity after an earlier test failure; it is not claimed as passing.

Evidence: `restore/reports/immediate-opening-live-20261117.json`, `restore/reports/prepared-agent-openings-20261117.json`.

These timings measure local prepared audio, not carrier answer-to-customer-ear latency. No real customer/carrier call was placed. Native verification/admission and remote telephony routing still add time; a fresh real VICIdial call is required to measure that full path. No zero-latency guarantee is made.
