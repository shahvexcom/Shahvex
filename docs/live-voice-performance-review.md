# Live voice diagnosis and instrumentation — physical measurements pending

## Evidence and limits

User reports 5–8s responses, occasional irrelevant answers, `Engine error: stt`, stop 404, and an SSE GET lasting 63s. No correlated physical stage samples or original STT HTTP status were supplied. Therefore the exact dominant latency stage, failing STT status and cause of a particular inaccurate answer are **not established**. Do not substitute mock durations for hardware measurements.

The GET is intentionally a long-lived server-sent event connection. A 63s request duration is not by itself 63s inference. The backend client separately has a 120s absolute deadline, 30s idle timeout and relay 180s expiry; a disconnect may be caused by one of those deadlines and needs its timestamp/log.

Verified source findings:

- The authorized controller export queries the latest assignment for the approved non-BPO agent and forwards the complete `script_text`, max 16000 characters. No generic test script replaces that path. New SHA256 script-version metadata confirms which bytes reached the gateway without logging the script.
- The export does **not** select a lead or transmit lead-sheet rows. Lead-specific responses consequently lack reference facts. Do not select an arbitrary customer's row or send an entire lead sheet into a model/browser. A future explicit authorized lead-selection control/API is needed before structured lead context can safely be included. The prompt now explicitly asks for clarification rather than inventing facts and preserves the full original assigned script/disclosures unchanged.
- Ollama's streaming NDJSON was parsed but its entire reply is awaited before TTS. Chatterbox accepts full text and returns WAV; the full bounded WAV is awaited before PCM playback. These are serial buffering boundaries, not proof of their measured cost. Model/voice options and speaking rate are unchanged. Incremental clause synthesis remains deferred until measurements and native cancellation behavior justify the added TTS requests.
- Core maintains per-session role-correct history capped at 20 messages. Cancelled generations do not commit history. VAD is per-segment, not per-frame reset; pauses of 200ms split speech and can cancel older work.
- Whisper's independent wrapper has one native worker and returns 429 while busy. HTTP abort does not preempt native transcription. New requests can meet that worker after old cancelled work: this is a source-supported failure path, **not a confirmed diagnosis of the reported STT event**. New structured codes preserve HTTP status and distinguish busy/timeouts/failures. Only explicit 429 admission rejections retry, bounded to six attempts with 200ms cancellable spacing; accepted, timed-out or uncertain submissions never retry automatically.
- Stop can race with SSE/disconnect cleanup that already deleted the relay, producing 404. Stop is now idempotent for absent opaque handles, after unchanged gate/admin checks. Cross-owner live handles remain inaccessible.

## Timing and trace

Gateway logs/events include sessionId, turnId and generation. Timing stages: speech detection/end (gateway log), STT start/complete, LLM start/first token/complete, TTS start/first valid PCM. Each turn event has monotonic elapsed milliseconds; script-version logs include a content hash/length, never its text. Error metadata includes engineStage, errorName and HTTP status when available, no response bodies/secrets.

Browser development console `[Shahvex voice timing]` logs relayId, gateway turnId, microphone first frame, speech-end arrival, engine timings and first playback **scheduled** time. Scheduling is not proof that a speaker physically emitted sound. `sinceSpeechEndMs` measures browser receipt-to-scheduling; gateway stage elapsed times are relative to turn reservation and include queue wait. Do not subtract absolute clocks across machines. Actual acoustic onset/barge-in must be measured with a recording or loopback device during operator verification. No transcript, scripts, caller audio or sensitive lead fields are logged.

Sanitized transcription/reply text traces and automatic “script followed” verdicts are intentionally not enabled: free-form caller/model text can contain private data, and a hash does not establish semantic compliance. Review a consented synthetic test conversation manually against the assigned script. This is an outstanding accuracy-validation task, not a claimed automated compliance check.

## Reviewable physical deployment

Physical files are not changed automatically. Review repository changes in `gateway/core.cjs`, `gateway/audio-stream.cjs`, `gateway/services.cjs` alongside your deployed cancellation patch. Keep existing `server.cjs`, Whisper wrapper, private contract, tokens and all voice/model files unchanged.

When approved, stop only Node Gateway with Ctrl+C in its original terminal. In a separate physical PowerShell:

```powershell
$target='C:\Shahvex-AI\integration-gateway'
$source='P:\shahvex\gateway'
$backup=Join-Path $target ('backup-timing-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$files=@('core.cjs','audio-stream.cjs','services.cjs')
foreach($name in $files){node --check (Join-Path $source $name);if($LASTEXITCODE -ne 0){throw "Syntax failed: $name"}}
New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
foreach($name in $files){Copy-Item -LiteralPath (Join-Path $target $name) -Destination $backup -ErrorAction Stop}
foreach($name in $files){Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name) -Force -ErrorAction Stop}
foreach($name in $files){if((Get-FileHash (Join-Path $source $name)).Hash -ne (Get-FileHash (Join-Path $target $name)).Hash){throw 'Copy checksum mismatch'}}
```

Restart Gateway in its original terminal with existing environment: `node C:\Shahvex-AI\integration-gateway\server.cjs`. Restart **only Next.js** with existing local flag/URL/token if required for relay code updates. No model process restart is required. To rollback: stop only Gateway, copy exactly `$files` from `$backup` to `$target`, restart with the same environment. Preserve both consoles and record the backup path.

## Real browser test and measurement table

Use headphones, an approved Jennifer session and synthetic non-sensitive speech. In DevTools preserve console/network logs. Require authenticated availability enabled/configured true. Test 5 warm turns plus one first/cold turn separately, short relevant questions, a clarification question without lead data, and interruption mid-reply. Confirm Stop twice is successful, tracks released and eventual activeSessions/queue active/pending=0. Repeat existing isolation/cancellation CLI tests. Capture correlated stages and acoustic evidence:

| Measurement | Physical result |
|---|---|
| VAD speech-end delay | Pending (configured 200ms silence, not measured) |
| Queue wait / STT | Pending |
| LLM first token / complete | Pending |
| TTS first valid PCM | Pending |
| First scheduled playback / actual audible response | Pending |
| Actual barge-in stop latency | Pending |

Sub-2s response, <3s typical and <250ms interruption are targets only. The added concise-reply guidance does not override mandatory script wording. No claim of production readiness, throughput, semantic accuracy or measured speed improvement is made. Vercel/Railway remain disabled and no telephony is activated.
