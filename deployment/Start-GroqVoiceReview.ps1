[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ReleaseRoot,
  [Parameter(Mandatory=$true)][string]$PrivateKeyFile,
  [string]$EngineContract='C:\Shahvex-AI\integration-gateway\.env.engine-contract.json',
  [switch]$ApprovedVoiceReviewWindow,
  [switch]$ConfirmedBrowserMaintenance
)
$ErrorActionPreference='Stop'
if(!$ApprovedVoiceReviewWindow -or !$ConfirmedBrowserMaintenance){throw 'Separate voice-review approval and fresh authenticated browser maintenance/zero-relay confirmation required'}
$root=(Resolve-Path -LiteralPath $ReleaseRoot).Path
$manifest=Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
foreach($entry in $manifest.files){
  if($entry.path -notmatch '^runtime/[a-z-]+\.cjs$'){throw 'Unexpected runtime path'}
  $file=Join-Path $root $entry.path
  if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256){throw 'Release hash mismatch'}
  & node --check $file
  if($LASTEXITCODE -ne 0){throw 'JavaScript syntax check failed'}
}
if(!(Test-Path -LiteralPath $PrivateKeyFile) -or !(Test-Path -LiteralPath $EngineContract)){throw 'Existing private key file/engine contract missing'}
if(@(Get-NetTCPConnection -LocalPort 8789 -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Review port already occupied'}
$changes=@{
  SHAHVEX_GROQ_VOICE_REVIEW='1';SHAHVEX_AGENT_INTELLIGENCE='0';NODE_ENV='development';
  SHAHVEX_ENGINE_CONTRACT=$EngineContract;SHAHVEX_GROQ_KEY_FILE=(Resolve-Path -LiteralPath $PrivateKeyFile).Path;
  SHAHVEX_TIMING_LOG=(Join-Path $root ('review-timing-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'.jsonl'))
}
$names=@($changes.Keys)+@('SHAHVEX_GATEWAY_TOKEN');$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$secret=$null
try{
  $secret=Import-Clixml -LiteralPath (Join-Path $env:LOCALAPPDATA 'Shahvex/LocalServices/gateway-token.dpapi.xml')
  if($secret -isnot [Security.SecureString]){throw 'Unexpected private Gateway credential format'}
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose();$secret=$null}
  $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers @{Authorization=('Bearer '+$token)} -TimeoutSec 5
  if($health.ready -ne $true -or $health.activeSessions -ne 0 -or $health.queue.active -ne 0 -or $health.queue.pending -ne 0){throw 'Original Gateway must be authenticated, ready and idle'}
  $gpuLine=(& nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits).Trim()
  if($LASTEXITCODE -ne 0 -or $gpuLine -notmatch '^\d+$' -or [int]$gpuLine -gt 6908){throw 'Review GPU admission failed'}
  $residency=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 5
  if(@($residency.models).Count -ne 0){throw 'Wait for natural Ollama expiry; do not unload it'}
  foreach($name in $changes.Keys){[Environment]::SetEnvironmentVariable($name,$changes[$name],'Process')}
  $env:SHAHVEX_GATEWAY_TOKEN=$token;$token=$null
  Write-Host 'Starting ONLY the isolated loopback review Gateway on 8789. Ctrl+C in this terminal stops ONLY this review child.'
  & node --use-system-ca (Join-Path $root 'runtime/groq-voice-review.cjs')
  if($LASTEXITCODE -ne 0){throw 'Isolated review process exited unsuccessfully'}
}finally{
  $token=$null;if($secret){$secret.Dispose()}
  foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
}
