# Claim pending Aftermath TENMM rewards, then add the claimed TENMM to the
# existing Cetus positions. Defaults to dry-run; use -Execute to submit.
param([switch]$Execute)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = if ($env:REPO_DIR) { $env:REPO_DIR } else { Split-Path $here -Parent }
$claimScript = Join-Path $RepoRoot "laptop\aftermath_claim_rewards.mjs"
$cetusScript = Join-Path $RepoRoot "laptop\cetus_lp_add.mjs"
if (-not (Test-Path $claimScript)) { throw "Claim script not found: $claimScript" }
if (-not (Test-Path $cetusScript)) { throw "Cetus script not found: $cetusScript" }

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

$claimArgs = @()
if ($Execute) { $claimArgs += "--execute" }
$claim = Invoke-NodeJson $claimScript $claimArgs
if ($claim.ExitCode -ne 0) { throw "Aftermath claim failed with exit code $($claim.ExitCode)" }
if (-not $claim.Json) { throw "Aftermath claim did not return JSON" }
$claimedValue = $claim.Json.claimedRewardRaw
if ($null -eq $claimedValue -or [string]::IsNullOrWhiteSpace([string]$claimedValue)) { $claimedValue = $claim.Json.pendingRewardRaw }
if ($null -eq $claimedValue -or [string]::IsNullOrWhiteSpace([string]$claimedValue)) { $claimedValue = 0 }
$claimedRaw = [bigint]$claimedValue
if ($claimedRaw -le 0) {
  Write-Host "No claimable TENMM; no Cetus transaction was built or submitted."
  exit 0
}

# Split 50/50, assigning the odd smallest unit to main. Main uses the existing
# position and requests matching SUI; second is preferred as the no-SUI fallback when its range allows it.
$mainRaw = ($claimedRaw + 1) / 2
$secondRaw = $claimedRaw - $mainRaw
function Format-10mm([bigint]$raw) {
  $whole = $raw / [bigint]100000000
  $frac = ($raw % [bigint]100000000).ToString().PadLeft(8, "0").TrimEnd("0")
  if ($frac.Length -eq 0) { return "$whole" }
  return "$whole.$frac"
}
$mainAmount = Format-10mm $mainRaw
$secondAmount = Format-10mm $secondRaw
$lpArgsMain = @("--mode", "main", "--amount10mm", $mainAmount)
$lpArgsSecond = @("--mode", "second", "--amount10mm", $secondAmount)
if ($Execute) { $lpArgsMain += "--execute"; $lpArgsSecond += "--execute" } else { $lpArgsMain += "--plan-only"; $lpArgsSecond += "--plan-only" }

$displayValue = $claim.Json.claimedReward10mm
if ($null -eq $displayValue -or [string]::IsNullOrWhiteSpace([string]$displayValue)) { $displayValue = $claim.Json.pendingReward10mm }
Write-Host ("Claimed {0} TENMM; preferred Cetus split main={1}, second={2}" -f $displayValue, $mainAmount, $secondAmount)
$main = Invoke-NodeJson $cetusScript $lpArgsMain
if ($main.ExitCode -ne 0) {
  Write-Warning "Main position dry-run/submit failed (usually insufficient matching SUI); routing the full claim to the existing second position."
  $fallback = Format-10mm $claimedRaw
  $fallbackArgs = @("--mode", "second", "--amount10mm", $fallback)
  if ($Execute) { $fallbackArgs += "--execute" } else { $fallbackArgs += "--plan-only" }
  $second = Invoke-NodeJson $cetusScript $fallbackArgs
  if ($second.ExitCode -ne 0) { throw "Main and fallback second-position LP adds failed" }
  if ($Execute) { Write-Host "Claim-to-LP complete via second-position fallback." } else { Write-Host "Dry-run complete via second-position fallback plan; no transaction submitted." }
  exit 0
}
$second = Invoke-NodeJson $cetusScript $lpArgsSecond
if ($second.ExitCode -ne 0) { throw "Second-position LP add failed" }
if ($Execute) { Write-Host "Claim-to-LP complete: both existing Cetus positions updated." } else { Write-Host "Dry-run complete: claim PTB and both existing-position LP plans checked; no transaction submitted." }
