[CmdletBinding()]
param(
  [ValidateSet('Validate','Backup','Install','Rollback')][string]$Mode='Validate',
  [ValidateSet('TimingCapture','FirstAudio','VoiceFunctional','VoiceStreaming')][string]$Patch='TimingCapture',
  [ValidateSet('Gateway','Chatterbox')][string]$Component='Gateway',
  [string]$Zip,
  [string]$Target='C:\Shahvex-AI\integration-gateway',
  [string]$Backup,
  [string]$IdleHealthFile,
  [switch]$MaintenanceConfirmed
)
$ErrorActionPreference='Stop'
if($Component -eq 'Chatterbox' -and $Patch -notin @('VoiceFunctional','VoiceStreaming')){throw 'Chatterbox requires a reviewed voice package'}
if($Component -eq 'Chatterbox' -and !$PSBoundParameters.ContainsKey('Target')){$Target='C:\Shahvex-AI\chatterbox-testing'}
$expected='14493EA14F531014B616A7D3DE8030A8B05D8E14FF59C8413E4771BEF87D196B'
if(!$Zip){$Zip=if($Patch -eq 'FirstAudio'){'P:\shahvex\dist\Shahvex-First-Audio-Review-v1.zip'}else{'P:\shahvex\dist\Shahvex-Timing-Capture-Review-v1.zip'}}
if(!$Backup){$Backup=Join-Path $Target $(if($Patch -eq 'FirstAudio'){'backup-before-first-audio-v1'}else{'backup-before-timing-20261102-200114'})}
if($Patch -eq 'FirstAudio'){$expected='16EB3A564B2A3028DBFCB1D70696D95DE08F5D609835F6383A231483D3C57BAD'}
if($Patch -eq 'VoiceFunctional'){
  $expected='49C9BF3029EC7BEF3BD00EF6F56129E9E281ADE40F0C3492109E12ED445AF96B'
  if(!$PSBoundParameters.ContainsKey('Zip')){$Zip='P:\shahvex\dist\Shahvex-Voice-Functional-Review-v1.zip'}
  if(!$PSBoundParameters.ContainsKey('Backup')){$Backup=Join-Path $Target 'backup-before-voice-functional-v1'}
}
if($Patch -eq 'VoiceStreaming'){
  $releaseFile='P:\shahvex\dist\Shahvex-Voice-Streaming-Release-v1.json'
  if((Get-FileHash -LiteralPath $releaseFile).Hash -ne 'D0E1CF0F458E59C903538C4BC2EF960F2694845FA895A8F94FC7E1427F9D315A'){throw 'Release manifest hash mismatch'}
  $release=Get-Content -LiteralPath $releaseFile -Raw | ConvertFrom-Json
  $expected=$release.$Component.sha256
  if(!$PSBoundParameters.ContainsKey('Zip')){$Zip=Join-Path 'P:\shahvex\dist' $release.$Component.file}
  if(!$PSBoundParameters.ContainsKey('Backup')){$Backup=Join-Path $Target 'backup-before-voice-streaming-v1'}
}
if((Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash -ne $expected){throw 'ZIP SHA256 mismatch'}
$names=@('core.cjs','audio-stream.cjs','services.cjs','text-chunks.cjs','server.cjs','telemetry.cjs')
$allowed=@($names | ForEach-Object {'gateway/'+$_})+@('optional-chatterbox/chatterbox_voice_server.py','SHA256SUMS.json','REVIEW.md')
if($Patch -eq 'FirstAudio'){$names=@('services.cjs','text-chunks.cjs');$allowed=@($names)+@('SHA256SUMS.json','REVIEW.md')}
if($Patch -eq 'VoiceFunctional'){
  $names=if($Component -eq 'Gateway'){@('audio-stream.cjs','services.cjs')}else{@('chatterbox_voice_server.py')}
  $allowed=@('gateway/audio-stream.cjs','gateway/services.cjs','optional-chatterbox/chatterbox_voice_server.py','DEPENDENCIES.json','SHA256SUMS.json','REVIEW.md')
}
if($Patch -eq 'VoiceStreaming'){
  $names=@(if($Component -eq 'Gateway'){'core.cjs';'audio-stream.cjs';'services.cjs';'phrase-stream.cjs';'telemetry.cjs'}else{'chatterbox_voice_server.py'})
  $prefix=if($Component -eq 'Gateway'){'gateway/'}else{'optional-chatterbox/'}
  $allowed=@($names | ForEach-Object {$prefix+$_})+@('DEPENDENCIES.json','SHA256SUMS.json','REVIEW.md')
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($Zip)
try{
  $actual=@($archive.Entries | ForEach-Object {$_.FullName})
  if($actual.Count -ne $allowed.Count -or @(Compare-Object $allowed $actual).Count){throw 'Unexpected ZIP entries'}
  $reader=[IO.StreamReader]::new($archive.GetEntry('SHA256SUMS.json').Open())
  try{$manifest=$reader.ReadToEnd() | ConvertFrom-Json}finally{$reader.Dispose()}
}finally{$archive.Dispose()}
$stage=Join-Path $env:TEMP ('shahvex-reviewed-'+[guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $Zip -DestinationPath $stage
$entries=@($manifest | Where-Object {($Patch -eq 'TimingCapture' -and $_.path -like 'gateway/*') -or ($Patch -eq 'FirstAudio' -and $_.path -in $names)})
if($Patch -in @('VoiceFunctional','VoiceStreaming')){
  $prefix=if($Component -eq 'Gateway'){'gateway/'}else{'optional-chatterbox/'}
  $entries=@($manifest | Where-Object {$_.path -like ($prefix+'*')})
  $dependency=Get-Content (Join-Path $stage 'DEPENDENCIES.json') -Raw | ConvertFrom-Json
  if((Get-FileHash -LiteralPath 'C:\Shahvex-AI\integration-gateway\text-chunks.cjs').Hash -ne $dependency.firstAudioTextChunksSHA256){throw 'FirstAudio helper changed; stop for review'}
}
if($entries.Count -ne $names.Count){throw 'Unexpected Gateway replacement count'}
foreach($entry in $manifest){if((Get-FileHash -LiteralPath (Join-Path $stage $entry.path)).Hash -ne $entry.sha256){throw "Patch file hash mismatch: $($entry.path)"}}
foreach($entry in $entries){
  $name=Split-Path $entry.path -Leaf
  if($name -notin $names){throw 'Unexpected Gateway file'}
  $backupFile=Join-Path $Backup $name
  if($entry.originalSHA256){
    if(Test-Path -LiteralPath $backupFile){if((Get-FileHash -LiteralPath $backupFile).Hash -ne $entry.originalSHA256){throw "Backup original mismatch: $name"}}
    elseif($Patch -notin @('FirstAudio','VoiceFunctional','VoiceStreaming') -or $Mode -in @('Install','Rollback')){throw "Verified backup missing: $name"}
  }
  if($Component -eq 'Chatterbox'){
    & 'C:\Shahvex-AI\chatterbox-testing\.venv\Scripts\python.exe' -B -c "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())" (Join-Path $stage $entry.path)
  }else{node --check (Join-Path $stage $entry.path)}
  if($LASTEXITCODE -ne 0){throw "Replacement syntax error: $name"}
  if($Mode -ne 'Rollback'){
    $dest=Join-Path $Target $name
    if($entry.originalSHA256){if((Get-FileHash -LiteralPath $dest).Hash -ne $entry.originalSHA256){throw "Deployed original changed: $name"}}
    elseif(Test-Path -LiteralPath $dest){throw "New helper already exists: $name"}
  }elseif(!$entry.originalSHA256){
    $dest=Join-Path $Target $name
    if((Test-Path -LiteralPath $dest) -and (Get-FileHash -LiteralPath $dest).Hash -ne $entry.sha256){throw 'New helper changed; refusing rollback deletion'}
  }
}
Write-Host "PASS: $Patch ZIP, payload hashes, exact replacement paths and available backup originals verified."
if($Mode -eq 'Validate'){Write-Host 'Read-only validation complete. No physical files or services changed.';return}
if(-not $MaintenanceConfirmed){throw 'Explicit maintenance confirmation required'}
if($Mode -eq 'Backup'){
  if($Patch -notin @('FirstAudio','VoiceFunctional','VoiceStreaming')){throw 'Timing Capture already uses its verified existing backup'}
  New-Item -ItemType Directory -Force -Path $Backup | Out-Null
  foreach($entry in $entries){if(!$entry.originalSHA256){continue};$name=Split-Path $entry.path -Leaf;$dest=Join-Path $Backup $name;if(!(Test-Path -LiteralPath $dest)){Copy-Item -LiteralPath (Join-Path $Target $name) -Destination $dest};if((Get-FileHash -LiteralPath $dest).Hash -ne $entry.originalSHA256){throw 'New backup verification failed'}}
  $originalCount=@($entries | Where-Object {$_.originalSHA256}).Count
  Write-Host "PASS: $originalCount $Component originals backed up and verified at $Backup; $($entries.Count) affected paths. Services unchanged."
  return
}
$port=if($Component -eq 'Gateway'){8787}else{8765}
if(@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -eq $port}).Count){throw "$Component still listening; stop only its verified process before install/rollback"}
if($Mode -eq 'Install'){
  if(-not $IdleHealthFile){throw 'Authenticated idle health evidence required'}
  . (Join-Path $PSScriptRoot 'IdleProof.ps1') -ProofPatch $Patch
  if([IO.Path]::GetFullPath($IdleHealthFile) -ne [IO.Path]::GetFullPath($script:proofPath)){throw 'Proof must use the fixed server-side path'}
  Invoke-IdleProof 'Install' | Out-Null
  foreach($entry in $entries){$name=Split-Path $entry.path -Leaf;Copy-Item -LiteralPath (Join-Path $stage $entry.path) -Destination (Join-Path $Target $name) -Force}
  foreach($entry in $entries){if((Get-FileHash -LiteralPath (Join-Path $Target (Split-Path $entry.path -Leaf))).Hash -ne $entry.sha256){throw 'Post-install hash failed; rollback before starting Gateway'}}
  Write-Host "PASS: Exactly $($entries.Count) $Component files installed and post-install hashes verified. No services started."
}else{
  foreach($entry in $entries){if($entry.originalSHA256){$name=Split-Path $entry.path -Leaf;Copy-Item -LiteralPath (Join-Path $Backup $name) -Destination (Join-Path $Target $name) -Force}}
  foreach($entry in $entries){if(!$entry.originalSHA256){$dest=Join-Path $Target (Split-Path $entry.path -Leaf);if(Test-Path -LiteralPath $dest){Remove-Item -LiteralPath $dest -ErrorAction Stop}}}
  foreach($entry in $entries){if($entry.originalSHA256 -and (Get-FileHash -LiteralPath (Join-Path $Target (Split-Path $entry.path -Leaf))).Hash -ne $entry.originalSHA256){throw 'Rollback hash failed'}}
  Write-Host 'PASS: Selected patch originals restored and verified. No services started.'
}
