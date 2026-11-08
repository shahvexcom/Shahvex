param([ValidateSet('VoiceFunctional','VoiceStreaming')][string]$Patch='VoiceFunctional')
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$root=Join-Path $repo ('dist\functional-fixture-'+[guid]::NewGuid().ToString('N'))
$installer=Join-Path $repo 'deployment\Install-TimingCapture.ps1'
$zip=Join-Path $repo 'dist\Shahvex-Voice-Functional-Review-v1.zip'
function Refuses([scriptblock]$Run){$failed=$false;try{& $Run | Out-Null}catch{$failed=$true};if(!$failed){throw 'Expected validation rejection'}}
try{
  foreach($file in @('Manage-ShahvexLocal.ps1','Install-TimingCapture.ps1','IdleProof.ps1')){
    $parseErrors=$null;$tokens=$null
    [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo "deployment\$file"),[ref]$tokens,[ref]$parseErrors) | Out-Null
    if($parseErrors.Count){throw "PowerShell syntax failed: $file"}
  }
  if($Patch -eq 'VoiceFunctional'){Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $root 'stage')}
  foreach($component in @('Gateway','Chatterbox')){
    $target=Join-Path $root $component
    New-Item -ItemType Directory -Path $target | Out-Null
    $physical=if($component -eq 'Gateway'){'C:\Shahvex-AI\integration-gateway'}else{'C:\Shahvex-AI\chatterbox-testing'}
    $names=@(if($component -eq 'Gateway'){if($Patch -eq 'VoiceStreaming'){'core.cjs';'phrase-stream.cjs';'telemetry.cjs'};'audio-stream.cjs';'services.cjs'}else{'chatterbox_voice_server.py'})
    $prefix=if($component -eq 'Gateway'){'gateway'}else{'optional-chatterbox'}
    if($Patch -eq 'VoiceStreaming'){
      $release=Get-Content (Join-Path $repo 'dist\Shahvex-Voice-Streaming-Release-v1.json') -Raw | ConvertFrom-Json
      Expand-Archive -LiteralPath (Join-Path $repo ('dist\'+$release.$component.file)) -DestinationPath (Join-Path $root 'stage') -Force
      if($component -eq 'Gateway'){node -e "require(process.argv[1])" (Join-Path $root 'stage\gateway\core.cjs');if($LASTEXITCODE -ne 0){throw 'Packaged core/helper import failed'}}
    }
    foreach($name in $names){if(Test-Path (Join-Path $physical $name)){Copy-Item -LiteralPath (Join-Path $physical $name) -Destination (Join-Path $target $name)}}
    & $installer -Mode Validate -Patch $Patch -Component $component -Target $target
    & $installer -Mode Backup -Patch $Patch -Component $component -Target $target -MaintenanceConfirmed
    [IO.File]::WriteAllText((Join-Path $target $names[0]),'tampered fixture')
    Refuses {& $installer -Mode Validate -Patch $Patch -Component $component -Target $target}
    foreach($name in $names){Copy-Item -LiteralPath (Join-Path (Join-Path $root "stage\$prefix") $name) -Destination (Join-Path $target $name) -Force}
    # Fixture-only mock. All mutations target the workspace directory above.
    function Get-NetTCPConnection {param($State,$ErrorAction) return @()}
    if($Patch -eq 'VoiceStreaming' -and $component -eq 'Gateway'){
      [IO.File]::WriteAllText((Join-Path $target 'phrase-stream.cjs'),'unexpected changed helper')
      Refuses {& $installer -Mode Rollback -Patch $Patch -Component $component -Target $target -MaintenanceConfirmed}
      Copy-Item -LiteralPath (Join-Path $root 'stage\gateway\phrase-stream.cjs') -Destination (Join-Path $target 'phrase-stream.cjs') -Force
    }
    & $installer -Mode Rollback -Patch $Patch -Component $component -Target $target -MaintenanceConfirmed
    foreach($name in $names){if(Test-Path (Join-Path $physical $name)){if((Get-FileHash (Join-Path $physical $name)).Hash -ne (Get-FileHash (Join-Path $target $name)).Hash){throw 'Fixture rollback hash failed'}}elseif(Test-Path (Join-Path $target $name)){throw 'New helper not removed during rollback'}}
  }
  $badZip=Join-Path $root 'bad.zip';[IO.File]::WriteAllText($badZip,'not the approved archive')
  Refuses {& $installer -Mode Validate -Patch $Patch -Zip $badZip}
  Write-Output 'PASS: PowerShell syntax; exact package/components; original mismatch rejection; separate backups and verified rollbacks; corrupt ZIP rejection. Workspace fixtures only; no services/credentials changed.'
}finally{
  $resolved=[IO.Path]::GetFullPath($root)
  if(!$resolved.StartsWith((Join-Path $repo 'dist\functional-fixture-'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected cleanup target'}
  if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
