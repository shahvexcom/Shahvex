# Jennifer client demo — existing Ollama baseline only

Readiness checked 2026-11-03: authenticated Gateway ready=true; Ollama/STT/TTS ready=true; activeSessions=0; queue active/pending=0. Eight deployed VoiceStreaming runtime hashes match the verified baseline. Listeners are existing loopback3000/8765/8787/8788/11434; no8789 review listener. GPU snapshot:4669MiB used/3288MiB free,1% utilization. No inference, restart, deployment, credential or maintenance change was made by preparation. Health confirms dependencies, not successful new microphone/audio delivery.

**GO for operator-led baseline recording; client-ready GO remains pending the actual recording review.** Do not launch Groq, TCP tools, model experiments or Agent Intelligence. Do not change the assigned script or voice. There is no new client recording or new latency measurement yet.

## One continuous browser session

1. On the physical PC use wired headphones and the existing signed-in `http://127.0.0.1:3000/controller?tab=agents`. Do not open Vercel. Ensure no other voice/test session is running. In DevTools Console run the existing protected check:

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1', {
  credentials:'same-origin', cache:'no-store'
}).then(async r=>({status:r.status,...await r.json()}))
```

Require status200, authenticated/ready=true, maintenance=true and sessions/queue/active/starting relays all zero. The health check itself performs no inference. If any check fails, stop; do not restart anything or substitute another pipeline.

2. The confirmed existing maintenance lock must be released to admit the demo session. This is the only necessary state change, performed by the signed-in operator using the existing workflow; no services restart. Record the previous ON state so it can be restored afterward:

```javascript
await fetch('/api/admin/local-voice?maintenance=0', {
  method:'POST',credentials:'same-origin'
}).then(async r=>({status:r.status,...await r.json()}))
```

Require status200/maintenance=false. Stop on refusal; do not bypass an armed deployment lock. This command was provided for the operator, not executed by Codex.

3. Open Jennifer's existing Voice test modal. Select **Reset to Assigned Script** if needed; verify **Assigned Script** is displayed. Read it to choose the service/topic below without editing the textarea or inventing campaign facts. Obtain permission from every participant, select the consent checkbox, click **Start Conversation**, allow microphone access, then click **Start Recording before anyone speaks**. The UI only enables recording after the conversation starts.

4. Record the following seven customer turns in one continuous session. Speak naturally; replace bracketed topics using only the displayed assigned script or Jennifer's actual preceding answer. Never read the brackets aloud. Do not invent a transcript for Jennifer.

| Turn | Customer action / wording |
|---|---|
| 1 — introduction | “Hello. What can you help me with today?” |
| 2 — service question | “Can you explain [a service actually in the assigned script]?” |
| 3 — relevant follow-up | “You mentioned [her actual preceding point]. How does that work?” |
| 4 — clarification | “Could you explain that last step in simpler terms?” |
| 5 — concern | “I'm concerned about [a relevant issue]. What should I know before deciding?” |
| 6 — natural pause | After she finishes, think silently for2–3seconds, then ask “What would the next step be if I want to continue?” Keep the silence in the recording. |
| 7 — interruption | While she is audibly answering a relevant follow-up, say “Sorry, before we continue—[one short relevant clarification].” Confirm the old response stops and she answers the new question. |

Wait for each answer before the next turn except the deliberate interruption. If the assigned flow requires a disclosure or consent exchange, follow it; do not force the conversation past a stop/refusal. Do not re-record to conceal an error. Stop immediately on WAV corruption, engine/authentication failure, stale overlapping speech, repeated empty transcriptions or resource pressure. Preserve the failed recording as evidence and report the exact error; do not improvise a patch during the demo.

5. After the final answer, leave2seconds of silence. Click **Stop Recording**, wait for finalization, then **Download Recording**. Keep the original continuous file unedited. Then click **Stop Conversation**. Keep the modal/page open until the recording and diagnostics are saved; closing the modal discards its in-memory recording. Verify the downloaded file plays and contains both voices, the pauses and the deliberate interruption. Do not claim the demo succeeded if one side is missing.

6. Export the existing browser timing events without credentials or conversation text. In the same page's Console run:

```javascript
(() => {
  const events=window.__SHAHVEX_VOICE_TIMINGS__;
  if(!Array.isArray(events)||!events.length)throw Error('No voice timings available');
  const data=events.map(event=>JSON.stringify({
    message:'[Shahvex voice timing] '+JSON.stringify(event)
  })).join('\n');
  const url=URL.createObjectURL(new Blob([data],{type:'application/x-ndjson'}));
  const link=document.createElement('a');
  link.href=url;link.download='Shahvex-demo-timings-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jsonl';
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
})()
```

Do this before refreshing or starting another conversation, which resets the event array.

7. Confirm sessions/queue/relays drain with the health command from step1 (maintenance will currently be false). Restore the prior maintenance ON state only after Stop Conversation:

```javascript
await fetch('/api/admin/local-voice?maintenance=1', {
  method:'POST',credentials:'same-origin'
}).then(async r=>({status:r.status,...await r.json()}))
```

Then repeat health and require ready/authenticated/maintenance=true and all activity counts zero. Do not stop any AI service. These maintenance operations are operator steps, not changes performed by preparation.

## Offline results extraction after recording

Physical-PC PowerShell, no inference:

```powershell
Set-Location -LiteralPath 'P:\shahvex'
$demoTiming=Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter 'Shahvex-demo-timings-*.jsonl' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(!$demoTiming){throw 'Downloaded timing file not found'}
node gateway/inspect-performance.cjs $demoTiming.FullName
```

This existing inspector reports endpoint/stage timing and output-device estimates. They are not calibrated speaker-onset measurements. Align the downloaded two-sided recording to recording-start/speech-end events and mark the user speech-end and first played Jennifer audio for each answered turn, listening to establish speaker identity. Preserve customer thinking silence separately from response wait. Report the actual recorded onset gap, phrase gaps and interruption behavior; physical speaker/device latency remains uncalibrated. Never replace missing measurements with scheduled playback times or invented transcripts. The latest discovered Gateway JSONL was empty at preparation; the browser export is the immediately available source for this demo.

| Turn | User speech end | First recorded Jennifer onset | Response delay | STT | LLM phrase | First TTS PCM | Largest audible phrase gap | Complete/interrupted/error |
|---|---|---|---|---|---|---|---|---|
| 1–7 | pending actual recording | pending | pending | pending | pending | pending | pending | pending |

## Truthful client handoff

Share the original downloaded recording and a short results sheet: answered-turn count, median/worst recorded response delay, largest phrase gap, interruption result, exact functional/integrity failures and assigned-script/voice listening check. Keep customer thinking pauses and interrupted turns separate from completed-response latency statistics. Historical median5.62s is context only; this is not a matched provider A/B. Do not edit out outliers or claim the <=3s optimization target has been achieved unless measured.

Client-demo GO: both voices audible, approved script/voice intact, conversation continues through follow-ups, interruption cancels stale output, Stop cleans up, and no critical integrity/functional failure. Visible latency can be disclosed honestly; exceeding an aspirational speed target is not by itself a reason to conceal a functioning baseline. NO-GO: missing/corrupted audio, critical script violation, frozen multi-turn flow, stale response after interruption or failed cleanup. Preserve evidence and fix only that confirmed blocker before another demonstration.
