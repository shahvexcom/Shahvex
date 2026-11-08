# Jennifer Concise A/B v1 — prepared, native execution blocked

User accepted the existing five generic baseline/concise pairs for benchmark preparation. This is not approval to deploy them as Jennifer's campaign script, and no native requests are authorized yet. No production file, voice setting, credential, script, database, service or maintenance state was changed. Transport research remains paused; integrity validation is unchanged.

## Prepared output

`P:\shahvex\dist\Jennifer-Concise-AB-v1`

- `plan.json`: exact ten texts, phrase boundaries/hashes, fixed randomized 30-trial ordering, parser hash.
- `texts/`: five baseline and five proposed text files, unchanged from the concise evaluation.
- `private-key/blind-key.json`: planned opaque trial IDs/answer key; no audio exists yet. Keep this and the plan/texts away from blind listeners.
- `audio-labeled/`, `audio-blind/`, `phrase-wavs/`, `metrics/`: empty, reserved for approved results.

Five scenarios include neutral, warm, reassuring, serious and the mandatory-first control. Three repeats per variant give **30 replies / 66 sequential phrase requests**. The native request count is larger than the reply count because the existing phrase rules remain active. Baseline and concise variants preserve the exact required fixture spans, ordering and first-position disclosure in the control. They do not establish actual campaign permission or business compliance.

Source: `gateway/style-review/prepare-concise-ab.cjs`. CLI is preparation-only and refuses existing directories. A dependency-injected runner supports mock evaluation, requiring approval, a health reader, exclusion of competing tests, a bounded TTS adapter and a result sink. No default network adapter or live command exists. `runInjected` compares the plan/text/parser to the current reviewed corpus before any trial. A changed corpus, parser, ordering or private plan requires review. This is not a new authentication system.

## Mandatory independent preflight — pending

Before native work, independently read the existing signed-in protected endpoint:

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1', {
  credentials:'same-origin', cache:'no-store'
}).then(async r => ({...await r.json(), status:r.status}))
```

Require status=200, authenticated=true, ready=true, maintenance=true, activeSessions=0, queue.active=0, queue.pending=0, activeRelays=0 and startingRelays=0. An approved execution mechanism must perform that actual authenticated read and inspect the response; do not construct maintenance/relay booleans, reuse an old proof JSON, mint a session, extract a browser cookie, or treat HTTP 200 alone as availability. No authenticated browser execution is currently connected to this benchmark. Therefore independent preflight is **not verified**, and no live run command is provided.

Also confirm the operator has stopped other browser/direct AI tests and use available existing service activity evidence. Gateway counters alone cannot exclude direct Chatterbox callers or prove GPU exclusivity. Unknown competing activity blocks execution. Refresh the protected health/readiness check and competing-test exclusion before each phrase; stop on any change. Do not alter maintenance automatically. Only after this preflight should the user explicitly approve **30 replies / up to 66 native phrase jobs** and the exact current plan hash.

## Native adapter and saving contract after approval

Connect only the existing loopback Chatterbox endpoint, exact prepared Jennifer reference/model/default generation settings, JSON `{text}`. Do not upload a reference or supply sampling/emotion/speed overrides. Use the existing bounded request behavior, no concurrent synthesis, no automatic retries. Native timeout/disconnect can leave work outstanding: stop and verify drain before any later separately approved run. No restart/model reload is a recovery action for this benchmark.

Each native response must retain declared/received lengths, HTTP status, bounded header/body timing and raw native WAV bytes. Reject transport errors, wrong RIFF/data lengths, invalid PCM, empty data or unexpected rate changes. Save only complete validated WAVs. The injected result sink is still a required adapter, not wired live code: it must save labeled trial files such as `warm-proposed-r2.wav`, blind copies using the existing private key IDs, original phrase WAVs and metadata. Never overwrite prior trials. Any failure is retained separately with completed/failed/unrun denominators; do not restart a stopped run or hide it through success-only summaries.

## Measurements and decision

- **First valid PCM**: first phrase request start → completed WAV validation/decode. The offline renderer now timestamps after validation, not before decode. First received bytes do not count as usable PCM.
- **Synthesis + transfer duration**: sum of native request durations; actual native GPU inference remains unknown unless existing matching server metadata supplies it. Wall completion separately includes later preflight/orchestration time.
- **Phrase continuity**: native audio duration and projected ordered-playback gaps from validated phrase availability. These are not actual browser/audible gaps. Concatenated full-reply files deliberately do not invent buffering delays; retain phrase files/timestamps for separate continuity analysis.
- **HTTP integrity**: complete length/RIFF/PCM validation and error counts; stop on the first failure. Never pad audio, weaken validation or automatically retry.
- **Listening**: blind listeners rate naturalness, clarity, relevance, rhythm, Jennifer identity/accent and whether concision feels abrupt. This cannot be auto-certified.

Keep voice/settings, active 40-character clause threshold and sentence rules fixed. No STT, VAD, Ollama call, Gateway session or production controller activation is needed for this authored-text TTS experiment. It cannot directly measure speech-end→audible latency or establish a change from 5.62 s.

Proposed gates: zero immutable-content/flow violations; no voice-quality regression; at least 20% paired first-valid-PCM improvement on eligible optional-opening cases; no projected gap worse by >250 ms, with complete-reply durations reported. Mandatory-first control is not expected to improve first audio. Do not reduce responses solely to satisfy timing. Three repeats per variant are exploratory; report paired distributions, all failures and uncertainty, not a reliable population p95 claim. A later separately approved browser test is required for physical audible onset.

## Offline checks and rollback

```powershell
Set-Location P:\shahvex
node --test tests/concise-ab-preparation.test.cjs tests/dialogue-concise-evaluation.test.cjs tests/dialogue-listening-harness.test.cjs
```

Checks cover 30 unique randomized slots, three repeats per exact text, 66 planned jobs, immutable spans, no synthesis on missing approval/unsafe health/unknown other tests, sequential mock audio, strict stop without retry/save on corruption, native-rate preservation, blind-save behavior and no overwrite. All audio used in tests is synthetic in memory or temporary test files, not Jennifer samples.

Rollback is simply baseline evaluation/default-disabled style policy. No production rollback is needed. Preserve current VoiceStreaming files/backups, every earlier transport result and the interrupted generic listening run. Do not deploy the Dialogue Style Controller or any optimization until the measured results and listening comparison are reviewed.
