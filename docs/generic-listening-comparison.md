# Approved generic Jennifer listening comparison — prepared, not synthesized

The user's approval covers the ten generic authored texts shown in chat, not Jennifer's campaign script or deployment. This package supersedes the earlier appointment-fixture proposal **for this listening demonstration only**. It contains no appointment facts. Production files, Gateway, database, native voice/reference, Turbo generation settings, credentials and maintenance state have not been changed.

## Prepared files

`dist/Jennifer-Generic-Listening-v1/` contains `plan.json` and ten exact text files under `texts/`. `audio-labeled/`, `audio-blind/`, `phrase-wavs/`, `metrics/` and `private-key/` are reserved for later output and currently empty. No placeholder or fabricated WAVs are created.

Source corpus: `gateway/style-review/approved-listening.cjs`. Harness: `gateway/style-review/listening-harness.cjs`. Its CLI is **preparation-only**, with no network client, automatic service requests or live execution flag. `renderSample` is dependency-injected and only tested with synthetic WAVs in memory. No live adapters are installed. `saveSample` can later save native-rate labeled and blind WAV copies plus metrics and a separate blind key; it never overwrites an existing labeled WAV.

To prepare a different new output directory without any service access:

```powershell
Set-Location P:\shahvex
node gateway/style-review/listening-harness.cjs dist/Jennifer-Generic-Listening-v2
```

Expected: `textSamples:10`, `liveRequests:0`, `audioFiles:0`. Existing output directories are refused, preserving completed work.

## Exact approved samples

| Scenario | Baseline | Style-aware |
|---|---|---|
| Neutral | I am Jennifer, an automated assistant. What would you like to know? | I am Jennifer, an automated assistant. What would you like to know? |
| Friendly | I am Jennifer, an automated assistant. How can I help? | Hello, I am Jennifer, an automated assistant. How can I help? |
| Hesitant | I am Jennifer, an automated assistant. Which part would you like me to explain? | I am Jennifer, an automated assistant. We can take this step by step. Which part would you like me to explain? |
| Concerned | I am Jennifer, an automated assistant. What is your main concern? | I am Jennifer, an automated assistant. Thank you for telling me. What is your main concern? |
| Serious | I am Jennifer, an automated assistant. What would you like clarified before we continue? | I am Jennifer, an automated assistant. Please tell me what you would like clarified before we continue. |

The automated-assistant disclosure is retained verbatim. There are no campaign facts, campaign compliance claims or Lissa conditioning. These are not newly generated Ollama outputs. They test wording through the current voice, not a distinct controllable TTS emotion mode.

## Gate before any live synthesis

Separate approval for Chatterbox use is **still pending**. Do not run native synthesis now. Do not change maintenance automatically. To verify state when a quiet window is requested, run this read-only command in DevTools on the existing signed-in `http://127.0.0.1:3000` controller:

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1', {
  credentials: 'same-origin', cache: 'no-store'
}).then(async r => ({ ...await r.json(), status: r.status }))
```

Require HTTP 200, `authenticated=true`, `ready=true`, `maintenance=true`, `activeSessions=0`, `queue.active=0`, `queue.pending=0`, `activeRelays=0`, `startingRelays=0`. Failure means no synthesis; no automatic recovery or maintenance change. Confirm there are no direct native tests either, since Gateway counters do not cover independent Chatterbox clients. No cookie/token should be pasted or extracted. An authenticated health read is not voice synthesis.

After that verification, request the user's explicit separate approval for the ten replies and their planned phrase requests. Refresh authenticated state immediately before execution and each phrase; do not rely on a saved JSON file or old snapshot. The dependency-injected guard must perform that protected read using an approved existing authenticated mechanism. This preparation has no browser session access and has **not verified current live state**. Connecting that guard and native transport requires the next approved step; no new route or authentication design is proposed.

## Controlled run after separate approval

Use only the existing resident Jennifer voice/reference/model/settings. Verify those existing settings read-only; do not upload a reference, use Lissa, or send generation overrides. Requests contain only `{text}` to the existing loopback Chatterbox endpoint. Native inference must stay sequential with no competing direct clients. Use existing bounded timeouts, no automatic retries. A timeout or truncation stops the comparison; do not begin another request until outstanding native work is known to have drained. Do not silently increase timeouts or switch HTTP clients as a transport fix.

The plan fixes ten samples (one per variant per scenario), randomized once. It uses the unchanged current `PhraseStream` with its 40-character clause threshold; sentence rules are also unchanged. Complete texts are supplied offline, so this does not reproduce Ollama token arrival timing. Preserve every word and phrase order. No STT, Ollama call, Gateway session, dynamic prompt replacement or production style-controller deployment is necessary.

Each native adapter response must include original WAV bytes, HTTP status, declared length (or explicit null if absent), header wait, first body-byte time and body-complete time. Measure total request time separately. Validate Content-Length, RIFF/body completeness, mono PCM16 and stable native sample rate before saving or treating audio as playable. The injected renderer preserves native PCM without resampling, pitch shifting, normalization or inserted silence. It stops on the first failure and does not retry. Additional first-byte/header timings are null when unavailable, not invented.

Save original phrase WAVs separately, then assemble validated PCM into a valid native-rate reply WAV. Labeled examples: `audio-labeled/friendly-baseline.wav` and `audio-labeled/friendly-style-aware.wav`. Use opaque random IDs in `audio-blind/`; keep `private-key/blind-key.jsonl` away from listeners. The key is a blinding aid, not an access-control mechanism. Do not distribute texts or variant labels with blind audio. Metadata must exclude credentials and reference audio.

`firstPlayableMs` measures request-start to a fully validated first phrase, not actual audible onset or native GPU inference. `totalWallMs` includes subsequent guard checks and orchestration; phrase request times isolate that overhead. `projectedBetweenPhraseGapMs` estimates immediate ordered playback from completed phrase availability and duration; it is **not** measured browser playback. Complete reply WAVs concatenate speech without simulated gaps, so listening to those alone cannot validate real-time continuity. Record actual browser playback separately later if approved. Report actual audible latency, audible gaps and GPU inference as unavailable until measured.

For blind listening, rate naturalness, warmth/appropriateness, rhythm, clarity, repetition and Jennifer's voice consistency. Use the identical neutral pair to expose normal synthesis variability; do not assume deterministic synthesis or change seeds. Compare paired timings, total completion, body integrity and errors. Ten single-repeat samples are exploratory: do not claim statistically reliable p95 improvement. If quality gains are unclear or added language increases latency unacceptably, retain baseline. No conclusion about naturalness, voice consistency or extra latency can be reached before audio exists.

## Verification

```powershell
node --test tests/dialogue-listening-harness.test.cjs tests/gateway-dialogue-style.test.cjs
```

Tests use in-memory synthetic WAV fixtures only. They cover approved text identity, word order, default denial, idle/maintenance guards, sequential requests, native-rate preservation, transport failure stopping and existing style integration behavior. Production voice quality has not been tested here.
