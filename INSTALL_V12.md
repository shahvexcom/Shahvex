# V12 — actual callback compatibility and explicit live voice source

Apply over V11. Preserve all ZIP paths. These are complete replacement files: nine runtime/verification files and five test files. No private configuration is included.

## Concrete evidence

The signed website probe returned “400 Call ID required” without turnFinal, and “400 Invalid event” with turnFinal. That is direct evidence that the running callback rejects the extra field before the missing-call guard. The shown source .ts schema contains that field, so source-marker checks alone do not describe the executed callback. We have not proved which shadow file, alias resolution or build artifact produced the older schema.

## Repairs

1. The native bridge no longer sends turnFinal in its final listen event. Since V9 removed semantic classification, this flag is unnecessary. This avoids the exact strict-schema rejection shown in the screenshot. Current callbacks still accept either format for other clients.
2. The public route explicitly imports ../../../../lib/vicidial-callback.ts. The callback, speculative session wrapper and session handler pin their core voice imports to relative .ts files as well, so extensionless .js or alias resolution cannot silently select those older core modules. Targeted ts-ignore comments permit these explicit source imports without replacing tsconfig. The standalone tester loader recognizes the same explicit suffixes.
3. Callback JSON responses carry x-shahvex-callback-revision. Native bridge health also records the actual voice response revision header, even when no timing event appears. These are runtime checks rather than only disk markers.

The V11 intro, wellbeing-purpose response and question order are retained. No new transfer command, credential, routing environment, dialplan or database change is included. Native command execution remains unchanged. This patch addresses the observed callback rejection and pins current flow source; live outcome must still be verified after installation.

## Install

Finish active calls. Copy all included files into the existing V11 project, preserving paths. In particular, replace app/api/telephony/vicidial/route.ts as well as the included lib files. Then:

```bash
cd /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex
npm run build
```

After a successful build, restart the website and campaign bridge through your existing launcher. The bridge source changed, so it needs a restart too. If you also use the standalone tester, restart that existing service as well. Do not replace the launcher or private config. A completed build does not reload running workers.

## Verify the actual callback before calling

Run the updated included check:

```bash
python3 shahvex-runtime-check.py
```

Both deliberate missing-call probes should now show “400 Call ID required”, and each should print:

Website callback revision: REC413-source-v12
Current callback schema expected: True

Here 400 is the EXPECTED response to the diagnostic's deliberately absent call ID, not a failed real-call speech probe. If the callback revision is missing/older, the new route is not loaded; do not treat a file/build marker as proof. Restart the existing website launcher after its successful build and inspect the resolved production build directory printed by this check. The local tester's 401 is unrelated when the website has no external PC adapter URL; do not change its key on that basis.

Then make a fresh call and run:

```bash
python3 deployment/vicidial-bridge/verify-live-flow.py
```

Expected actual call worker: REC413-source-v12. Check the FRESH active stream or newest recent report, not old historical reports. The original turnFinal schema rejection should no longer create HTTP-400 fallbacks. Other recognition/network failures remain possible and must not be confused with this specific schema issue.

## Focused call

Hello -> intro -> “Uh, I'm good, and you?” -> courtesy/address plus configured calling purpose -> acknowledgment -> first business question -> coverage question -> age question -> existing transfer flow.

The fixed-source session still uses the actual configured script/goal and V11 wording. This patch does not add a new pitch, new wellbeing wording or a new pause model.

## Validation

71 focused tests passed plus three selected native handoff tests. A regression fixture reproduces the exact signed-schema behavior with an older strict schema, confirms current callback compatibility, checks the explicit public-route import and exercises real local TCP bridge speech against a strict legacy callback. The bridge delivers the recognized text without an audio fallback in that case and reports the actual worker header revision without a timing event. The shared tester tests execute the explicit TS voice chain and retain the intro, filler wellbeing, calling-purpose, ordered questions and transfer acceptance checks.

Four changed TypeScript files pass syntax transpilation, changed CJS checks pass in the tests, and verifier/check Python files compile. Test STT/model/TTS/native responses are fixtures. No full Next production build, device restart or live VICIdial call was run here. Run the build and runtime checks on your device; no live success is claimed before that.
