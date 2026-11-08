# Native synthetic first-clause A/B — 3 November 2026

**Recommendation: retain40. No optimization patch or deployment was prepared.** The planned30-trial experiment stopped at the first native WAV failure: seven attempted, six completed,23unrun. It is not a completed, balanced A/B experiment and establishes no repeatable improvement or new browser latency.

The user explicitly approved a quiet window after confirming maintenance=true/HTTP200 and no other voice/direct-AI tests. Existing Chatterbox was used without restart or changed settings. Gateway health was checked before each request. Native synthesis was strictly sequential; the benchmark invoked no Ollama generation or Whisper inference. All texts are synthetic, not historical replay and not a change to Jennifer's assigned script.

## Protocol and preserved state

Five fixed replies in `gateway/native-ab-fixtures.json`; each scheduled three times for A40 and B32 in randomized order, seed `8c2213d03585a2904d14b52fd1f647e8`. The deployed parser was loaded into an isolated VM; only the first-clause minimum changed for B. Later boundaries used40. Every request sequence was checked for identical full wording/order; no words were invented, dropped or truncated. This validates submitted text, not an ASR audit of the generated speech.

The same existing verified voice and `/synthesize` JSON `{text:...}` were used. No temperature/quality/reference/model parameters were supplied or altered. No VAD, native drain, Gateway, deployment controller, credential or backup files were written. Before/after SHA256 checks match for reference audio, native wrapper, Gateway services/VAD and private engine contract. Credentials were used from the existing DPAPI source in process memory only, never printed or saved to benchmark results.

Artifacts: `.env.native-ab/2026-11-02T21-17-15-591Z/` (UTC folder name; local date3November). It contains randomized `plan.json`, raw metadata `results.jsonl`, descriptive `summary.json`, six synthetic `trial-N.wav` clips and offline `rendered-waveform-metrics.json`. The `.env*` directory is ignored by Git. No tokens/private contract/transcripts from real calls are included. Synthetic fixture texts remain the same in both variants.

## Actual trials

All durations are seconds. These are native-client first **valid PCM** measurements after a complete WAV has arrived and been decoded/resampled, NOT speech-end-to-audible or browser measurements. Guard-check time is recorded separately and removed from logical native time. A projected eager30ms ordered playback queue is used to render continuity clips; it does not measure a physical speaker. Clips omit the initial inference wait so listeners can evaluate conversational rhythm.

|Order|Text|Variant|Repeat|First PCM|All synthesis complete|Speech duration|Projected starvation gap, worst|Result|
|---|---:|---|---:|---:|---:|---:|---:|---|
|1|2|B32|1|2.818|6.515|6.840|0|Valid|
|2|1|A40|1|2.867|2.868|3.560|0|Valid|
|3|1|A40|3|3.034|3.034|3.800|0|Valid|
|4|2|A40|2|3.136|4.920|6.320|0|Valid|
|5|4|B32|2|1.969|11.375|14.680|.307|Valid|
|6|5|B32|1|2.967|6.664|8.600|0|Valid|
|7|2|A40|1|Unavailable|Failed|Unavailable|Unavailable|Truncated WAV|

Attempted-run error counts: A1/4, B0/3, overall1/7. These tiny, different-text samples are not estimates of comparative reliability or production failure rates. Successful-only medians are A3.034s and B2.818s first PCM, but their text/length mixtures differ and must NOT be advertised as a7% speed improvement. All23remaining trials, including text3 entirely, were not run.

For the one text with successful samples in both variants (text2), A repeat2 used first74characters, B repeat1 used first38characters. First PCM was3.136 vs2.818s, while full synthesis was4.920 vs6.515s. Those different repeat/stochastic draws cannot establish a repeatable tradeoff; B produced6.84s speech vs A6.32s. Increasing the number of native jobs can offset an earlier first phrase.

First-trial GPU snapshot was1120MiB used; subsequent snapshots were roughly4450-4727MiB on the RTX4060 8188MiB. Ollama `/api/ps` snapshots showed no resident models throughout. No model was unloaded or kept alive by the benchmark. First-call warmup/cache and differing residency from the browser workload are additional confounders; no trial is silently removed or corrected for them.

## Rhythm and prosody

Projected queue starvation was0 for the three A successes and two B successes. B text4 had a306.7ms projected gap. Offline RMS analysis of rendered clips (threshold500,20ms windows, minimum500ms silence) found:

