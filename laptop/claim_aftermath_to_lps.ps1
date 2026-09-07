# Backward-compatible entrypoint. It delegates only to claim_then_oor.ps1 and never invokes cetus_lp_add. Despite the historical filename, this now
# claims Aftermath rewards and sends TENMM to out-of-range Cetus positions only.
[CmdletBinding()]
param(
  [switch]$Execute,
  [switch]$SkipClaim,
  [decimal]$Total10mm = 0,
  [decimal]$GasReserveSui = 0.75
)
$target = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "claim_then_oor.ps1"
& $target @PSBoundParameters
exit $LASTEXITCODE
