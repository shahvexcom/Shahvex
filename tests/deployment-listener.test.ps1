$ErrorActionPreference='Stop'
$file=Join-Path (Get-Location) 'deployment\Manage-ShahvexLocal.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Controller parse failed'}
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Listener'},$true)
Invoke-Expression $definition.Extent.Text
function Fake-Listener([string]$Address,[int]$Port){
  $instance=[Microsoft.Management.Infrastructure.CimInstance]::new('MSFT_NetTCPConnection')
  $instance.CimInstanceProperties.Add([Microsoft.Management.Infrastructure.CimProperty]::Create('LocalAddress',$Address,[Microsoft.Management.Infrastructure.CimType]::String,[Microsoft.Management.Infrastructure.CimFlags]::Property))
  $instance.CimInstanceProperties.Add([Microsoft.Management.Infrastructure.CimProperty]::Create('LocalPort',[uint16]$Port,[Microsoft.Management.Infrastructure.CimType]::UInt16,[Microsoft.Management.Infrastructure.CimFlags]::Property))
  $instance.CimInstanceProperties.Add([Microsoft.Management.Infrastructure.CimProperty]::Create('OwningProcess',[uint32]12345,[Microsoft.Management.Infrastructure.CimType]::UInt32,[Microsoft.Management.Infrastructure.CimFlags]::Property))
  return $instance
}
function Get-NetTCPConnection {param($State,$ErrorAction) return $script:fixtures}
$script:fixtures=@(Fake-Listener '127.0.0.1' 8787)
$scalar=Listener 8787
if($null -ne $scalar.Count){throw 'Fixture did not reproduce scalar CIM Count bug'}
$boxed=@(Listener 8787)
if($boxed.Count -ne 1 -or $boxed[0].LocalAddress -ne '127.0.0.1' -or $boxed[0].OwningProcess -ne 12345){throw 'Single loopback listener not preserved'}
$script:fixtures=@();if(@(Listener 8787).Count -ne 0){throw 'Empty result count failed'}
$script:fixtures=@((Fake-Listener '127.0.0.1' 8787),(Fake-Listener '0.0.0.0' 8787));if(@(Listener 8787).Count -ne 2){throw 'Duplicate listeners hidden'}
$script:fixtures=@(Fake-Listener '0.0.0.0' 8787);$boxed=@(Listener 8787);if($boxed.Count -eq 1 -and $boxed[0].LocalAddress -eq '127.0.0.1'){throw 'Wildcard incorrectly accepted'}
$script:fixtures=@(Fake-Listener '127.0.0.1' 3000);if(@(Listener 8787).Count -ne 0){throw 'Other port incorrectly selected'}
# Inspect actual call sites, not a separate reimplementation of the controller.
$assignments=$ast.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Right.Extent.Text -match '^\s*Listener\s|^\s*@\(Listener\s'},$true)
if($assignments.Count -lt 4){throw 'Listener call sites not found'}
foreach($assignment in $assignments){if($assignment.Right.Extent.Text -notmatch '^\s*@\(Listener\s'){throw 'Controller leaves scalar listener unboxed'}}
if((Get-Content -LiteralPath $file -Raw) -match '(?<!@)\(Listener\s+[^)]+\)\.Count'){throw 'Unboxed inline Count remains'}
Write-Output 'PASS: reproduced scalar CIM null Count; zero/one/multiple/wildcard/other-port cases; controller array collection. No live services or credentials accessed.'
