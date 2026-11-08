# Shahvex Physical Gateway Deployment

This ZIP is standalone and contains no Node dependencies, Python environment, model weights, credentials or private configuration. It uses the existing engine at `C:\Shahvex-AI`. Extracted files belong only in the NEW `integration-gateway` directory. No existing engine scripts or voice profiles are overwritten.

## Terminal 1: Windows PowerShell on the physical PC

Copy `Shahvex-Physical-Gateway-Deployment-v1.0.0.zip` to your Downloads directory first. Check the published ZIP SHA256 against `Get-FileHash` (the expected hash is supplied with the delivery).

```powershell
$zip = Join-Path $env:USERPROFILE 'Downloads\Shahvex-Physical-Gateway-Deployment-v1.0.0.zip'
$destination = 'C:\Shahvex-AI\integration-gateway'
Get-FileHash -LiteralPath $zip -Algorithm SHA256
if (!(Test-Path -LiteralPath 'C:\Shahvex-AI' -PathType Container)) { throw 'Existing engine root not found' }
if (Test-Path -LiteralPath $destination) { throw 'Destination already exists; stop to avoid overwriting files' }
Expand-Archive -LiteralPath $zip -DestinationPath $destination
Get-ChildItem -LiteralPath $destination
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$destination\Verify-Prerequisites.ps1"
```

The execution-policy override applies only to the verifier process; no machine policy is changed. Review the script before running it. It checks packaged hashes/paths, existing engine files, Node version, Python package availability and local TCP listeners. It does not install anything, import/load models, alter services, contact model APIs, start tunnels or make calls. It may report failed listener checks if existing services are stopped: use your normal existing startup procedure, not a new engine configuration.

**Stop after verification and share only PASS/FAIL output.** Do not start the gateway until the local prerequisites are reviewed. No `npm install` or `pip install -r requirements.txt` is required. `requirements.txt` is an inventory, not an upgrade instruction.

## Files for the next local-only step

- `server.cjs`: authenticated gateway, binds 127.0.0.1:8787 only.
- `whisper_bridge.py`: full independent wrapper, binds 127.0.0.1:8788; uses existing faster-whisper base.en CPU INT8 cache with downloads disabled.
- `physical-engine.example.json`: local Ollama streaming `/api/chat`, Chatterbox `/synthesize` returning mono PCM16 WAV, and local Whisper wrapper paths. Contains no authentication fields; these must be created privately at setup time. Voice attestation defaults to false until verified locally.
- `prepare_audio.py`, `e2e.cjs`, `backend-client.cjs`: later local prerecorded-audio rehearsal tools; not automatically run.
- `package.json`, `requirements.txt`: runtime/dependency inventory.
- `SHA256SUMS.json`: SHA256 for each delivered file except the manifest itself.

Later setup will generate distinct process-scoped gateway/Whisper secrets and a private contract, verify existing voice output, then start only local bridge services. The sample cannot authenticate to Whisper as delivered, intentionally. Chatterbox health schema still requires confirmation; do not assume HTTP 200 proves readiness. No public tunnel or telephony adapter is activated by extraction or verification.

Existing Ollama, Chatterbox and conversation scripts remain unchanged. A separate Whisper worker consumes additional CPU/RAM only when explicitly started later. Native inference cannot always be preempted even when transport audio is cancelled. No production call capacity is claimed.
