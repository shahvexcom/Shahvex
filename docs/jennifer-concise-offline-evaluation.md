# Jennifer: concise style and first-audio feasibility

3 November 2026. Offline evaluation and read-only source review only. No native generation, model import, GPU benchmark, live service request, production edit, restart or deployment. The 44-byte investigation remains paused; its evidence is preserved. WAV integrity checks remain required.

## A. Concise conversational style

`gateway/style-review/concise-evaluation.cjs` exercises the existing intent selector/request helper and unchanged `PhraseStream` using **authored generic texts**, not Ollama outputs or approved campaign content. These are new candidates for text review, not replacements for the earlier approved ten listening samples.

For the four generic follow-up fixtures below, the prior automation disclosure remains in history and the synthetic required ending **“May I continue?”** is appended to both versions verbatim. No business facts are supplied or changed. Serious intent comes from trusted consent-step policy; reassurance comes from explicit concern/clarification language. No acoustic emotion inference is used.

| Style | Baseline optional sentence | Proposed optional sentence | First phrase characters A→B | Native jobs A→B |
|---|---|---|---:|---:|
| Neutral | I would be happy to explain the next step clearly. | I can explain the next step. | 50→28 | 2→2 |
| Warm | Hello, I would be happy to explain the next step for you. | Hello, I can explain the next step. | 57→35 | 2→2 |
| Reassuring | I understand that you have concerns, and I would be happy to explain this clearly. | I can explain this step by step. | 82→32 | 2→2 |
| Serious | It is important that you understand the details before deciding whether to continue. | Please review the details before deciding. | 84→42 | 2→2 |

Mandatory-first control: both start exactly **“I am Jennifer, an automated assistant.”** Its first phrase remains **38→38** characters even when later optional wording shrinks; job count remains 3→3. Required opening text cannot be shortened to obtain an apparent first-audio improvement.

Verification: required spans/ordering and mandatory-first position pass; original input script remains an unchanged prefix and history remains unchanged; intents match all four cases. **11/11 focused offline checks passed** (two new plus nine existing style tests). Machine-readable results: `dist/Jennifer-Concise-Offline-Evaluation.json`. No facts, consent or workflow have been checked against Jennifer's actual campaign because its approved script/permissions remain unverified. Prompt preservation and authored fixture checks are not a general guarantee of generated script accuracy.

These examples favor relevance over boilerplate and avoid claiming knowledge of feelings. Warmth remains restrained; reassurance explains a process without promising an outcome. Concision may sound abrupt or repetitive, and these generic endings are not a real campaign dialogue. Human judgment and later audio are essential. The current hint allows acknowledgements; it does not prove Ollama will generate these examples. Actual generated outputs require a separately approved evaluation of the same single request, not a second rewriting call.

**Textual style is not controlled acoustic prosody.** The current Turbo endpoint accepts text, not verified per-phrase warmth/speed/emotion parameters. We do not alter Jennifer's identity, accent, reference or generation settings, insert non-speech tags, copy Lissa conditioning, pitch-shift or time-stretch.

## B. First-audio workload and gap risk

The unchanged parser produces the measured character/job counts above: its clause minimum remains **40**, with its existing sentence-boundary rules unchanged. Proposed first-phrase character reductions are 44%, 39%, 61% and 50%, rounded. These are **text-workload proxies**, not measured speech-token reductions, GPU savings or latency percentages. Sentence wording/pronunciation, stochastic speech length, fixed overhead and native silence all matter.

No extra native jobs are introduced in these fixtures. However, shorter opening audio provides less playback cover while the next sequential WAV is synthesized. Therefore between-phrase gaps may worsen even with unchanged job count; there is no offline numeric gap estimate without matched synthesis/audio durations. Never pad the beginning or add fake filler. Current results record audio latency and gap measurements as null.

Retained event-aligned recording has five completed turns: recorded-signal speech-end→reply median **5.62 s**, first TTS/WAV/decode median **3.026 s**, STT median **0.922 s**, first meaningful LLM phrase median **0.409 s**. Phrase handoff is already **0–1 ms**. These stage medians are not additive; TTS composite is not GPU-only. Observed first-WAV costs for different 43/67/70/87-character phrases were 2.103/3.026/3.122/5.478 s, but wording/load confounds prohibit a causal milliseconds-per-character prediction. The 5.223-s STT outlier remains separate and unattributed. No VAD, threshold, STT drain or playback setting changes are recommended.

## C. Current Turbo inference feasibility

Read-only review covered the physical wrapper and installed `tts_turbo.py` / `models/t3/t3.py`; installed package metadata shows PyTorch **2.6.0+cu126**. Disk source does not attest a running process's loaded revision. No model/runtime was imported to inspect it.

Confirmed from source:

- Model load, reference preparation and a warmup utterance occur once at startup, not per request. Reference conditioning is reused. More per-request warmup would add work, not remove it.
- The wrapper already uses `torch.inference_mode()`. Turbo decoding already uses `past_key_values` / `use_cache=True`; a recommendation to simply “enable KV caching” would repeat existing behavior.
- Turbo converts generated audio to CPU NumPy, applies watermarking, and returns a CPU tensor. The wrapper subsequently calls `torch.cuda.synchronize()`, copies/converts to NumPy and encodes WAV. Native logged generation time can include CPU/watermark work; it is not automatically pure GPU kernel time.
- The wrapper's explicit synchronize might be redundant for completed audio after the CPU copy, but removing it is **not a proven latency fix**. It may mainly change timer boundaries; required CPU transfers still wait. Preserve watermarking, quality and synchronization correctness. [PyTorch synchronize semantics](https://docs.pytorch.org/docs/2.9/generated/torch.cuda.synchronize.html)
- Existing GPU snapshots do not measure the utilization of the slow historical requests. There is no demonstrated GPU saturation, memory thrash or reload in their retained telemetry. Do not infer compute utilization from allocated VRAM alone or increase concurrency on 8 GB.