- B text2 `trial-1.wav`: a580ms quiet interval at4.00-4.58s. Same-text A `trial-4.wav` had no quiet interval >=500ms.
- B text4 `trial-5.wav`: a740ms quiet interval at2.18-2.92s, including native waveform silence plus the projected starvation gap. No A text4 trial completed, so it is not a paired gap regression.
- Other saved clips had no RMS quiet interval >=500ms. This does not certify natural prosody or voice identity by listening.

Some sentence-boundary pauses can be natural. No human listening approval or perceptual naturalness claim is made. The saved clips allow blind listening by trial number. The experiment neither proves B is unnatural nor clears the requirement of improved latency with unchanged conversational quality.

## Native HTTP failure

Trial7 failed on its first74-character native segment with HTTP200 and `UND_ERR_RES_CONTENT_LENGTH_MISMATCH`. Headers arrived at3150.3ms. The body iterator failed at22101.8ms after receiving195840bytes: about18951.4ms after headers. The advertised Content-Length was not retained by this harness, so the exact missing-byte count is unknown. No partial PCM was played or accepted and no trial7WAV was saved.

The installed wrapper generates and serializes WAV before sending200headers. This sample therefore demonstrates a post-generation HTTP/body integrity failure, not22seconds of synthesis. The client60-second request bound and300-second trial bound had not expired. Larger successful responses also occurred in this run, so do not claim a deterministic size threshold or blame clause size from one failure. Model/GPU/prosody settings were not changed. No automatic retry, service restart or transport patch was performed.

Post-run authenticated Gateway health returned ready=true, activeSessions=0, queue active/pending=0. Health does not test WAV transfer integrity or certify the fault is repaired. The benchmark did not disable the user-enabled maintenance state. Resolve/capture the transfer failure before scheduling another full native experiment; do not conceal it by accepting truncated audio or silently resuming23trials.

## Independent STT-outlier investigation

Historical turn `9a9e67a8` submitted660ms PCM (21120bytes). The400ms endpoint implies only about260ms of utterance before endpoint silence, but original input PCM was not retained. Do not reconstruct exact native input from the mixed recording.

- Prior cancelled STT drained at19:12:45.789Z.
- This turn's endpoint and STT-start were19:12:45.885Z, about96ms later; queue-to-STT-start was only.516ms.
- STT-complete was19:12:51.109Z; aggregate STT duration5223.2ms.

Thus Gateway queue delay and the endpoint setting do not account for the5.22s. The current client can retry429 admission up to25times with200ms waits; accepted native work is correctly drained. The native wrapper suppresses HTTP logs and returns no inference/admission timing. The native generator runs during `join(segment.text...)`, before returning JSON. Retained telemetry cannot distinguish one slow accepted transcription, admission retries, scheduling/contention, or decoder fallback. No final429 error does not prove zero transient429 responses.

Isolated NO-network/NO-inference controls using the unchanged adapter in `gateway/stt-outlier-control.cjs` measured:

|Synthetic control|Attempts|Artificial accepted work|Measured total|
|---|---:|---:|---:|
|One slow accepted request|1|5200ms|5232ms|
|22busy admissions, then normal work|23|800ms|5381ms|

These demonstrate ambiguity, not reproduction of the physical root cause. The locally installed WhisperModel defaults include beam5 and temperature fallback candidates; short/noisy audio could be expensive, but actual fallback counts/module origin were not logged and no causal claim is justified. No native STT inference test, drain/VAD/model change or speculative fix was performed during the TTS run. The next separately approved STT probe should record client attempt/status/accepted-response timing against an exact saved or explicitly synthetic PCM fixture; native inference separation requires native timing logs. Keep current drain/VAD untouched.

## Realistic latency verdict

Best successful synthetic native first PCM in this partial run:1.969s (B text4), excluding VAD, STT, LLM phrase production and actual browser/device output. Adding separate observed .400s endpoint +.865s STT +.166s phrase +~.080s output gives~3.48s as an illustrative optimistic budget, NOT a measured turn or hardware lower bound. Concurrent Ollama GPU work was absent and can change results.

Historical best completed recorded browser response remains3.86s; best recorded start including a later cancelled reply3.46s. Two-second speech-end-to-audible performance is not demonstrated. This experiment cannot establish an absolute RTX4060 limit or a repeatable first-clause speedup. **Retain40 and prepare no production patch.** A complete balanced rerun and listening approval are required after the transport problem is addressed under explicit approval.

## Verification scope

Two benchmark regressions pass: exactly30 deterministic-randomized trial slots with identical wording and first-only threshold changes; sequential synthesis/projected buffering with guard-overhead separation. Existing working production files, voice settings, deployment ZIPs and backups remain untouched. Additional native trial execution or transport/STT service changes require renewed explicit approval after this failure report.
