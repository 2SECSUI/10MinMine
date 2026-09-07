# Split ops' mine payout after each successful mine (until first halving at height 210000).
#   98% -> Aftermath farm (TENMM only)
#    2% -> new out-of-range Cetus positions (TENMM only; SUI is gas only)
param(
  [Parameter(Mandatory = $true)][double]$OpsAmount10mm,
  [Parameter(Mandatory = $false)][int]$Height = 0,
  [Parameter(Mandatory = $false)][string]$Digest = "",
  [Parameter(Mandatory = $false)][switch]$Execute,
  [Parameter(Mandatory = $false)][double]$ReserveSui = 0.75
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
$OOR_SCRIPT = "laptop\cetus_oor_add.mjs"
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
$oor = [math]::Round($OpsAmount10mm * 0.02, 8)
$delta = [math]::Round($OpsAmount10mm - ($farm + $oor), 8)
$farm = [math]::Round($farm + $delta, 8)
$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
$plan = "$ts height=$Height digest=$Digest ops=$OpsAmount10mm farm98=$farm oor2=$oor gasReserveSui=$ReserveSui af=$AF_FARM"
Add-Content -Path $LOG -Value $plan -Encoding utf8
Write-Host $plan
Write-Host ("plan: Aftermath {0} 10MM | Cetus OOR {1} 10MM TENMM-only | SUI reserved for gas only ({2} SUI)" -f $farm, $oor, $ReserveSui)

if (-not $Execute) {
  Write-Host "dry-run only (pass -Execute to execute Aftermath top-up and the OOR TENMM-only add)"
  exit 0
}

$topupExit = Invoke-RepoNode "laptop\aftermath_topup.mjs" ([string]$farm) "--execute"
$topupDigest = Get-DigestFromOutput
$topupStatus = if ($topupExit -eq 0) { Get-StatusFromOutput } else { "pending" }
if ($topupExit -ne 0) { Write-Warning "Aftermath top-up failed (exit $topupExit); keeping it pending." }

$oorExit = Invoke-RepoNode $OOR_SCRIPT "--total-10mm" ([string]$oor) "--gas-reserve-sui" ([string]$ReserveSui) "--execute"
$oorDigest = Get-DigestFromOutput
$oorStatus = if ($oorExit -eq 0) { Get-StatusFromOutput } else { "pending" }
if ($oorExit -ne 0) { Write-Warning "Cetus OOR add failed (exit $oorExit); keeping it pending." }

$resultLine = "$ts height=$Height mineDigest=$Digest aftermath=$topupStatus aftermathDigest=$topupDigest oor=$oorStatus oorDigest=$oorDigest"
Add-Content -Path $LOG -Value $resultLine -Encoding utf8
Write-Host $resultLine

$failed = @()
if ($topupExit -ne 0) { $failed += "aftermath" }
if ($oorExit -ne 0) { $failed += "cetus-oor" }
if ($failed.Count -eq 0) {
  Write-Host "allocation complete: Aftermath top-up and TENMM-only Cetus OOR add executed"
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
  oor_10mm = $oor
  gas_reserve_sui = $ReserveSui
  aftermath_status = $topupStatus
  aftermath_digest = $topupDigest
  oor_status = $oorStatus
  oor_digest = $oorDigest
  aftermath_farm = $AF_FARM
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
