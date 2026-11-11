# Lissa voice clone

The user declared ownership of the supplied WhatsApp recording, authorized cloning
and call use, requested a female American-accent voice named Lissa, and explicitly
approved making it available to all agents.

## Reference preparation

Source: `WhatsApp Audio 2026-11-11 at 3.13.54 AM.mpeg`, approximately 599.49 seconds.
The source was decoded locally and automatically transcribed. No instructions from
the recorded conversation were adopted as agent instructions.

Prepared reference: `.data/voice-reference-whatsapp-20261111/lissa-reference.wav`.
It uses the first 23.43 seconds of source speech, trims edge silence, and reduces
the 7.75-second quiet interval from 3.46–11.21 seconds to 0.24 seconds. Result:
15.47 seconds of mono 16 kHz PCM. No pitch shifting or time stretching was applied.
Short conversational pauses remain. The transcript was verified against a second
local STT pass; it was not attested as human-reviewed.

## Provisioning

The existing Fun-CosyVoice3-0.5B engine now has voice ID `lissa`, display name
`Lissa`, gender `female`. Its source catalog and reference directory were updated
by `deployment/Provision-LissaVoice.py`; the prior catalog source is backed up
privately with the prepared assets. Existing model settings and voice entries were
preserved. The verified WSL service `shahvex-port-8767.service` was restarted while
the adapter reported zero active sessions and subsequently became ready.

The app registry contains `lissa`, ACTIVE, shared/global, English, American English,
with the user's rights declaration and machine transcript verification. Its private
reference is stored under `.data/local-voices`; no reference audio is published as
a public website asset. No existing agent's selected voice was changed.

The fast-default catalog in `lib/agent-test.ts` now also discovers CosyVoice voices.
Existing owner/rights filtering still applies. `af_heart` synthesis retains its fast
engine; `lissa` uses the cloning engine. If the cloning catalog is offline, the fast
default remains available. TypeScript and the voice-catalog routing test passed.

## Preview and limits

Preview: `.data/voice-reference-whatsapp-20261111/lissa-preview.wav`.
Requested speech: “Hi, this is Lissa from Shahvex. I'm calling about a possible
benefit review. Is now an okay time?” The STT check recovered the sentence, spelling
proper names as Lisa/Shavex. The 24 kHz output is 5.68 seconds long, with a longest
low-energy interval of approximately 0.30 seconds. Initial generation took 6.73
seconds, including preparing the speaker cache; this is not a live-call latency
benchmark.

The clone is generated and audible PCM was verified. Exact speaker similarity,
American accent quality and emotional delivery require listening review; they are
not guaranteed by transcription or waveform metrics. The reference's tone is used
by zero-shot cloning; no deterministic per-emotion controls were added.

## Remaining activation step

The Windows adapter still has its previous voice-list code cached. Restart through
the existing script was attempted with sandbox escalation, but Windows denied
process termination without Administrator rights. This was an OS permission
failure, not an automatic approval-review rejection. Run in Administrator PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\Shahvex\deployment\Restart-PcAiAdapter.ps1"
```

Then reopen the voice selector and select Lissa for the desired agent. The script
refuses to interrupt active sessions. No website publication was performed.
