[CmdletBinding()]
param(
  [ValidateSet('Prepare','RefreshTools','Deploy','Recover','StopManaged','RegisterLogon','RegisterBoot','RunGateway','RunBackend')][string]$Action='Prepare',
  [string]$IdleHealthFile='C:\Users\UC\Documents\Shahvex-idle-health.json',
  [ValidateSet('TimingCapture','FirstAudio','VoiceFunctional','VoiceStreaming')][string]$Patch='TimingCapture',
  [int]$ExpectedGatewayPid=0
)
$ErrorActionPreference='Stop'
$repo='P:\shahvex'
$target='C:\Shahvex-AI\integration-gateway'
$backup=Join-Path $target 'backup-before-timing-20261102-200114'
$contract=Join-Path $target '.env.engine-contract.json'
$store=Join-Path $env:LOCALAPPDATA 'Shahvex\LocalServices'
$credential=Join-Path $store 'gateway-token.dpapi.xml'
$installedScript=Join-Path $store 'Manage-ShahvexLocal.ps1'
$installer=Join-Path $store 'Install-TimingCapture.ps1'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
function Approve([string]$Text){if((Read-Host "Type $Text to approve") -cne $Text){throw 'Not approved'}}
function Protect-Directory {
  New-Item -ItemType Directory -Force -Path $store | Out-Null
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner($identity.User)
  foreach($sid in @($identity.User.Value,'S-1-5-18','S-1-5-32-544')){
    $rule=New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $store -AclObject $acl
}
function Load-Token {
  if(!(Test-Path -LiteralPath $credential)){throw 'Prepare the protected credential first'}
  $directoryAcl=Get-Acl -LiteralPath $store
  if(!$directoryAcl.AreAccessRulesProtected){throw 'Credential directory inherited permissions unexpectedly; stop for ACL review'}
  foreach($path in @($store,$credential)){
    foreach($rule in (Get-Acl -LiteralPath $path).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
      if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($identity.User.Value,'S-1-5-18','S-1-5-32-544')){throw 'Credential access granted to an unexpected identity; stop for ACL review'}
    }
  }
  $secret=Import-Clixml -LiteralPath $credential
  if($secret -isnot [Security.SecureString]){throw 'Invalid DPAPI credential type'}
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try{$env:SHAHVEX_GATEWAY_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
  if($env:SHAHVEX_GATEWAY_TOKEN.Length -lt 32){throw 'Invalid protected credential'}
}
function Local-Health {
  $h=Invoke-RestMethod http://127.0.0.1:8787/health -Headers @{Authorization="Bearer $env:SHAHVEX_GATEWAY_TOKEN"} -TimeoutSec 5
  if($h.ready -ne $true -or $h.activeSessions -ne 0 -or $h.queue.active -ne 0 -or $h.queue.pending -ne 0){throw 'Gateway not authenticated, ready and idle'}
  return $h
}
function Listener([int]$Port){return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -eq $Port})}
function Launch([string]$Role){
  $port=if($Role -eq 'RunGateway'){8787}else{3000}
  if(@(Listener $port).Count){throw "Port already occupied: $port"}
  # No token is placed in arguments. The child decrypts its own DPAPI copy.
  Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @('-NoProfile','-File',('"'+$installedScript+'"'),'-Action',$Role) -WorkingDirectory $store -WindowStyle Hidden | Out-Null
}
function Wait-Gateway {
  $lastError=$null
  for($attempt=0;$attempt -lt 20;$attempt++){
    try{Local-Health | Out-Null;return}catch{$lastError=$_.Exception.Message;Start-Sleep -Seconds 1}
  }
  throw 'Gateway did not authenticate and become ready. Keep maintenance enabled and use Recover; do not rotate again.'
}
if($Action -eq 'Prepare'){
  Approve 'PREPARE SHAHVEX COORDINATED ROTATION'
  if(Test-Path -LiteralPath $credential){throw 'Credential already exists; reuse it. Never regenerate during rollback.'}
  if(!(Test-Path -LiteralPath (Join-Path $repo '.env'))){throw 'Existing persistent backend environment missing; preserve existing DB/auth settings before restart'}
  Protect-Directory
  Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript
  Copy-Item -LiteralPath (Join-Path $repo 'deployment\Install-TimingCapture.ps1') -Destination $installer
  $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($bytes);$secure=ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force;$secure | Export-Clixml -LiteralPath $credential;$secure.Dispose()}finally{$rng.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
  Load-Token
  Remove-Item Env:SHAHVEX_GATEWAY_TOKEN
  Write-Host 'Prepared: DPAPI CurrentUser credential and protected launchers. No service stopped or task registered.'
  return
}
Load-Token
if($Action -eq 'RefreshTools'){
  Approve 'UPDATE SHAHVEX DEPLOYMENT TOOLS ONLY'
  foreach($name in @('Manage-ShahvexLocal.ps1','Install-TimingCapture.ps1','IdleProof.ps1')){
    Copy-Item -LiteralPath (Join-Path $repo "deployment\$name") -Destination (Join-Path $store $name) -Force
  }
  Write-Host 'Protected deployment tools updated. Existing Gateway token, services, tasks and backups unchanged.'
  return
}
if($Action -in @('RunGateway','RunBackend')){
  if(!(Test-Path -LiteralPath $contract)){throw 'Existing engine contract missing'}
  $env:SHAHVEX_ENGINE_CONTRACT=$contract
  $env:SHAHVEX_GATEWAY_URL='http://127.0.0.1:8787'
  $env:SHAHVEX_LOCAL_VOICE_TEST='1'
  $env:SHAHVEX_LOCAL_VOICE_MAINTENANCE='1'
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  @{wrapperPid=$PID;startTicks=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks;role=$Action} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $store "$Action-process.json") -Encoding UTF8
  if($Action -eq 'RunGateway'){
    Set-Location -LiteralPath $target
    $env:SHAHVEX_ENDPOINT_SILENCE_MS='400'
    $env:SHAHVEX_TIMING_LOG=Join-Path $store ('gateway-'+[guid]::NewGuid().ToString('N')+'.jsonl')
    & $node (Join-Path $target 'server.cjs')
  }else{
    Set-Location -LiteralPath $repo
    & $node (Join-Path $repo 'node_modules\next\dist\bin\next') dev --hostname 127.0.0.1 --port 3000
  }
  $exitCode=$LASTEXITCODE;Remove-Item Env:SHAHVEX_GATEWAY_TOKEN;exit $exitCode
}
if($Action -eq 'StopManaged'){
  . (Join-Path $PSScriptRoot 'IdleProof.ps1') -ProofPatch $Patch
  Local-Health | Out-Null
  $plan=@()
  foreach($role in @('RunBackend','RunGateway')){
    $port=if($role -eq 'RunGateway'){8787}else{3000}
    $listeners=@(Listener $port)
    if(!$listeners.Count){continue}
    if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Unexpected managed listener'}
    $record=Get-Content -LiteralPath (Join-Path $store "$role-process.json") -Raw | ConvertFrom-Json
    $wrapper=Get-Process -Id $record.wrapperPid -ErrorAction Stop
    $child=Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
    if($wrapper.StartTime.ToUniversalTime().Ticks -ne $record.startTicks -or !$child -or $child.ParentProcessId -ne $wrapper.Id -or $child.Name -ne 'node.exe'){throw 'Managed process identity mismatch; refusing to kill'}
    $plan+=@{pid=$child.ProcessId;created=$child.CreationDate}
  }
  Approve 'STOP MANAGED GATEWAY AND NEXT'
  Invoke-IdleProof 'Arm'
  Write-Host 'Approved managed stop. Issue POST /api/admin/local-voice?deploymentProof=1 in the signed-in browser; waiting up to 180 seconds.'
  $deadline=(Get-Date).AddSeconds(180);$accepted=$false
  while((Get-Date) -lt $deadline){try{Invoke-IdleProof 'Check' | Out-Null;$accepted=$true;break}catch{Start-Sleep -Milliseconds 250}}
  if(!$accepted){throw 'No fresh signed maintenance proof; no managed services stopped'}
  Local-Health | Out-Null
  Invoke-IdleProof 'Consume' | Out-Null
  foreach($taskName in @('Shahvex-RunGateway','Shahvex-RunBackend')){if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){Disable-ScheduledTask -TaskName $taskName | Out-Null}}
  foreach($item in $plan){$current=Get-CimInstance Win32_Process -Filter "ProcessId = $($item.pid)";if(!$current -or $current.CreationDate -ne $item.created){throw 'Managed PID changed'};Stop-Process -Id $item.pid -ErrorAction Stop}
  Write-Host 'Only verified managed Node children stopped. Persistent DPAPI token unchanged.'
  return
}
if($Action -in @('RegisterLogon','RegisterBoot')){
  Approve 'REGISTER SHAHVEX PERSISTENT TASKS'
  Local-Health | Out-Null
  $password=$null
  if($Action -eq 'RegisterBoot'){
    # Task Scheduler protects this Windows logon credential. Never use S4U:
    # its token cannot decrypt a CurrentUser DPAPI secret reliably.
    $windowsCredential=Get-Credential -UserName $identity.Name -Message 'Windows account password for approved startup tasks (not a Gateway token)'
    if(!$windowsCredential -or $windowsCredential.UserName -ne $identity.Name){throw 'Must use the same Windows identity that prepared DPAPI'}
    $password=$windowsCredential.GetNetworkCredential().Password
  }
  foreach($role in @('RunGateway','RunBackend')){
    $taskName="Shahvex-$role"
    if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw "Task exists; review rather than overwrite: $taskName"}
  }
  foreach($role in @('RunGateway','RunBackend')){
    $taskAction=New-ScheduledTaskAction -Execute "$PSHOME\powershell.exe" -Argument "-NoProfile -File `"$installedScript`" -Action $role" -WorkingDirectory $store
    $trigger=if($Action -eq 'RegisterBoot'){New-ScheduledTaskTrigger -AtStartup}else{New-ScheduledTaskTrigger -AtLogOn -User $identity.Name}
    $principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    if($Action -eq 'RegisterBoot'){
      Register-ScheduledTask -TaskName "Shahvex-$role" -Action $taskAction -Trigger $trigger -User $identity.Name -Password $password -RunLevel Limited -Settings $settings | Out-Null
    }else{Register-ScheduledTask -TaskName "Shahvex-$role" -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings | Out-Null}
  }
  $password=$null
  Write-Host 'Tasks registered, not started. Gateway token remains DPAPI-protected. Verify an actual sign-in/reboot before claiming recovery.'
  return
}
if($Action -ne 'Deploy' -and @(Listener 3000).Count){throw 'Stop only existing Next.js using its foreground Ctrl+C before Recover; do not kill by name'}
if($Action -eq 'Deploy'){
  & $installer -Mode Validate -Patch $Patch;if($LASTEXITCODE -ne 0){throw 'Installer validation failed'}
  if($Patch -eq 'VoiceStreaming'){& $installer -Mode Validate -Patch $Patch -Component Chatterbox;if($LASTEXITCODE -ne 0){throw 'Chatterbox preflight failed; no services stopped'}}
  $listeners=@(Listener 8787)
  if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Unexpected Gateway listener'}
  if($ExpectedGatewayPid -le 0){$ExpectedGatewayPid=$listeners[0].OwningProcess}
  if($listeners[0].OwningProcess -ne $ExpectedGatewayPid){throw 'Gateway PID changed'}
  $process=Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedGatewayPid"
  if(!$process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notmatch '(?i)(?:^|[\s"/\\])server\.cjs(?:[\s"]|$)'){throw 'Gateway process identity not verified'}
  $backendListener=@(Listener 3000)
  if($backendListener.Count -ne 1 -or $backendListener[0].LocalAddress -ne '127.0.0.1'){throw 'Local Next backend must remain running to issue proof'}
  $backend=Get-CimInstance Win32_Process -Filter "ProcessId = $($backendListener[0].OwningProcess)"
  if(!$backend -or $backend.Name -ne 'node.exe' -or $backend.CommandLine -notmatch '(?i)[\\/]next[\\/]dist[\\/]' -or $backend.CommandLine -notmatch [regex]::Escape($repo)){throw 'Local Next process identity cannot be established; refusing shutdown'}
  Approve "DEPLOY $Patch GATEWAY $ExpectedGatewayPid AND NEXT"
  if($Patch -in @('FirstAudio','VoiceFunctional','VoiceStreaming')){& $installer -Mode Backup -Patch $Patch -MaintenanceConfirmed;if($LASTEXITCODE -ne 0){throw 'Gateway backup failed; no services stopped'}}
  if($Patch -eq 'VoiceStreaming'){& $installer -Mode Backup -Patch $Patch -Component Chatterbox -MaintenanceConfirmed;if($LASTEXITCODE -ne 0){throw 'Chatterbox backup failed; no services stopped'}}
  . (Join-Path $PSScriptRoot 'IdleProof.ps1') -ProofPatch $Patch
  Invoke-IdleProof 'Arm'
  Write-Host 'Approved and preflight complete. In the signed-in local browser issue POST /api/admin/local-voice?deploymentProof=1. No download needed. Waiting up to 180 seconds.'
  $deadline=(Get-Date).AddSeconds(180);$accepted=$false
  while((Get-Date) -lt $deadline){
    try{Invoke-IdleProof 'Check' | Out-Null;$accepted=$true;break}catch{Start-Sleep -Milliseconds 250}
  }
  if(!$accepted){throw 'No fresh authenticated signed proof received; no services stopped'}
  $current=Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedGatewayPid"
  if(!$current -or $current.CreationDate -ne $process.CreationDate -or @((Listener 8787) | Where-Object {$_.OwningProcess -eq $ExpectedGatewayPid}).Count -ne 1){throw 'Gateway identity changed during approval'}
  $currentBackend=Get-CimInstance Win32_Process -Filter "ProcessId = $($backend.ProcessId)"
  if(!$currentBackend -or $currentBackend.CreationDate -ne $backend.CreationDate -or @((Listener 3000) | Where-Object {$_.OwningProcess -eq $backend.ProcessId}).Count -ne 1){throw 'Backend identity changed during approval'}
  Invoke-IdleProof 'Consume' | Out-Null
  Stop-Process -Id $backend.ProcessId -ErrorAction Stop
  Wait-Process -Id $backend.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
  if(@(Listener 3000).Count){throw 'Backend restarted itself; Gateway not stopped. Do not retry with consumed proof.'}
  Stop-Process -Id $ExpectedGatewayPid -ErrorAction Stop
  Wait-Process -Id $ExpectedGatewayPid -Timeout 15 -ErrorAction SilentlyContinue
  if(@(Listener 8787).Count){throw 'Gateway did not stop; no installation attempted'}
  try{& $installer -Mode Install -Patch $Patch -MaintenanceConfirmed -IdleHealthFile $IdleHealthFile;if($LASTEXITCODE -ne 0){throw 'Installation failed'}}
  catch{
    & $installer -Mode Rollback -Patch $Patch -MaintenanceConfirmed
    if($LASTEXITCODE -ne 0){throw 'Install AND rollback failed. Do not start services; preserve backup.'}
    Launch 'RunGateway';Wait-Gateway;Launch 'RunBackend'
    throw 'Patch failed; originals restored, restarted using SAME new DPAPI token. Maintenance remains enabled.'
  }
}elseif($Action -eq 'Recover'){
  Approve 'RESTORE SHAHVEX CODE WITH SAME TOKEN'
  $listeners=@(Listener 8787)
  if($listeners.Count){
    if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Unexpected recovery listener'}
    $record=Get-Content -LiteralPath (Join-Path $store 'RunGateway-process.json') -Raw | ConvertFrom-Json
    $wrapper=Get-Process -Id $record.wrapperPid -ErrorAction Stop
    $child=Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
    if(!$child -or $child.Name -ne 'node.exe' -or $child.ParentProcessId -ne $wrapper.Id -or $wrapper.StartTime.ToUniversalTime().Ticks -ne $record.startTicks){throw 'Recovery listener is not the verified managed Gateway'}
    $h=Invoke-RestMethod http://127.0.0.1:8787/health -Headers @{Authorization="Bearer $env:SHAHVEX_GATEWAY_TOKEN"} -TimeoutSec 5
    if($h.activeSessions -ne 0 -or $h.queue.active -ne 0 -or $h.queue.pending -ne 0){throw 'Gateway not authenticated and drained for recovery'}
    $again=Get-CimInstance Win32_Process -Filter "ProcessId = $($child.ProcessId)"
    if(!$again -or $again.CreationDate -ne $child.CreationDate){throw 'Recovery PID changed'}
    Stop-Process -Id $child.ProcessId -ErrorAction Stop
    Wait-Process -Id $child.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
  }
  & $installer -Mode Rollback -Patch $Patch -MaintenanceConfirmed;if($LASTEXITCODE -ne 0){throw 'Rollback failed'}
}
Launch 'RunGateway';Wait-Gateway;Launch 'RunBackend'
Remove-Item Env:SHAHVEX_GATEWAY_TOKEN
Write-Host 'Gateway authenticated with persisted token; backend launched with same DPAPI source and maintenance ON. Verify Next protected health before release.'
