param([string]$Output='P:\shahvex\dist\tcp-metadata-schema-review.json')
$ErrorActionPreference='Stop'
$profilePath=Join-Path $PSScriptRoot 'Shahvex-TcpMetadata.wprp'
[xml]$profile=[IO.File]::ReadAllText($profilePath)
$ids=@($profile.WindowsPerformanceRecorder.Profiles.EventProvider.EventFilters.EventId | ForEach-Object {[int]$_.Value})
$provider=Get-WinEvent -ListProvider Microsoft-Windows-TCPIP
$review=@()
foreach($eventId in $ids){
  $versions=@($provider.Events | Where-Object {$_.Id -eq $eventId})
  if(!$versions.Count){throw "Missing allowlisted event $eventId"}
  foreach($e in $versions){
    [xml]$template=$e.Template
    foreach($field in @($template.template.data)){
      if($field.inType -match 'String' -or ($field.inType -eq 'win:Binary' -and $field.name -notin @('LocalAddress','RemoteAddress','LocalSockAddr','RemoteSockAddr'))){throw "Potential payload field: $eventId/$($e.Version) $($field.name)"}
    }
    $review+=@{id=$eventId;version=$e.Version;task=$e.Task.Name;template=$e.Template}
  }
}
@{captureStarted=$false;provider=$provider.Name;profileSha256=(Get-FileHash -LiteralPath $profilePath -Algorithm SHA256).Hash;events=$review} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Output -Encoding UTF8
Write-Host "Reviewed $($review.Count) event versions; no capture started."
