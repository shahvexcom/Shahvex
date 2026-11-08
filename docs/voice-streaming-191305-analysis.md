# Jennifer recording analysis and minimal A/B proposal

No running service, model, credential, deployment configuration or production code was changed. No deployment package was created. Work is offline analysis and a synthetic boundary benchmark only.

## Matched evidence

- Recording: `C:\Users\UC\Downloads\Jenifer-2026-11-02T19-13-05-991Z.webm`; decoded191.64s, stereo48kHz.
- Browser relay `8d3c7264-e617-49d3-af01-841bb7dde381`, Gateway session `c7c7be62-8c32-4a23-80fc-c70c66b6cf09`.
- Gateway metadata shared-read copy: `dist/captured-gateway-0036506c6b87415a80c8156085d57f76.jsonl` (93909bytes). The live directory listing's zero-byte size was stale; shared read recovered466lines.
- Browser source `.next/dev/logs/next-development.log`; extracted `dist/voice-191305-browser-report.json`. Recording-stop was not logged, so duration comes from decoded media, not the last browser event (185.06s).
- Ollama HTTP metadata: `dist/voice-191305-ollama-http-metadata.log`, nine matching `/api/chat` rows. Ollama local times00:10-00:12 on3November correspond to Gateway UTC19:10-19:12 on2November, at UTC+05:00.
- Chatterbox file matches reviewed hash4364A61B6774EAFFACCE425E46C9B51FF2D1BE4892B9EDB481E4841F46F73189. Located `voice-streaming-20261102-235551.stdout.log` contains startup/health only, not matching synthesis request metadata. Other located native log files also did not supply matching request metrics. A file hash does not establish the code loaded by a process or recover its console output. Native inference, lock wait and HTTP transfer cannot be separately reconstructed from these files.

Within this recording17endpoint turns were observed: five completed, three produced audio before later cancellation, nine cancelled before audio. There were12cancellations and zero Gateway `turn-error` events. Do not label cancellations twelve engine failures. All recorded turns retain script hash `b095375b0e3d8e4f` (3923characters); no script text or transcript was extracted.

## Recorded response-onset measurements

Mono16kHz offline analysis uses20ms RMS windows, threshold500, minimum quiet500ms. Each row requires exactly one waveform quiet interval matching the microphone speech-end estimate within350ms and device-output estimate within250ms. Eight starts qualify; only five uncancelled completed turns enter the primary statistics. Attribution is event-supported, without invented transcripts or automatic diarization.

The recording mixes microphone and generated Web Audio directly. These are measured first audible **recorded-signal** onsets, separate from PCM receipt/scheduling; they are not calibrated acoustic onset at a listener's ears. Opus, mixing, quiet speech tails and RMS threshold affect boundaries. Physical speaker onset needs independent loopback/microphone calibration and separate tracks.

| Turn prefix | Outcome | Recorded speech end -> reply onset | Delay | Queue before STT | STT | LLM first token / phrase | First phrase chars | TTS+WAV+decode -> first PCM | Endpoint -> playback scheduling |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
|bc6d6331|Later cancelled|4.66 ->8.12|3.46s|.001s|.875s|.584 / .686s|26|1.328s|2.890s|
|56d5a153|Completed|12.80 ->16.66|3.86s|.001s|.912s|.041 / .166s|43|2.103s|3.184s|
|ee38fa81|Later cancelled|33.10 ->38.02|4.92s|.001s|.865s|.206 / .387s|69|2.941s|4.195s|
|817e2f83|Completed|49.48 ->55.10|5.62s|.884s|.938s|.038 / .241s|67|3.026s|5.092s|
|bed8253f|Completed|86.16 ->91.24|5.08s|.001s|.922s|.260 / .493s|70|3.122s|4.538s|
|6144de66|Completed|129.00 ->136.74|7.74s|.001s|.881s|.371 / .773s|87|5.478s|7.133s|
|4954cda0|Later cancelled|151.62 ->156.04|4.42s|.001s|.865s|.385 / .503s|46|2.452s|3.819s|
|9a9e67a8|Completed|171.16 ->178.76|7.60s|.001s|5.223s|.329 / .409s|28|1.395s|7.030s|

