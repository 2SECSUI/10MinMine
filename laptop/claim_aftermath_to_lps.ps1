# Safely claim (optionally) and add only a small, live-price-sized amount to
# the existing Cetus positions. Defaults to dry-run; use -Execute to submit.
param(
  [switch]$Execute,
  [switch]$SkipClaim,
  [decimal]$MaxSui = 2,
  [decimal]$PerPositionSui = 1,
  [decimal]$ReserveSui = 4
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = if ($env:REPO_DIR) { $env:REPO_DIR } else { Split-Path $here -Parent }
$claimScript = Join-Path $RepoRoot "laptop\aftermath_claim_rewards.mjs"
$cetusScript = Join-Path $RepoRoot "laptop\cetus_lp_add.mjs"
if (-not $SkipClaim -and -not (Test-Path $claimScript)) { throw "Claim script not found: $claimScript" }
if (-not (Test-Path $cetusScript)) { throw "Cetus script not found: $cetusScript" }
if ($MaxSui -le 0 -or $PerPositionSui -le 0 -or $ReserveSui -lt 2) { throw "Require positive budgets and reserve-sui >= 2 (4 preferred)." }

function Invariant([decimal]$Value) { return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture) }
function Invoke-NodeJson {
  param([string]$Script, [string[]]$Arguments)
  $oldErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Push-Location $RepoRoot
  try {
    $lines = @(& node $Script @Arguments 2>&1 | ForEach-Object { $line = [string]$_; Write-Host $line; $line })
    $code = [int]$LASTEXITCODE
  } finally { Pop-Location; $ErrorActionPreference = $oldErrorAction }
  $json = $null
  $start = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*\{') { $start = $i; break } }
  if ($start -ge 0) {
    $payload = ($lines[$start..($lines.Count - 1)] -join "`n")
    try { $json = $payload | ConvertFrom-Json } catch {}
  }
  return [pscustomobject]@{ ExitCode = $code; Lines = $lines; Json = $json }
}

if (-not $SkipClaim) {
  $claimArgs = @()
  if ($Execute) { $claimArgs += "--execute" }
  $claim = Invoke-NodeJson $claimScript $claimArgs
  if ($claim.ExitCode -ne 0) { throw "Aftermath claim failed with exit code $($claim.ExitCode)" }
  if (-not $claim.Json) { throw "Aftermath claim did not return JSON" }
  Write-Host "Claim step completed; LP deployment remains capped and live-price-sized."
} else {
  Write-Host "SkipClaim set: no Aftermath claim will be built or submitted."
}

# Use at most MaxSui in this whole run, with a per-position hard ceiling.
$remaining = $MaxSui
$results = @()
foreach ($mode in @("main", "second")) {
  if ($remaining -le 0) { break }
  $budget = [Math]::Min($PerPositionSui, $remaining)
  $lpArgs = @(
    "--mode", $mode,
    "--sui-budget", (Invariant $budget),
    "--reserve-sui", (Invariant $ReserveSui)
  )
  if ($Execute) { $lpArgs += "--execute" } else { $lpArgs += "--plan-only" }
  $result = Invoke-NodeJson $cetusScript $lpArgs
  $results += $result
  if ($result.ExitCode -ne 0) { Write-Warning "$mode position LP add failed; no oversized fallback will be attempted." }
  else {
    $remaining -= $budget
    if ($result.Json) { Write-Host ("{0} LP plan: {1} TENMM, SUI max {2}" -f $mode, $result.Json.amount10mm, $result.Json.suiAmountMax) }
  }
}
if (($results | Where-Object { $_.ExitCode -eq 0 }).Count -eq 0) { throw "No safe LP add completed" }
if ($Execute) { Write-Host ("Safe claim-to-LP run complete; planned SUI cap was {0}, reserve was {1}." -f (Invariant $MaxSui), (Invariant $ReserveSui)) }
else { Write-Host ("Dry-run complete; no transaction submitted. Planned SUI cap was {0}, reserve was {1}." -f (Invariant $MaxSui), (Invariant $ReserveSui)) }
