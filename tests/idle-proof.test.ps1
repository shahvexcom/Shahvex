$ErrorActionPreference='Stop'
$base=Join-Path (Get-Location) 'dist'
$root=Join-Path $base ('proof-tests-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $root | Out-Null
try{
  . (Join-Path (Get-Location) 'deployment\IdleProof.ps1')
  $script:proofStore=$root;$script:requestPath=Join-Path $root 'request.json';$script:proofKey=Join-Path $root 'fixture-key.xml';$script:proofPath=Join-Path $root 'proof.json'
  $acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  foreach($sid in @($script:proofSid,'S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
  Set-Acl -LiteralPath $root -AclObject $acl
  [IO.File]::WriteAllText((Join-Path $root 'gateway-token.dpapi.xml'),'fixture placeholder, never an actual Gateway token')
  function Refuses([scriptblock]$Run){$failed=$false;try{& $Run | Out-Null}catch{$failed=$true};if(!$failed){throw 'Expected proof rejection'}}
  $snapshot=@{authenticated=$true;gatewayStatus=200;ready=$true;maintenance=$true;activeSessions=0;queue=@{active=0;pending=0};activeRelays=0;startingRelays=0} | ConvertTo-Json -Depth 5 -Compress
  Invoke-IdleProof 'Arm'
  $prior=[Console]::In;[Console]::SetIn([IO.StringReader]::new($snapshot));try{$issued=Invoke-IdleProof 'Issue'}finally{[Console]::SetIn($prior)}
  if(!$issued.issued){throw 'Proof not issued'}
  Invoke-IdleProof 'Check' | Out-Null
  $original=[IO.File]::ReadAllText($script:proofPath)
  $envelope=$original | ConvertFrom-Json;$envelope.signature=[Convert]::ToBase64String((New-Object byte[] 32));[IO.File]::WriteAllText($script:proofPath,($envelope | ConvertTo-Json));Refuses {Invoke-IdleProof 'Check'}
  [IO.File]::WriteAllText($script:proofPath,$original)
  Invoke-IdleProof 'Consume' | Out-Null;Refuses {Invoke-IdleProof 'Consume'}
  Invoke-IdleProof 'Install' | Out-Null;Refuses {Invoke-IdleProof 'Install'}
  Invoke-IdleProof 'Arm';Refuses {Invoke-IdleProof 'Check'}
  $prior=[Console]::In;[Console]::SetIn([IO.StringReader]::new($snapshot));try{Invoke-IdleProof 'Issue' | Out-Null}finally{[Console]::SetIn($prior)}
  $e=Get-Content $script:proofPath -Raw | ConvertFrom-Json;$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($e.payload)) | ConvertFrom-Json
  $p.issuedAtMs=(Proof-Now)-61000;$p.expiresAtMs=$p.issuedAtMs+60000
  $payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($p | ConvertTo-Json -Depth 5 -Compress)));Proof-Write $script:proofPath @{payload=$payload;signature=(Proof-Sign $payload)};Refuses {Invoke-IdleProof 'Check'}
  $ProofPatch='FirstAudio';Invoke-IdleProof 'Arm'
  $prior=[Console]::In;[Console]::SetIn([IO.StringReader]::new($snapshot));try{Invoke-IdleProof 'Issue' | Out-Null}finally{[Console]::SetIn($prior)}
  Invoke-IdleProof 'Check' | Out-Null
  $ProofPatch='TimingCapture';Refuses {Invoke-IdleProof 'Check'}
  $ProofPatch='FirstAudio';Invoke-IdleProof 'Consume' | Out-Null;Invoke-IdleProof 'Install' | Out-Null
  if((Proof-PackageHash 'VoiceFunctional') -ne (Get-FileHash (Join-Path $base 'Shahvex-Voice-Functional-Review-v1.zip')).Hash){throw 'VoiceFunctional proof is not bound to the actual ZIP'}
  $ProofPatch='VoiceFunctional';Invoke-IdleProof 'Arm'
  $prior=[Console]::In;[Console]::SetIn([IO.StringReader]::new($snapshot));try{Invoke-IdleProof 'Issue' | Out-Null}finally{[Console]::SetIn($prior)}
  Invoke-IdleProof 'Check' | Out-Null
  $ProofPatch='FirstAudio';Refuses {Invoke-IdleProof 'Check'}
  $ProofPatch='VoiceFunctional';Invoke-IdleProof 'Consume' | Out-Null;Invoke-IdleProof 'Install' | Out-Null;Refuses {Invoke-IdleProof 'Install'}
  if((Proof-PackageHash 'VoiceStreaming') -ne (Get-FileHash (Join-Path $base 'Shahvex-Voice-Streaming-Release-v1.json')).Hash){throw 'Streaming proof is not bound to release manifest'}
  $ProofPatch='VoiceStreaming';Invoke-IdleProof 'Arm'
  $prior=[Console]::In;[Console]::SetIn([IO.StringReader]::new($snapshot));try{Invoke-IdleProof 'Issue' | Out-Null}finally{[Console]::SetIn($prior)}
  Invoke-IdleProof 'Check' | Out-Null
  $ProofPatch='VoiceFunctional';Refuses {Invoke-IdleProof 'Check'}
  $ProofPatch='VoiceStreaming';Invoke-IdleProof 'Consume' | Out-Null;Invoke-IdleProof 'Install' | Out-Null;Refuses {Invoke-IdleProof 'Install'}
  Write-Output 'PASS: signed issuance, forgery/replay/expiry rejection, package binding for all four patches and single-use install. No real credentials/services touched.'
}finally{
  $resolved=[IO.Path]::GetFullPath($root)
  if($resolved -notlike (([IO.Path]::GetFullPath($base))+'\proof-tests-*')){throw 'Unexpected fixture cleanup target'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
