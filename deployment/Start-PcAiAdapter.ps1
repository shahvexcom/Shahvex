[CmdletBinding()]
param([ValidateSet('Start','Status')][string]$Action='Status', [string]$OperatorAccount='')
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$privateDir=Join-Path $repoRoot '.data\pc-ai'
$envFile=Join-Path $privateDir '.env.pc-ai'
$port=8774
if($Action -eq 'Start') {
  $newPrivateDir=!(Test-Path -LiteralPath $privateDir)
  if(!(Test-Path -LiteralPath $privateDir)) { New-Item -ItemType Directory -Path $privateDir -Force | Out-Null }
  # Protect secrets/logs before writing. Never print secret material.
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if($newPrivateDir) {
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner($identity.User)
  } else {
    $acl=Get-Acl -LiteralPath $privateDir
    if(!$acl.AreAccessRulesProtected) { throw 'Private directory inherits permissions; review ACL before launch.' }
  }
  foreach($sid in @($identity.User.Value,'S-1-5-18','S-1-5-32-544')) {
    $rule=New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  if($OperatorAccount) {
    $operatorSid=([Security.Principal.NTAccount]::new($OperatorAccount)).Translate([Security.Principal.SecurityIdentifier])
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($operatorSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  }
  if($newPrivateDir) {
    Set-Acl -LiteralPath $privateDir -AclObject $acl
  } elseif($OperatorAccount) {
    # Modify only the DACL; Set-Acl on an existing descriptor can request SACL privileges.
    & icacls.exe $privateDir /grant ($OperatorAccount+':(OI)(CI)F') | Out-Null
    if($LASTEXITCODE -ne 0) { throw 'Could not grant the named operator access.' }
  }
  if(!(Test-Path -LiteralPath $envFile)) {
    $bytes=New-Object byte[] 32
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes); $key=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant() }
    finally { $rng.Dispose();[Array]::Clear($bytes,0,$bytes.Length) }
    @("SHAHVEX_PC_AI_SECRET=$key",'SHAHVEX_PC_AI_URL=','SHAHVEX_PC_AI_MAX_SESSIONS=1','SHAHVEX_PC_TESTER_PORT=8774') | Set-Content -LiteralPath $envFile -Encoding ASCII
    $key=$null
  }
}
if(!(Test-Path -LiteralPath $envFile)) { throw 'Adapter is not provisioned; run -Action Start first.' }
$line=Get-Content -LiteralPath $envFile | Where-Object { $_ -like 'SHAHVEX_PC_AI_SECRET=*' }
if(@($line).Count -ne 1) { throw 'Invalid adapter secret configuration' }
$secret=$line.Substring('SHAHVEX_PC_AI_SECRET='.Length)
if($secret.Length -lt 32) { throw 'Invalid adapter secret length' }
function Test-Adapter {
  try {
    $response=Invoke-WebRequest -Uri "http://127.0.0.1:$port/engine/8767/health" -Headers @{'x-shahvex-ai-key'=$secret} -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch { return $false }
}
if(Test-Adapter) { Write-Output 'PC AI adapter is authenticated and TTS health responds on loopback 8774.';return }
if($Action -eq 'Status') { throw 'PC AI adapter is not responding with its provisioned key.' }
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
try { $listener.Start() } finally { $listener.Stop() }
$node=(Get-Command node.exe -ErrorAction Stop).Source
$service=Join-Path $repoRoot 'gateway\tester-service.cjs'
$process=Start-Process -FilePath $node -ArgumentList @('--env-file="'+$envFile+'"','"'+$service+'"') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $privateDir 'adapter.stdout.log') -RedirectStandardError (Join-Path $privateDir 'adapter.stderr.log')
@{pid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateDir 'process.json')
for($attempt=0;$attempt -lt 20;$attempt++) {
  if(Test-Adapter) { Write-Output 'PC AI adapter started and authenticated on loopback 8774. Existing engines and tunnel unchanged.';return }
  if($process.HasExited) { throw 'Adapter exited; inspect the protected stderr log locally.' }
  Start-Sleep -Milliseconds 500
}
throw 'Adapter health did not become ready; inspect protected logs. No existing service was stopped.'
