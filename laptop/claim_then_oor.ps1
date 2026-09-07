# Claim Aftermath TENMM rewards, then place only that TENMM in new OOR Cetus positions.
# SUI is never supplied to the LP; it is reserved only for transaction gas. This path never invokes cetus_lp_add (in-range matching is disabled).
[CmdletBinding()]
param(
  [switch]$Execute,
  [switch]$SkipClaim,
  [decimal]$Total10mm = 0,
  [decimal]$GasReserveSui = 0.75
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = if ($env:REPO_DIR) { $env:REPO_DIR } else { Split-Path $here -Parent }
$claimScript = Join-Path $RepoRoot "laptop\aftermath_claim_rewards.mjs"
$oorScript = Join-Path $RepoRoot "laptop\cetus_oor_add.mjs"
if (-not $SkipClaim -and -not (Test-Path $claimScript)) { throw "Claim script not found: $claimScript" }
if (-not (Test-Path $oorScript)) { throw "OOR script not found: $oorScript" }
if ($GasReserveSui -le 0) { throw "GasReserveSui must be positive" }
if ($SkipClaim -and $Total10mm -le 0) { throw "SkipClaim requires -Total10mm; refusing to sweep an unspecified wallet balance" }

function Invariant([decimal]$Value) { return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture) }
function Invoke-NodeJson {
  param([string]$Script, [string[]]$Arguments)
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Push-Location $RepoRoot
  try {
    $lines = @(& node $Script @Arguments 2>&1 | ForEach-Object { $line = [string]$_; Write-Host $line; $line })
    $code = [int]$LASTEXITCODE
  } finally { Pop-Location; $ErrorActionPreference = $old }
  $json = $null
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*\{') {
      try { $json = (($lines[$i..($lines.Count - 1)] -join "`n") | ConvertFrom-Json) } catch {}
      break
    }
  }
  [pscustomobject]@{ ExitCode = $code; Json = $json }
}

$amount = $Total10mm
if (-not $SkipClaim) {
  $claimArgs = @()
  if ($Execute) { $claimArgs += "--execute" }
  $claim = Invoke-NodeJson $claimScript $claimArgs
  if ($claim.ExitCode -ne 0) { throw "Aftermath claim failed with exit code $($claim.ExitCode)" }
  if (-not $claim.Json) { throw "Aftermath claim did not return JSON" }
  if ($amount -le 0 -and $claim.Json.claimedReward10mm) { $amount = [decimal]$claim.Json.claimedReward10mm }
  if ($amount -le 0 -and $claim.Json.pendingReward10mm) { $amount = [decimal]$claim.Json.pendingReward10mm }
} else {
  Write-Host "SkipClaim set: using the explicitly supplied -Total10mm only."
}

if ($amount -le 0) {
  Write-Host "No positive TENMM claim amount; no OOR transaction was built or submitted."
  exit 0
}
$oorArgs = @("--total-10mm", (Invariant $amount), "--gas-reserve-sui", (Invariant $GasReserveSui))
if ($Execute) { $oorArgs += "--execute" } else { $oorArgs += "--plan-only" }
$oor = Invoke-NodeJson $oorScript $oorArgs
if ($oor.ExitCode -ne 0) { throw "Cetus OOR add failed with exit code $($oor.ExitCode)" }
if ($Execute) { Write-Host ("Claim-then-OOR complete: {0} TENMM allocated; SUI reserve is gas-only ({1} SUI)." -f (Invariant $amount), (Invariant $GasReserveSui)) }
else { Write-Host ("Dry-run complete: {0} TENMM planned for OOR; no transaction submitted." -f (Invariant $amount)) }