Endpoint silence is400ms in all these rows and is included in recorded speech-end latency. Queue, STT and phrase delays are separate; the .884s native drain before817e2f83 is not omitted. Chatterbox composite timing is NOT GPU-only synthesis time. Device-output estimates precede observed waveform starts by43-123ms; this difference is not isolated network transfer latency.

| Population | n | p50 | p95 | Worst |
|---|---:|---:|---:|---:|
|Completed uncancelled turns, primary|5|5.62s|7.712s|7.74s|
|All valid first starts, including three later cancelled|8|5.00s|7.691s|7.74s|

Percentiles use linear interpolation at `(n-1)*p`. Five turns do not establish a reliable population p95. Threshold sensitivity250/500/1000 preserves five completed matches: p50 5.62/5.62/5.64s; p95 7.656/7.712/7.764s; worst7.68/7.74/7.80s. Do not drop the slow valid STT turn to improve statistics.

## Pause classification

The four cited intervals align with new-turn response waits:

- ~33.22-38.02: first69-character phrase costs2.941s composite TTS; total recorded wait4.92s at threshold500. Quiet-start disagreement reflects threshold/tail detection.
- ~49.47-55.11: .884s draining prior cancelled native work +.938s STT +.241s phrase production +3.026s TTS composite, followed by playback; recorded5.62s.
- ~129.01-136.69: .881s STT +.773s phrase availability +5.478s TTS composite for87characters dominates; recorded7.74s.
- ~171.20-178.75:5.223s STT stage dominates, then.409s phrase +1.395s TTS; recorded7.60s. STT stage includes admission retries/HTTP/native processing. Retry counts and native inference duration were not recorded, so the5.223s cannot be assigned solely to compute or busy admission.

Other intervals have different meanings:

-0-2.68: initial silence before microphone speech; not engine response latency.
-18.80-20.56 and58.70-60.16: consistent with between-phrase starvation. The first audible phrase ends, and the following segment's first-PCM arrival matches sound resuming. They are not the next user's speech-end response waits.
-179.70-182.96: between-phrase gap after the final turn's short first audio. Its second47-character phrase takes4.214s to first PCM, longer than the preceding short phrase's audible duration. A30ms playback-buffer tweak cannot cover this3.26s gap.
-9.22-10.60: silence after the initial short reply fragment while the next segment remained pending, ending in new microphone speech. The turn later cancels; do not count it as a completed reply.
-Clusters around121-129,148-152 and167-171 contain interrupted STT/LLM turns before the next valid response. They are not one long successful inference. A500 Ollama HTTP row at local00:11:57 coincides with a Gateway-cancelled LLM turn; it is excluded from completed response statistics.

Other acoustic intervals cannot be reliably assigned to speaker intent without separated tracks/listening. No claim is made that all pauses are abnormal user silence or that every new onset is false barge-in.

## Bottleneck and safe tuning conclusions

Streaming is active. First meaningful phrase -> TTS start is0-1ms; buffering a full reply is no longer the issue. Most warm first tokens take38-385ms (first reply584ms). Matching Ollama HTTP durations roughly agree with Gateway generation totals; exact token throughput, load duration and prompt-evaluation duration were not retained. Keep-alive changes have no demonstrated benefit within this already-warm test and may increase8GB GPU residency pressure. Do not trim mandatory script/history or change token/sampling settings speculatively.

The largest regular cost is first-WAV availability, with a separate STT tail-latency problem. Small26/28-character phrases took1.328/1.395s, versus69/70characters2.941/3.122s and87characters5.478s. This is observational, confounded by text/prosody/load; it is not a causal regression or a hardware performance guarantee. Native synthesis vs transfer remains unknown without the matching console/request telemetry.

Playback already starts on the first valid segment and orders later PCM. Do not add a multi-second initial buffer to conceal gaps. The observed device-to-recording offset is small relative to synthesis waits. Keep400ms endpoint,160ms onset confirmation, native drain and stale-generation gates during A/B testing. Reducing endpoint silence would not fix either major outlier and could increase interrupted turns.

## Offline benchmark completed BEFORE any runtime edit

`node gateway/benchmark_phrase_policy.cjs` loads the reviewed parser in an isolated VM, changing only a synthetic first-clause threshold; no network/model is invoked and the source file is not changed. Three fixed utterances, one character per synthetic tick:

