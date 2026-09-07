# Split ops' mine payout after each successful mine (until first halving at height 210000).
# Of OPS registry share:
#   98% -> Aftermath farm rewards
#    1% -> Cetus main pool (10MM; with matching SUI in-range)
#    1% -> Cetus position (10MM-only while out of range; no SUI)
# Other registered wallets keep their on-chain mine share (e.g. ~3.333) as developer costs — not touched here.
param(
  [Parameter(Mandatory = $true)][double]$OpsAmount10mm,
  [Parameter(Mandatory = $false)][int]$Height = 0,
  [Parameter(Mandatory = $false)][string]$Digest = "",
  [Parameter(Mandatory = $false)][switch]$Execute
)
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# Prefer Desktop\10MinMine for node_modules (scripts may live in 10MinMine-laptop)
$RepoRoot = if ($env:REPO_DIR) { $env:REPO_DIR } else { Join-Path (Split-Path $here -Parent) "10MinMine" }
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  $alt = Join-Path $env:USERPROFILE "OneDrive\Desktop\10MinMine"
  if (Test-Path (Join-Path $alt "package.json")) { $RepoRoot = $alt }
}
function Invoke-RepoNode {
  param([Parameter(Mandatory=$true)][string]$ScriptRelative, [Parameter(ValueFromRemainingArguments=$true)]$Args)
  $scriptPath = Join-Path $RepoRoot $ScriptRelative
  if (-not (Test-Path $scriptPath)) { $scriptPath = Join-Path $here (Split-Path $ScriptRelative -Leaf) }
  if (-not (Test-Path $scriptPath)) { throw "Node script not found: $ScriptRelative" }
  Push-Location $RepoRoot
  try { & node $scriptPath @Args; return $LASTEXITCODE }
  finally { Pop-Location }
}
$HALVING_HEIGHT = 210000
$AF_FARM = "0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7"
$CETUS_MAIN_POOL = "0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2"
$CETUS_POSITION_ID = "0x885c09217753a405d987d0604ba4c78f4c34510576a478f803bf4ace91a10546"
$OPS = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a"
$LOG = Join-Path $here "allocate_log.txt"

if ($Height -ge $HALVING_HEIGHT) {
  Write-Host "height $Height reached first halving — allocate_mine_rewards stopping (update subsidy split for 25/block era)."
  exit 0
}

if ($OpsAmount10mm -le 0) {
  Write-Host "ops amount is 0 — nothing to allocate"
  exit 0
}

$farm = [math]::Round($OpsAmount10mm * 0.98, 8)
$cetusMain = [math]::Round($OpsAmount10mm * 0.01, 8)
$cetusPosition = [math]::Round($OpsAmount10mm * 0.01, 8)
# fix rounding residue onto farm
$sum = $farm + $cetusMain + $cetusPosition
$delta = [math]::Round($OpsAmount10mm - $sum, 8)
$farm = [math]::Round($farm + $delta, 8)

$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
$line = "$ts height=$Height digest=$Digest ops=$OpsAmount10mm farm98=$farm cetusMain1=$cetusMain cetusPosition1=$cetusPosition af=$AF_FARM cetusMainPool=$CETUS_MAIN_POOL cetusPositionId=$CETUS_POSITION_ID"
Add-Content -Path $LOG -Value $line -Encoding utf8
Write-Host $line
Write-Host ("plan: Aftermath deposit {0} 10MM | Cetus main add {1} 10MM with matching SUI (in-range) | second Cetus LP add {2} 10MM (no matching SUI)" -f $farm, $cetusMain, $cetusPosition)

if (-not $Execute) {
  Write-Host "dry-run only (pass -Execute to top up Aftermath and queue the other allocations)"
  exit 0
}

$topup = Join-Path $here "aftermath_topup.mjs"
if (-not (Test-Path $topup)) {
  Write-Error "Aftermath helper not found: $topup"
  exit 1
}

Write-Host ("Aftermath top-up starting: {0} 10MM (node cwd=$RepoRoot)" -f $farm)
$topupExit = Invoke-RepoNode "laptop\aftermath_topup.mjs" ([string]$farm) "--execute"
$topupStatus = if ($topupExit -eq 0) { "aftermath_executed" } else { "aftermath_pending" }
if ($topupExit -ne 0) {
  Write-Warning "Aftermath top-up failed or produced an unsigned artifact (exit code $topupExit); keeping it pending."
}

$pending = Join-Path $here "allocate_pending.json"
$entry = [pscustomobject]@{
  ts = $ts
  height = $Height
  digest = $Digest
  ops_amount_10mm = $OpsAmount10mm
  aftermath_10mm = $farm
  cetus_main_10mm = $cetusMain
  cetus_position_10mm = $cetusPosition
  aftermath_farm = $AF_FARM
  cetus_main_pool = $CETUS_MAIN_POOL
  cetus_main_mode = "tenmm_with_matching_sui_in_range"
  cetus_position_id = $CETUS_POSITION_ID
  cetus_position_mode = "tenmm_only_second_lp_no_sui"
  status = $topupStatus
  aftermath_exit_code = $topupExit
}
$list = @()
if (Test-Path $pending) {
  try {
    $raw = Get-Content -Raw $pending
    if ($raw) { $list = @($raw | ConvertFrom-Json) }
  } catch { $list = @() }
}
$list = @($list) + @($entry)
$list | ConvertTo-Json -Depth 6 | Set-Content -Path $pending -Encoding utf8
Write-Host ("queued -> " + $pending)
Write-Host ("Cetus LP allocation queued: main {0} 10MM with matching SUI; second LP {1} 10MM" -f $cetusMain, $cetusPosition)
if ($topupExit -ne 0) { exit $topupExit }
