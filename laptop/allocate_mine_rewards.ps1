# Split ops' mine payout after each successful mine (until first halving at height 210000).
# Of OPS registry share:
#   75% -> Aftermath farm rewards
#   20% -> Cetus LP 10MM-only until in range (then with SUI)
#    5% -> Turbos pool
# Other registered wallets keep their on-chain mine share (e.g. ~3.333) as developer costs — not touched here.
param(
  [Parameter(Mandatory = $true)][double]$OpsAmount10mm,
  [Parameter(Mandatory = $false)][int]$Height = 0,
  [Parameter(Mandatory = $false)][string]$Digest = "",
  [Parameter(Mandatory = $false)][switch]$Execute
)
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$HALVING_HEIGHT = 210000
$AF_FARM = "0x89a692f70e2b831d1d6a1ec299f571ba2032c94df4fe8ed8dde2ef9b711df035"
$CETUS_POOL = "0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2"
$TURBOS_POOL = "0xaaf7498f5604f4e97f2350051caeb718a0963cd103b647d38435be1c22c886fc"
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

$farm = [math]::Round($OpsAmount10mm * 0.75, 8)
$cetus = [math]::Round($OpsAmount10mm * 0.20, 8)
$turbos = [math]::Round($OpsAmount10mm * 0.05, 8)
# fix rounding residue onto farm
$sum = $farm + $cetus + $turbos
$delta = [math]::Round($OpsAmount10mm - $sum, 8)
$farm = [math]::Round($farm + $delta, 8)

$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
$line = "$ts height=$Height digest=$Digest ops=$OpsAmount10mm farm75=$farm cetus20=$cetus turbos5=$turbos af=$AF_FARM cetusPool=$CETUS_POOL turbosPool=$TURBOS_POOL"
Add-Content -Path $LOG -Value $line -Encoding utf8
Write-Host $line
Write-Host ("plan: Aftermath deposit {0} 10MM | Cetus add {1} 10MM (no SUI until in-range) | Turbos add {2} 10MM" -f $farm, $cetus, $turbos)

if (-not $Execute) {
  Write-Host "dry-run only (pass -Execute to attempt on-chain sends when helpers exist)"
  exit 0
}

# Placeholders: full Aftermath/Cetus/Turbos PTBs need SDK package IDs that change.
# Until helpers land, amounts are logged and can be funded from Owner Settings / LP UI.
$pending = Join-Path $here "allocate_pending.json"
$entry = [pscustomobject]@{
  ts = $ts
  height = $Height
  digest = $Digest
  ops_amount_10mm = $OpsAmount10mm
  aftermath_10mm = $farm
  cetus_10mm = $cetus
  turbos_10mm = $turbos
  aftermath_farm = $AF_FARM
  cetus_pool = $CETUS_POOL
  turbos_pool = $TURBOS_POOL
  cetus_mode = "tenmm_only_until_in_range"
  status = "pending"
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
Write-Host "TODO: aftermath deposit + cetus/turbos LP helpers (amounts queued)"
