# Task Scheduler entrypoint: Aftermath claim -> TENMM-only Cetus OOR.
# No in-range LP matching and no SUI LP budget; SUI is gas only.
[CmdletBinding()]
param(
  [switch]$Execute,
  [switch]$SkipClaim,
  [decimal]$Total10mm = 0,
  [decimal]$GasReserveSui = 4
)
$target = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\claim_then_oor.ps1"
& (Resolve-Path $target).Path @PSBoundParameters
exit $LASTEXITCODE