CPU-only encoding microbenchmark AST-extracted the exact wrapper `wav_bytes` function and imported NumPy only—no torch/model/GPU. Thirty measured repetitions per length after ten warmups:

| Synthetic mono 24-kHz audio | Median encoding | Observed p95 | Worst |
|---|---:|---:|---:|
| 1 second | 0.039 ms | 0.123 ms | 0.292 ms |
| 3 seconds | 0.257 ms | 0.281 ms | 0.331 ms |
| 10 seconds | 0.779 ms | 1.105 ms | 1.264 ms |

This covers float clipping/PCM conversion/BytesIO WAV creation, not native generation, watermarking, GPU→CPU transfer, network delivery or concurrent-load behavior. It strongly deprioritizes ordinary WAV encoding as an explanation for seconds of wait on this machine. Reproduce with the existing TTS environment, without touching services:

```powershell
& 'C:\Shahvex-AI\chatterbox-testing\.venv\Scripts\python.exe' -B gateway/style-review/benchmark-wav-encoding.py
```

## Ranked candidates

| Priority | Candidate | Expected benefit / evidence | Risk and next verification |
|---|---|---|---|
| 1 | Concise, useful optional first sentence | Substantially less text in offline fixtures; targets largest measured composite stage | No proven audio saving; immutable-first openings may not benefit; test gaps/naturalness |
| 2 | Attribute existing native generation phases | Distinguish decoder, vocoder, CPU copy/watermark, synchronization and encoding | Diagnostics are not a speedup; profiling may perturb timing and needs separate approved isolated/native plan |
| 3 | Retain residency/warm-up and avoid competing native jobs | Already implemented baseline; avoid cold-start regressions | No demonstrated additional benefit from keep-alive/warmup changes; do not unload Ollama or change service configuration |
| 4 | Test redundant-wrapper synchronization only if measured material | Plausible source redundancy, no measured saving | Need isolated correctness/timing experiment; no removal now |
| 5 | Targeted `torch.compile`/CUDA-graph inference pilot | General PyTorch optimization mechanisms can reduce CPU launch overhead | Installed Windows/PyTorch/Turbo compatibility unverified; dynamic token loops, graph breaks, extra VRAM, compile warmup and numerical/audio differences. Not a drop-in supported Turbo endpoint option |
| Defer | Change precision, quantization, timestep counts, sampling, model, or remove watermark | Could alter speed, but violates current preservation scope or changes output | Not proposed |
| Deprioritize | WAV encoder micro-optimization | Measured sub-millisecond typical CPU cost | Cannot reasonably account for the 3.026-s composite |

General compile guidance is not a guarantee for this installed stack: [PyTorch compile options and memory/overhead tradeoffs](https://docs.pytorch.org/docs/stable/generated/torch.compile.html). No dependency upgrades, Triton installation, compile invocation or altered inference parameters were performed. No supported Turbo “fast emotion” or “stream PCM” flag was identified in the current wrapper.

## Minimal reversible proposal and next physical test

Keep the current helper, Gateway, scripts and approved ten-sample corpus unchanged. Review a **test-only prompt amendment** for the existing single Ollama call: “Use concise, relevant optional wording. Prefer one complete useful opening sentence; avoid routine acknowledgements. Never shorten, move or paraphrase mandatory wording.” It complements the four style hints and does not activate a production resolver. Do not implement output truncation, an extra classifier or a second rewriting pass. Any generated facts, exact spans and consent flow must be audited before audio. Default-deny real campaign activation until script permissions are verified.

**Next physical test, requiring separate text/audio approval:** the five synthetic pairs above (including mandatory-first control), baseline/proposed, three repeats each = **30 complete replies**, randomized and synthesized sequentially with the exact existing Jennifer settings. No live LLM call is necessary to test these authored texts. Use a fresh new output directory, fresh authenticated maintenance/idle verification and no competing native tests. Preserve native phrase rules and original WAVs; collect current server metadata if already available, header/body completion, first valid PCM, audio duration and ordered projected gaps. Obtain explicit approval before those requests. Stop on the first integrity/instability error, preserve failures/unrun slots, and do not automatically retry or resume transport research.

Proposed gates: zero required-span/fact/flow violations, no voice/accent/quality regression by blind listening, at least 20% paired first-valid-PCM reduction on eligible optional-opening cases, no worse projected gap by >250 ms, and no extra jobs. Treat 30 samples as screening, not proof of population p95. Report all failures separately; success-only timing never conceals reliability. Mandatory-first control is not expected to improve first audio. No acoustic naturalness claim until listeners compare actual audio.

Only after approval/results: consider a separately approved browser pilot measuring ten turns, interruptions, history and real recorded onset, distinguishing actual audible PCM from scheduling. Native text-to-PCM results alone cannot claim a change to the 5.62-s speech-end median. Aim for 2–3 s; no two-second capability or numerical native improvement has been demonstrated here.

Rollback: baseline prompt/request construction and default-null style resolver; retain artifacts and current VoiceStreaming backups. Nothing needs restoring now because only offline review code/tests/docs were added. Any later approved runtime pilot requires the existing verified backup/controller procedure; do not restore pre-VoiceStreaming code or alter credentials, models, voice, script or database.
