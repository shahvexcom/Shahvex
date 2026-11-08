[CmdletBinding()]
param([string]$Repository='P:\shahvex',[switch]$UseGroqReview,[switch]$ApprovedBackendRestart)
$ErrorActionPreference='Stop'
if(!$ApprovedBackendRestart){throw 'Separate approval to restart only the local Next.js backend is required'}
if(@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Existing backend is still running. Stop it only through its original terminal after approval; this script stops nothing'}
$changes=@{SHAHVEX_GATEWAY_URL=$(if($UseGroqReview){'http://127.0.0.1:8789'}else{'http://127.0.0.1:8787'});SHAHVEX_LOCAL_VOICE_TEST='1';SHAHVEX_LOCAL_VOICE_MAINTENANCE='1';NODE_ENV='development'}
$previous=@{};foreach($name in @($changes.Keys)+@('SHAHVEX_GATEWAY_TOKEN')){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
  $secret=Import-Clixml -LiteralPath (Join-Path $env:LOCALAPPDATA 'Shahvex/LocalServices/gateway-token.dpapi.xml')
  if($secret -isnot [Security.SecureString]){throw 'Unexpected Gateway credential format'}
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try{$env:SHAHVEX_GATEWAY_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
  foreach($name in $changes.Keys){[Environment]::SetEnvironmentVariable($name,$changes[$name],'Process')}
  Push-Location -LiteralPath $Repository
  try{& npm.cmd run dev -- --hostname 127.0.0.1 --port 3000;if($LASTEXITCODE -ne 0){throw 'Local backend exited unsuccessfully'}}finally{Pop-Location}
}finally{foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
