[CmdletBinding()]
param([string]$EngineRoot = 'C:\Shahvex-AI')
$ErrorActionPreference = 'Stop'
$failures = 0
function Check([bool]$Passed, [string]$Description) {
  if ($Passed) { Write-Host "PASS $Description" }
  else { Write-Host "FAIL $Description"; $script:failures++ }
}
$required = @('server.cjs','core.cjs','audio-stream.cjs','services.cjs','wav.cjs',
  'backend-client.cjs','whisper_bridge.py','prepare_audio.py','e2e.cjs',
  'physical-engine.example.json','agent-e2e.example.json','package.json',
  'requirements.txt','INSTALL-WINDOWS.md','SHA256SUMS.json')
foreach ($relative in $required) {
  Check (Test-Path -LiteralPath (Join-Path $PSScriptRoot $relative) -PathType Leaf) "Package file: $relative"
}
$manifestPath = Join-Path $PSScriptRoot 'SHA256SUMS.json'
if (Test-Path -LiteralPath $manifestPath) {
  foreach ($entry in (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)) {
    if ($entry.path -notmatch '^[A-Za-z0-9_.-]+$') { Check $false 'Invalid manifest path'; continue }
    $file = Join-Path $PSScriptRoot $entry.path
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      Check ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $entry.sha256) "SHA256: $($entry.path)"
    } else { Check $false "Missing manifest file: $($entry.path)" }
  }
}
Check (Test-Path -LiteralPath $EngineRoot -PathType Container) 'Existing engine directory'
$python = Join-Path $EngineRoot '.venv\Scripts\python.exe'
Check (Test-Path -LiteralPath $python -PathType Leaf) 'Existing Python virtual environment'
Check (Test-Path -LiteralPath (Join-Path $EngineRoot 'handsfree_chatterbox_step83.py')) 'Existing conversation script (inspection only)'
Check (Test-Path -LiteralPath (Join-Path $EngineRoot 'chatterbox-testing\chatterbox_voice_server.py')) 'Existing Chatterbox server (inspection only)'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $versionText = & $node.Source --version
  try { $version = [version]($versionText.TrimStart('v')); Check ($version -ge [version]'20.19.0') "Node >=20.19.0 ($versionText)" }
  catch { Check $false 'Readable Node version' }
} else { Check $false 'Node installed (no installation attempted)' }
if (Test-Path -LiteralPath $python -PathType Leaf) {
  & $python -B -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('faster_whisper') else 1)"
  Check ($LASTEXITCODE -eq 0) 'Existing faster-whisper package available (no model load/download)'
}
try {
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in 11434,8765,8787,8788 })
  $listeners | Select-Object LocalAddress,LocalPort | Format-Table
  foreach ($port in @(11434,8765)) {
    $found = @($listeners | Where-Object { $_.LocalPort -eq $port })
    Check ($found.Count -gt 0) "Existing engine listener: $port"
  }
  Check (@($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') }).Count -eq 0) 'Engine/gateway ports bound only to loopback'
} catch { Check $false 'Unable to inspect TCP listeners; inspect manually' }
Write-Host 'No packages installed, models loaded, services started, firewall rules changed or network requests sent.'
if ($failures -gt 0) { Write-Host "$failures check(s) failed. Stop here and review the output."; exit 1 }
Write-Host 'Prerequisites passed. This does not verify model inference or voice quality.'
exit 0
