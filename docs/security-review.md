# Loader review — 2026-11-02

Static inspection only: no loader/payload was executed and no discovered host was contacted. Original byte-for-byte files and SHA-256 manifest are preserved as inert `.txt` artifacts in `backups/security` (do not rename/import/execute them). They contain code, not copied environment secrets.

Both `init` and the appended PostCSS code contain the same obfuscated downloader. Readable function names and string tables show Ethereum JSON-RPC block/transaction/nonce lookup with an indexer fallback, address decoding to obtain a host, HTTP GET/HEAD payload retrieval, base64/XOR decoding, and remote execution through `eval` plus a detached, hidden `node -i` child fed through stdin. Network/payload errors are swallowed. This gives downloaded code the developer process's filesystem, environment, credentials and network access. The downloaded payload is not available for inspection, so credential theft or persistence cannot be confirmed or ruled out. This repository change does not establish that the machine is clean.

Dependency check: package dev/build/start were the only source references to `node init`; PostCSS legitimately needs only `@tailwindcss/postcss`. Its `createRequire` shim existed for the appended loader. Neither loader provides application exports or a required initialization contract. Removed `node init` from package scripts, replaced `init` with an inert comment, and restored the same Tailwind plugin configuration. No CSS, UI or database changes were needed. No dependency install or application build was run.

If these scripts previously ran, treat credentials accessible to that process as potentially exposed: rotate through the owning systems and inspect host/process/network history. Preserve evidence before cleanup. The inert copies remain evidence and must never be used as rollback configuration.

## Existing test diagnosis

Commit `34f7744e85041583d55fbea88b4132bfb3d15505` deliberately deleted `app/agent/page.tsx`, `app/api/agent/calls/route.ts`, and `app/api/agent/calls/[id]/recording/route.ts`. `proxy.ts` redirects the retired agent portal to BPO login. Five tests referenced these deleted surfaces. Four whole retired-surface tests are now explicitly skipped; the mixed call-detail/recording test was split so existing call-detail ownership assertions still execute and only the missing recording-route test is skipped. No application files were fabricated, restored or redirected to unrelated APIs. Legacy calling tests remain historical coverage and do not establish VICIdial compatibility.
