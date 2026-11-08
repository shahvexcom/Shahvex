[CmdletBinding()]
param([Alias('Action')][ValidateSet('Arm','Issue','Check','Consume','Install')][string]$ProofAction='Check',[ValidateSet('TimingCapture','FirstAudio','VoiceFunctional','VoiceStreaming')][string]$ProofPatch='TimingCapture')
$ErrorActionPreference='Stop'
$script:proofStore=Join-Path $env:LOCALAPPDATA 'Shahvex\LocalServices'
$script:proofPath=Join-Path $env:USERPROFILE 'Documents\Shahvex-idle-health.json'
$script:requestPath=Join-Path $script:proofStore 'deployment-request.json'
$script:proofKey=Join-Path $script:proofStore 'idle-proof-key.dpapi.xml'
$script:proofSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Proof-Now {return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
function Proof-PackageHash([string]$Name){
  if($Name -eq 'VoiceStreaming'){return 'D0E1CF0F458E59C903538C4BC2EF960F2694845FA895A8F94FC7E1427F9D315A'}
  if($Name -eq 'VoiceFunctional'){return '49C9BF3029EC7BEF3BD00EF6F56129E9E281ADE40F0C3492109E12ED445AF96B'}
  if($Name -eq 'FirstAudio'){return '16EB3A564B2A3028DBFCB1D70696D95DE08F5D609835F6383A231483D3C57BAD'}
  if($Name -eq 'TimingCapture'){return '14493EA14F531014B616A7D3DE8030A8B05D8E14FF59C8413E4771BEF87D196B'}
  throw 'Unknown proof patch'
}
function Proof-ACL([string]$Path){
  $acl=Get-Acl -LiteralPath $Path
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($script:proofSid,'S-1-5-18','S-1-5-32-544')){throw 'Unexpected deployment-store ACL'}
  }
}
function Proof-Init {
  if(!(Test-Path -LiteralPath (Join-Path $script:proofStore 'gateway-token.dpapi.xml'))){throw 'Existing prepared store required; do not run Prepare again'}
  if(!(Get-Acl -LiteralPath $script:proofStore).AreAccessRulesProtected){throw 'Deployment store must have protected permissions'}
  Proof-ACL $script:proofStore
}
function Proof-Write([string]$Path,$Value){
  $temp=Join-Path $script:proofStore ([guid]::NewGuid().ToString('N')+'.tmp')
  [IO.File]::WriteAllText($temp,($Value | ConvertTo-Json -Depth 10 -Compress),[Text.UTF8Encoding]::new($false))
  # File carries the protected store's inherited ACL when moved into Documents.
  if(Test-Path -LiteralPath $Path){$old=Join-Path $script:proofStore ([guid]::NewGuid().ToString('N')+'.previous');[IO.File]::Replace($temp,$Path,$old);[IO.File]::Delete($old)}else{[IO.File]::Move($temp,$Path)}
  $acl=New-Object Security.AccessControl.FileSecurity;$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new($script:proofSid))
  foreach($sid in @($script:proofSid,'S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))}
  [IO.File]::SetAccessControl($Path,$acl)
}
function Proof-KeyBytes([bool]$Create=$false){
  if(!(Test-Path -LiteralPath $script:proofKey)){
    if(!$Create){throw 'Proof signing key not initialized'}
    $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($bytes);$secret=ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force;$secret | Export-Clixml -LiteralPath $script:proofKey;$secret.Dispose()}finally{$rng.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
  }
  Proof-ACL $script:proofKey
  $secure=Import-Clixml -LiteralPath $script:proofKey;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{return ,([Convert]::FromBase64String([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$secure.Dispose()}
}
function Proof-Sign([string]$Payload){
  $key=Proof-KeyBytes;$hmac=[Security.Cryptography.HMACSHA256]::new($key)
  try{return [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Payload)))}finally{$hmac.Dispose();[Array]::Clear($key,0,$key.Length)}
}
function Proof-Check {
  Proof-Init
  $envelope=Get-Content -LiteralPath $script:proofPath -Raw | ConvertFrom-Json
  $signature=Proof-Sign $envelope.payload
  $a=[Convert]::FromBase64String($signature);$b=[Convert]::FromBase64String($envelope.signature)
  if($a.Length -ne $b.Length){throw 'Invalid proof signature'}
  $diff=0;for($i=0;$i -lt $a.Length;$i++){$diff=$diff -bor ($a[$i] -bxor $b[$i])};if($diff){throw 'Forged or modified idle proof'}
  $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.payload)) | ConvertFrom-Json
  $now=Proof-Now
  if($p.version -ne 1 -or $p.audience -ne 'shahvex-timing-capture-v1' -or $p.ownerSid -ne $script:proofSid -or $p.target -ne 'C:\Shahvex-AI\integration-gateway' -or $p.patch -ne $ProofPatch -or $p.zipSHA256 -ne (Proof-PackageHash $ProofPatch)){throw 'Wrong deployment proof audience/package'}
  if($p.issuedAtMs -gt $now -or $now - $p.issuedAtMs -ge 60000 -or $p.expiresAtMs -ne $p.issuedAtMs+60000){throw 'Idle proof expired or clock invalid'}
  $request=Get-Content -LiteralPath $script:requestPath -Raw | ConvertFrom-Json
  if($request.nonce -ne $p.nonce -or $request.ownerSid -ne $script:proofSid -or $request.patch -ne $p.patch){throw 'Proof belongs to another approval'}
  if($p.authenticated -ne $true -or $p.gatewayStatus -ne 200 -or $p.ready -ne $true -or $p.maintenance -ne $true -or $p.activeSessions -ne 0 -or $p.queue.active -ne 0 -or $p.queue.pending -ne 0 -or $p.activeRelays -ne 0 -or $p.startingRelays -ne 0){throw 'Proof is not authenticated ready/drained maintenance'}
  return $p
}
function Invoke-IdleProof([string]$Operation){
  Proof-Init
  if($Operation -eq 'Arm'){
    $key=Proof-KeyBytes $true;[Array]::Clear($key,0,$key.Length)
    Proof-Write $script:requestPath @{nonce=[guid]::NewGuid().ToString('N');ownerSid=$script:proofSid;expiresAtMs=(Proof-Now)+180000;patch=$ProofPatch}
    return
  }
  if($Operation -eq 'Issue'){
    # Only the protected Next.js server passes this metadata on stdin. No token.
    $h=[Console]::In.ReadToEnd() | ConvertFrom-Json
    if($h.authenticated -ne $true -or $h.gatewayStatus -ne 200 -or $h.ready -ne $true -or $h.maintenance -ne $true -or $h.activeSessions -ne 0 -or $h.queue.active -ne 0 -or $h.queue.pending -ne 0 -or $h.activeRelays -ne 0 -or $h.startingRelays -ne 0){throw 'Gateway not authenticated and drained'}
    $request=Get-Content -LiteralPath $script:requestPath -Raw | ConvertFrom-Json
    if($request.ownerSid -ne $script:proofSid -or $request.expiresAtMs -lt (Proof-Now) -or $request.nonce -notmatch '^[a-f0-9]{32}$'){throw 'Run approved Deploy command before issuing a proof'}
    $pending=Join-Path $script:proofStore ($request.nonce+'.pending')
    $consumed=Join-Path $script:proofStore ($request.nonce+'.consumed')
    $installed=Join-Path $script:proofStore ($request.nonce+'.installed')
    if((Test-Path $pending) -or (Test-Path $consumed) -or (Test-Path $installed)){throw 'Proof already issued for this approval; restart Deploy to obtain a new approval'}
    $now=Proof-Now
    $p=@{version=1;audience='shahvex-timing-capture-v1';ownerSid=$script:proofSid;nonce=$request.nonce;issuedAtMs=$now;expiresAtMs=$now+60000;target='C:\Shahvex-AI\integration-gateway';patch=$request.patch;zipSHA256=(Proof-PackageHash $request.patch);authenticated=$true;gatewayStatus=200;ready=$true;maintenance=$true;activeSessions=0;queue=@{active=0;pending=0};activeRelays=0;startingRelays=0}
    $payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($p | ConvertTo-Json -Depth 5 -Compress)))
    $signature=Proof-Sign $payload
    $claim=[IO.File]::Open($pending,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$data=[Text.Encoding]::UTF8.GetBytes($signature);$claim.Write($data,0,$data.Length)}finally{$claim.Dispose()}
    Proof-Write $script:proofPath @{payload=$payload;signature=$signature}
    return @{issued=$true;issuedAtMs=$now;expiresAtMs=$now+60000;path=$script:proofPath}
  }
  $p=Proof-Check
  if($p.nonce -notmatch '^[a-f0-9]{32}$'){throw 'Invalid proof nonce'}
  $from=Join-Path $script:proofStore ($p.nonce+$(if($Operation -eq 'Install'){'.consumed'}else{'.pending'}))
  $envelope=Get-Content -LiteralPath $script:proofPath -Raw | ConvertFrom-Json
  if(!(Test-Path -LiteralPath $from) -or [IO.File]::ReadAllText($from) -cne $envelope.signature){throw 'Proof replayed, not issued or already consumed'}
  if($Operation -eq 'Consume'){[IO.File]::Move($from,(Join-Path $script:proofStore ($p.nonce+'.consumed')))}
  elseif($Operation -eq 'Install'){[IO.File]::Move($from,(Join-Path $script:proofStore ($p.nonce+'.installed')))}
  return $p
}
if($MyInvocation.InvocationName -ne '.'){
  try{$result=Invoke-IdleProof $ProofAction;if($ProofAction -eq 'Issue'){$result | ConvertTo-Json -Compress}}catch{[Console]::Error.WriteLine('Idle proof operation refused: '+$_.Exception.Message);exit 1}
}
