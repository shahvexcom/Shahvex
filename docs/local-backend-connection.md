# Current setup: local Windows backend to local gateway

Topology: local browser → local Next.js website backend (127.0.0.1:3000); trusted Node rehearsal → authenticated gateway (127.0.0.1:8787) → local Whisper/Ollama/Chatterbox. The exported website agent config bridges the existing controller workflow to the backend rehearsal CLI. This is not a browser audio proxy or a new live call workflow.

The Vercel frontend remains unchanged. Its deployed server functions cannot reach your PC's localhost. For this rehearsal sign in through the **local** website URL, not Vercel. No CORS changes or public ports are needed. If backend and gateway are actually different Windows PCs, stop: `127.0.0.1` will not connect them.

## Terminal A — existing physical gateway/engine terminals

Leave all working processes and secrets unchanged. Do not start a second gateway or regenerate tokens.

## Terminal B — local website backend, Windows PowerShell

Use the checkout containing the existing gateway export route. The example checkout below is `P:\shahvex`; change only that path if your local checkout is elsewhere.

```powershell
Set-Location P:\shahvex
node --version
Test-Path app\api\admin\agents\gateway-export\route.ts
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 8787,8788,11434,8765 } |
  Select-Object LocalAddress,LocalPort
$env:SHAHVEX_GATEWAY_URL = 'http://127.0.0.1:8787'
```

Use Node >=20.19 and expect the route check to return True. All AI listeners must remain loopback. Preserve the existing database URL, auth secret and encryption key; do not replace `.env`. For persistent backend-only configuration the relevant entries are:

```dotenv
SHAHVEX_GATEWAY_URL=http://127.0.0.1:8787
SHAHVEX_GATEWAY_TOKEN=<existing gateway token, provisioned privately>
```

Do not paste the placeholder literally, commit secrets, or use `NEXT_PUBLIC_` for either value. Prefer process-scoped provisioning below. To enter the already existing gateway token privately without displaying it (not a new token):

```powershell
$privateToken = Read-Host 'Existing gateway token' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateToken)
try {
  $env:SHAHVEX_GATEWAY_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  $privateToken.Dispose()
}
Invoke-RestMethod "$env:SHAHVEX_GATEWAY_URL/health" -Headers @{ Authorization = "Bearer $env:SHAHVEX_GATEWAY_TOKEN" }
```

Expect `ready:true`. Do not continue on authentication or health failure. The token necessarily exists in the backend process environment; never print that environment or send it to the browser.

The startup loaders were neutralized earlier (`init` is inert; PostCSS contains only Tailwind). Start the reviewed existing Next entrypoint directly, loopback only, with no dependency install or build:

```powershell
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000
```

Leave this terminal open. This uses the existing website runtime, including its existing database initialization behavior; no new migration/schema changes are added by this integration. No Prisma migration/reset/seed command is required.

## Browser on the same PC — export one actual agent

Open `http://127.0.0.1:3000/controler/login` and sign in normally. Use this hostname consistently so the controller session cookie applies. Select an existing approved non-BPO controller agent with an assigned script. Its ID is available in the existing `/api/admin/agents` response while signed in.

Open the following URL in the same authenticated browser, replacing `YOUR_AGENT_ID`:

```text
http://127.0.0.1:3000/api/admin/agents/gateway-export?agentId=YOUR_AGENT_ID
```

Download `shahvex-agent-rehearsal.json`. Export is read-only and excludes gateway/provider secrets and leads. It uses the existing assigned script/name, a rehearsal campaign label, and the physical engine's verified default voice. It does not change the UI's voice/gender/accent settings or create a campaign. BPO-agent export is outside this controller-only rehearsal.

## Terminal C — local backend rehearsal, Windows PowerShell

```powershell
Set-Location P:\shahvex
$env:SHAHVEX_GATEWAY_URL = 'http://127.0.0.1:8787'
Copy-Item -LiteralPath "$env:USERPROFILE\Downloads\shahvex-agent-rehearsal.json" -Destination '.env.agent-e2e.json' -ErrorAction Stop
```

Provision `SHAHVEX_GATEWAY_TOKEN` in this terminal using the **same private Read-Host block from Terminal B**. Shell environment variables do not automatically carry over between terminals. The CLI does not load `.env` automatically.

Use the prerecorded `question.pcm` that already passed your physical test: mono PCM16 LE, 16000Hz, <=9 seconds and aligned to 640-byte frames. Substitute its actual path if different. Each reply path must be new.

```powershell
node gateway/isolation-check.cjs .env.agent-e2e.json
node gateway/e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\website-agent-reply.pcm
node gateway/e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\unused-cancel.pcm --cancel
```

Run one at a time and stop on failure. Expect isolation checks true; normal `passed/authenticated/cleanup:true` with nonzero audio bytes; cancellation `cancelled/cleanup:true`. Results vary with generated speech. This verifies one **exported website agent** reaches real inference through a trusted local backend process; it does not claim a Vercel-to-local connection or live browser streaming. Model-native processing may finish after network cancellation. Actual runs on your Windows machine remain operator verification; local repository mocks are separate evidence.

No SSH tunnel, firewall rule, Railway deployment or real telephony is involved. VICIdial remains behind the existing adapter.