| First-clause minimum | Fixture1 first phrase | Fixture2 | Fixture3, no early clause |
|---|---:|---:|---:|
|A:40, current|69chars|61chars|68chars|
|B:32, first phrase only|38chars|61chars|68chars|
|C:24, first phrase only|38chars|28chars|68chars|

All nine cases preserve every word/order. Synthetic ticks are not milliseconds. No measured native or audible latency improvement is claimed. Shortening clauses cannot help output with no earlier meaningful boundary; more chunks can worsen full-reply continuity.

## Minimal reviewed proposal and A/B plan — approval required to run native load tests

1. Leave production unchanged. In an approved quiet/maintenance window with authenticated Gateway/relay drain and no direct-engine callers, benchmark the existing approved TTS endpoint from a separate bounded client. Reuse fixed full-text replies and cached token-boundary schedules, not different stochastic LLM replies for A/B. Keep the exact voice/reference/generation arguments and sequential native jobs. Randomize A/B order over five matched texts x three repeats per variant (30full-reply trials). Do not save personal transcripts or transmit recordings.
2. First compare A40 vs B32 **for the first clause only**, keeping later segmentation identical. Only test C24 if B is too weak and human listening confirms meaningful delivery. Preserve all words/disclosures; never insert filler or shorten the full answer. Measure first phrase character count, HTTP headers/complete WAV, native console synthesis, audio duration, all later segment gaps, cancellation/drain and integrity. Resident model/GPU memory snapshots and native busy events are required; do not reset/reload models to manufacture favorable results.
3. Collect existing native request JSONL/console timestamps rather than assume the startup log contains them. For a future explicitly approved diagnostics change only if needed, add no-text client request/headers/body-complete timestamps, STT admission retry count, final Ollama eval/load counts, and browser scheduled-gap metadata. If separate user/AI tracks or physical loopback are recorded, obtain consent and keep them local. These diagnostics are proposed, not deployed here.
4. Test GPU overlap separately using identical TTS text with/without simultaneous synthetic Ollama work, keeping the working engine settings untouched. Do not infer that overlap helps from the streaming architecture alone. Native compute timing requires native instrumentation/console availability; HTTP headers alone include lock wait and WAV conversion.
5. Keep an STT-specific investigation separate: replay the same prerecorded approved test PCM, including short speech/pause/noise, with no native overlap; measure admission vs inference and retain the slow valid samples. Do not disable barge-in or drain to hide5.223s.
6. Promote only after integrity/word-order/script/voice listening checks pass, no increased truncation/STT429/stale audio occurs, and no material between-phrase-gap regression. Pilot criterion: >=20% paired first-onset improvement with full-reply quality intact and no added gaps >250ms relative to A. Then seek explicit deployment approval and record at least five real microphone questions plus an interruption. Report small-sample p50/p95/worst and cancellations separately, with the same recording threshold and playback metric.

Current closest measured completed recorded onset is3.86s; best start including later cancellation is3.46s. Two seconds is not demonstrated. An optimistic budget using separate best observed stages is ~.4s endpoint +.865s STT +.166s phrase +1.328s first WAV +.08s output =2.84s; this is NOT a measured turn or a hardware lower bound. Typical2s would require a substantial measured STT/first-WAV reduction beyond phrase handoff and playback tuning. It is premature to declare the hardware fundamentally incapable or promise that phrase tuning alone achieves the target.

## Reproduce offline

```powershell
Set-Location P:\shahvex
& 'C:\Shahvex-AI\.venv\Scripts\python.exe' -B gateway/analyze_streaming_session.py 'C:\Users\UC\Downloads\Jenifer-2026-11-02T19-13-05-991Z.webm' dist/voice-191305-browser-report.json dist/captured-gateway-0036506c6b87415a80c8156085d57f76.jsonl --output dist/voice-191305-waveform-metrics.json
node gateway/benchmark_phrase_policy.cjs
& 'C:\Shahvex-AI\.venv\Scripts\python.exe' -B tests/streaming_recording_analysis_test.py
```

Two analysis regressions pass: explicit percentile calculation and exclusion of cancelled/ambiguous matches. Generated artifacts contain metadata/timing only. No production runtime files, deployment ZIPs, controller code, credentials or model settings were changed.
