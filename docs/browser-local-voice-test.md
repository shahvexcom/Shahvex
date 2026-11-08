# Local Jennifer microphone rehearsal — awaiting audible verification

## Disabled control / HTTP 403 diagnosis and safe configuration

The original `Local test disabled` 403 is emitted before admin/agent checks when the opt-in/development/host/origin gate fails. Inspection found no `SHAHVEX_LOCAL_VOICE_TEST`, `SHAHVEX_GATEWAY_URL` or `SHAHVEX_GATEWAY_TOKEN` in this workspace's `.env` or agent process environment. This confirms missing local configuration here; a separately launched Next process can have different environment variables. The updated availability check reports only booleans to the authenticated browser, never the token. Missing backend credentials return 503, not a misleading authorization bypass.

In the existing **Next.js terminal only**, Ctrl+C, then run:

```powershell
Set-Location P:\shahvex
$env:SHAHVEX_LOCAL_VOICE_TEST = '1'
$env:SHAHVEX_GATEWAY_URL = 'http://127.0.0.1:8787'
$privateToken = Read-Host 'Existing Gateway token (not a new token)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateToken)
try {
  $env:SHAHVEX_GATEWAY_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $privateToken.Dispose()
}
$health = Invoke-RestMethod "$env:SHAHVEX_GATEWAY_URL/health" -Headers @{ Authorization = "Bearer $env:SHAHVEX_GATEWAY_TOKEN" }
if ($health.ready -ne $true) { throw 'Gateway not ready' }
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Do not change/restart the AI Gateway, regenerate secrets, replace `.env`, or prefix credentials with `NEXT_PUBLIC_`. Next reads process environment at startup; environment changes in another terminal do not update a running Next process. Use this local URL consistently, sign in as controller, and refresh Agents. The button stays disabled if backend setup is unavailable; inspect authenticated `GET /api/admin/local-voice?status=1` in browser network tools for configuration booleans only.

The feature requires exact development mode and rejects Vercel/Railway environment markers even if opted in. Production builds remain disabled. Wrong Gateway credentials still fail during authenticated create; do not bypass that failure. This implementation does not verify the token with a health call every time it renders the button.

The modal shows actual agent name/avatar, measured microphone levels, mute and stop controls. Listening begins only after media capture is connected; Speaking is driven by received audio. Thinking means measured speech followed by the local pause detector while awaiting a reply, not a claim of an Ollama stage event. Transcript text is explicitly unavailable because the existing Gateway sends no transcript events. No fake transcript or response messages are generated.

Keep the working gateway/Whisper/Ollama/Chatterbox processes running. The physical cancellation patch should be verified first. No physical files or models are changed by this browser feature. Backend and engine must be on the same PC for the loopback URL below.

In the existing website backend terminal, stop only Next.js with Ctrl+C. Preserve its existing database/auth settings. Set these process variables; reuse the already provisioned gateway token, never regenerate or print it:

```powershell
Set-Location P:\shahvex
$env:SHAHVEX_GATEWAY_URL = 'http://127.0.0.1:8787'
$env:SHAHVEX_LOCAL_VOICE_TEST = '1'
if ([string]::IsNullOrWhiteSpace($env:SHAHVEX_GATEWAY_TOKEN)) { throw 'Provision the existing gateway token privately as described in local-backend-connection.md' }
Invoke-RestMethod "$env:SHAHVEX_GATEWAY_URL/health" -Headers @{ Authorization = "Bearer $env:SHAHVEX_GATEWAY_TOKEN" }
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Require health ready true and no other active rehearsal session. Use headphones to avoid loudspeaker feedback triggering VAD.

1. Open `http://127.0.0.1:3000/controler/login` in current Chrome/Edge; sign in as the existing controller.
2. Open Agents, search Jennifer, and click **Local voice test** in her credentials cell. This is the only added UI control; existing layouts/styles/workflows remain intact. The control appears only on localhost; the backend additionally requires development mode and the opt-in flag.
3. Grant microphone permission. Wait for “Listening”. Say a short sentence relevant to Jennifer's assigned script, then pause at least 200ms. Whisper runs on finalized utterances, Ollama generates its reply, and Chatterbox WAV is converted to browser PCM playback. First-response latency includes those full stages; this is not token-streaming synthesis.
4. Confirm you hear the existing voice reply using Jennifer's actual assigned script. Speak while audio plays: gateway VAD sends `clear`, which stops queued browser sources; old generations must not resume. Gateway outputs 16kHz mono PCM16 audio events over NDJSON, relayed through server-sent events. Microphone uploads are ordered 100ms PCM batches from an AudioWorklet.
5. Click **Stop voice test**. Verify the browser microphone indicator disappears. Closing/navigating away also releases tracks/AudioContext and requests cleanup. Relay hard limit is three minutes; expired/disconnected tests stop. A gateway/network failure can prevent immediate close; gateway expiry remains the fallback.
6. In the existing authenticated rehearsal shell, request gateway `/health` again. After work drains require activeSessions=0 and queue active/pending=0. Then start another Jennifer test to check cleanup/admission recovery.

Authentication is checked on every browser relay route; session handles are scoped to the controller identity. Gateway service/scoped tokens stay in the server-only relay, not browser events. Cross-origin writes and non-loopback hosts are rejected. Production mode disables the API, so the Vercel deployment is unchanged. No public tunnel/telephony provider or real calls are used. Stop on errors rather than changing working model settings.

Known limits: local development process state (restart/HMR can interrupt tests), 16kHz AudioContext support required, energy VAD with 200ms silence segmentation, native inference may continue after cancellation, and echo cancellation depends on browser/device. The microphone/playback path must be checked manually with actual hardware. Passing mocked gateway tests or TypeScript does not establish audible completion.

Repository checks:

```powershell
node --test tests/gateway*.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Report the first visible error, gateway stage logs without secrets, and whether speech/response/interruption/cleanup worked. Do not claim the feature complete until Jennifer can be heard and interrupted successfully in the actual local browser.
