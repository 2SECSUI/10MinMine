# Update mine-log.json + mine-status.json and push to GitHub Pages repo
param(
  [Parameter(Mandatory = $true)][int]$Height,
  [Parameter(Mandatory = $true)][int]$Blocks,
  [Parameter(Mandatory = $true)][string]$Amount,
  [Parameter(Mandatory = $false)][string]$Digest = ""
)
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$OPS_ADDR = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a"
$REPO_DIR = if ($env:REPO_DIR) { $env:REPO_DIR } else { Join-Path (Split-Path $here -Parent) "10MinMine" }
if (-not (Test-Path (Join-Path $REPO_DIR ".git"))) {
  $alt = Join-Path $env:USERPROFILE "OneDrive\Desktop\10MinMine"
  if (Test-Path (Join-Path $alt ".git")) { $REPO_DIR = $alt }
}
if (-not (Test-Path (Join-Path $REPO_DIR ".git"))) {
  Write-Host "ERROR: Repo not found. Run setup_repo.ps1 first."
  exit 1
}

$dataDir = Join-Path $REPO_DIR "site\data"
$pubDir = Join-Path $REPO_DIR "site\public"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $pubDir | Out-Null
$logPath = Join-Path $dataDir "mine-log.json"
$statusPath = Join-Path $dataDir "mine-status.json"

$log = @()
if (Test-Path $logPath) {
  $raw = Get-Content -Raw -Path $logPath
  if ($raw -and $raw.Trim().Length -gt 0) {
    $parsed = $raw | ConvertFrom-Json
    if ($null -ne $parsed) {
      if ($parsed -is [System.Array]) { $log = $parsed } else { $log = @($parsed) }
    }
  }
}

$exists = $false
if ($Digest) {
  foreach ($e in $log) {
    if ($e.digest -eq $Digest) { $exists = $true; break }
  }
}

if (-not $exists) {
  $entry = [pscustomobject]@{
    ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.ffffffzzz")
    height = $Height
    blocks = $Blocks
    minted_raw = ([string]([int64]([double]$Amount * 100000000)))
    amount_10mm = ([string]$Amount)
    event = "mainnet_mine"
    digest = $Digest
    rewarded = @([pscustomobject]@{ address = $OPS_ADDR; amount_10mm = ([string]$Amount) })
    note = "50 10MM per block"
  }
  $log = @($log) + @($entry)
}

$total = 0.0
foreach ($e in $log) {
  try { $total += [double]$e.amount_10mm } catch {}
}
$totalS = if ([math]::Abs($total - [math]::Round($total)) -lt 0.0000001) { ([int][math]::Round($total)).ToString() } else { $total.ToString() }

$status = [pscustomobject]@{
  network = "mainnet"
  packageId = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98"
  rewardPoolId = "0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619"
  height = $Height
  block_height = $Height
  lastBlockHeight = $Height
  total_minted_10mm = $totalS
  current_subsidy_10mm = "50"
  block_reward_note = "50 10MM / block (then halvings)"
  holders = "Hold-to-earn registry live"
  price_note = "Trade on Cetus 10MM/SUI"
  fee_pot_note = "0.01 SUI tip / mine when funded"
  hold_slot_note = "Rewards each ~10m block - see countdown"
  lastMineDigest = $Digest
  poolUrl = "https://app.cetus.zone/position-detail/0x64477aaf7c88421b161315957ec71484174840d075742c979e85dd5fb05d43be"
  updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  launchAt = "2026-09-06T16:44:56Z"
  last_block_ts = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  next_block_ts = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 600)
}

$log | ConvertTo-Json -Depth 8 | Set-Content -Path $logPath -Encoding utf8
$status | ConvertTo-Json -Depth 8 | Set-Content -Path $statusPath -Encoding utf8
Copy-Item -Force $logPath (Join-Path $pubDir "mine-log.json")
Copy-Item -Force $statusPath (Join-Path $pubDir "mine-status.json")
Write-Host ("wrote site json height=" + $Height + " total=" + $totalS)

Push-Location $REPO_DIR
try {
  git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Write-Host $_ }
  git add -- site/data/mine-status.json site/data/mine-log.json site/public/mine-status.json site/public/mine-log.json
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "github: nothing to commit"
  } else {
    $msg = "mint log: height $Height $Digest"
    git -c user.name="10MinMine Ops" -c user.email="ops@10minmine.local" commit -m $msg 2>&1 | Out-Host
    git push origin HEAD 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ERROR: git push failed - sign in to GitHub if needed"
      exit 1
    }
    Write-Host ("github: pushed site at height " + $Height)
  }
}
finally {
  Pop-Location
}
