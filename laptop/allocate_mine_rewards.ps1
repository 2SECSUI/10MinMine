# Split ops' mine payout after each successful mine (until first halving at height 210000).
#   98% -> Aftermath farm
#    1% -> existing Cetus main LP (TENMM + matching SUI)
#    1% -> existing second Cetus LP (TENMM-only)
param(
  [Parameter(Mandatory = $true)][double]$OpsAmount10mm,
  [Parameter(Mandatory = $false)][int]$Height = 0,
  [Parameter(Mandatory = $false)][string]$Digest = "",
  [Parameter(Mandatory = $false)][switch]$Execute
)
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = if ($env:REPO_DIR) { $env:REPO_DIR } else { Join-Path (Split-Path $here -Parent) "10MinMine" }
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  $alt = Join-Path $env:USERPROFILE "OneDrive\Desktop\10MinMine"
  if (Test-Path (Join-Path $alt "package.json")) { $RepoRoot = $alt }
}

$script:LastRepoNodeOutput = @()
function Invoke-RepoNode {
  param([Parameter(Mandatory=$true)][string]$ScriptRelative, [Parameter(ValueFromRemainingArguments=$true)]$Args)
  $scriptPath = Join-Path $RepoRoot $ScriptRelative
  if (-not (Test-Path $scriptPath)) { $scriptPath = Join-Path $here (Split-Path $ScriptRelative -Leaf) }
  if (-not (Test-Path $scriptPath)) { throw "Node script not found: $ScriptRelative" }
  $script:LastRepoNodeOutput = @()
  Push-Location $RepoRoot
  try {
    & node $scriptPath @Args 2>&1 | ForEach-Object {
      $line = [string]$_
      $script:LastRepoNodeOutput += $line
      Write-Host $line
    }
    $code = [int]$LASTEXITCODE
  } finally { Pop-Location }
  return $code
}
function Get-DigestFromOutput {
  $joined = $script:LastRepoNodeOutput -join "`n"
  $match = [regex]::Match($joined, '"digest"\s*:\s*"([A-Za-z0-9]+)"')
  if ($match.Success) { return $match.Groups[1].Value }
  return ""
}
function Get-StatusFromOutput {
  $joined = $script:LastRepoNodeOutput -join "`n"
  if ($joined -match '"mode"\s*:\s*"executed"') { return "executed" }
  if ($joined -match '"mode"\s*:\s*"dry-run"') { return "dry-run" }
  return "failed"
}

$HALVING_HEIGHT = 210000
$AF_FARM = "0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7"
$CETUS_MAIN_POOL = "0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2"
$CETUS_MAIN_POSITION_ID = "0x64477aaf7c88421b161315957ec71484174840d075742c979e85dd5fb05d43be"
$CETUS_SECOND_POSITION_ID = "0x885c09217753a405d987d0604ba4c78f4c34510576a478f803bf4ace91a10546"
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
$cetusSecond = [math]::Round($OpsAmount10mm * 0.01, 8)
$delta = [math]::Round($OpsAmount10mm - ($farm + $cetusMain + $cetusSecond), 8)
$farm = [math]::Round($farm + $delta, 8)
$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
$plan = "$ts height=$Height digest=$Digest ops=$OpsAmount10mm farm98=$farm cetusMain1=$cetusMain cetusSecond1=$cetusSecond af=$AF_FARM cetusPool=$CETUS_MAIN_POOL mainPosition=$CETUS_MAIN_POSITION_ID secondPosition=$CETUS_SECOND_POSITION_ID"
Add-Content -Path $LOG -Value $plan -Encoding utf8
Write-Host $plan
Write-Host ("plan: Aftermath {0} 10MM | main Cetus LP {1} 10MM + matching SUI | second Cetus LP {2} 10MM TENMM-only" -f $farm, $cetusMain, $cetusSecond)

if (-not $Execute) {
  Write-Host "dry-run only (pass -Execute to execute Aftermath and both existing-position Cetus adds)"
  exit 0
}

$topupExit = Invoke-RepoNode "laptop\aftermath_topup.mjs" ([string]$farm) "--execute"
$topupDigest = Get-DigestFromOutput
$topupStatus = if ($topupExit -eq 0) { Get-StatusFromOutput } else { "pending" }
if ($topupExit -ne 0) { Write-Warning "Aftermath top-up failed (exit $topupExit); keeping it pending." }

$mainExit = Invoke-RepoNode "laptop\cetus_lp_add.mjs" "--mode" "main" "--amount10mm" ([string]$cetusMain) "--execute"
$mainDigest = Get-DigestFromOutput
$mainStatus = if ($mainExit -eq 0) { Get-StatusFromOutput } else { "pending" }
if ($mainExit -ne 0) { Write-Warning "main Cetus LP add failed (exit $mainExit); keeping it pending." }

$secondExit = Invoke-RepoNode "laptop\cetus_lp_add.mjs" "--mode" "second" "--amount10mm" ([string]$cetusSecond) "--execute"
$secondDigest = Get-DigestFromOutput
$secondStatus = if ($secondExit -eq 0) { Get-StatusFromOutput } else { "pending" }
if ($secondExit -ne 0) { Write-Warning "second Cetus LP add failed (exit $secondExit); keeping it pending." }

$resultLine = "$ts height=$Height mineDigest=$Digest aftermath=$topupStatus aftermathDigest=$topupDigest mainCetus=$mainStatus mainDigest=$mainDigest secondCetus=$secondStatus secondDigest=$secondDigest"
Add-Content -Path $LOG -Value $resultLine -Encoding utf8
Write-Host $resultLine

$failed = @()
if ($topupExit -ne 0) { $failed += "aftermath" }
if ($mainExit -ne 0) { $failed += "cetus-main" }
if ($secondExit -ne 0) { $failed += "cetus-second" }
if ($failed.Count -eq 0) {
  Write-Host "allocation complete: Aftermath, main Cetus LP, and second Cetus LP all executed"
  exit 0
}

$pending = Join-Path $here "allocate_pending.json"
$entry = [pscustomobject]@{
  ts = $ts
  height = $Height
  digest = $Digest
  failed = $failed
  ops_amount_10mm = $OpsAmount10mm
  aftermath_10mm = $farm
  cetus_main_10mm = $cetusMain
  cetus_second_10mm = $cetusSecond
  aftermath_status = $topupStatus
  aftermath_digest = $topupDigest
  cetus_main_status = $mainStatus
  cetus_main_digest = $mainDigest
  cetus_second_status = $secondStatus
  cetus_second_digest = $secondDigest
  aftermath_farm = $AF_FARM
  cetus_main_pool = $CETUS_MAIN_POOL
  cetus_main_position_id = $CETUS_MAIN_POSITION_ID
  cetus_second_position_id = $CETUS_SECOND_POSITION_ID
}
$list = @()
if (Test-Path $pending) {
  try {
    $raw = Get-Content -Raw $pending
    if ($raw) { $list = @($raw | ConvertFrom-Json) }
  } catch { $list = @() }
}
$list = @($list) + @($entry)
$list | ConvertTo-Json -Depth 8 | Set-Content -Path $pending -Encoding utf8
Write-Warning ("allocation pending -> " + $pending + "; failed=" + ($failed -join ","))
exit 1
