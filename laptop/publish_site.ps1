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

function Normalize-Addr([string]$a) {
  $v = ($a -replace '\s','').ToLower()
  if (-not $v) { return "" }
  if (-not $v.StartsWith("0x")) { $v = "0x" + $v }
  $hex = $v.Substring(2)
  if ($hex.Length -gt 64) { return "" }
  return ("0x" + $hex.PadLeft(64, "0"))
}

function Get-RewardSplit([double]$totalAmount, [string]$digest) {
  $coinType = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM"
  $rpc = if ($env:SUI_RPC) { $env:SUI_RPC } else { "https://sui-mainnet-endpoint.blockvision.org" }
  $rows = @()

  # 1) Prefer on-chain balanceChanges from the mine digest (exact payouts)
  if ($digest) {
    try {
      $body = @{ jsonrpc = "2.0"; id = 1; method = "sui_getTransactionBlock"; params = @($digest, @{ showBalanceChanges = $true; showEffects = $true }) } | ConvertTo-Json -Depth 8 -Compress
      $resp = Invoke-RestMethod -Uri $rpc -Method Post -ContentType "application/json" -Body $body -TimeoutSec 40
      $changes = @($resp.result.balanceChanges)
      foreach ($c in $changes) {
        if ($c.coinType -ne $coinType) { continue }
        $amtRaw = [int64]$c.amount
        if ($amtRaw -le 0) { continue }
        $owner = $null
        if ($c.owner.AddressOwner) { $owner = Normalize-Addr ([string]$c.owner.AddressOwner) }
        elseif ($c.owner -is [string]) { $owner = Normalize-Addr $c.owner }
        if (-not $owner) { continue }
        $rows += [pscustomobject]@{ address = $owner; amount_10mm = ([string]([math]::Round($amtRaw / 100000000.0, 8))) }
      }
    } catch {
      Write-Host ("balanceChanges lookup failed: " + $_)
    }
  }

  # 2) Fallback: split by registry principal shares
  if (-not $rows.Count) {
    try {
      $body = @{ jsonrpc = "2.0"; id = 1; method = "sui_getObject"; params = @("0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9", @{ showContent = $true }) } | ConvertTo-Json -Depth 8 -Compress
      $resp = Invoke-RestMethod -Uri $rpc -Method Post -ContentType "application/json" -Body $body -TimeoutSec 40
      $fields = $resp.result.data.content.fields
      $addrs = @($fields.addresses)
      $totalP = [int64]$fields.total_principal
      $tableId = $fields.holders.fields.id.id
      if ($totalP -gt 0 -and $addrs.Count -gt 0) {
        $rawTotal = [int64]([math]::Round($totalAmount * 100000000))
        $allocated = [int64]0
        for ($i = 0; $i -lt $addrs.Count; $i++) {
          $a = Normalize-Addr ([string]$addrs[$i])
          $dynBody = @{ jsonrpc = "2.0"; id = 1; method = "suix_getDynamicFieldObject"; params = @($tableId, @{ type = "address"; value = $a }) } | ConvertTo-Json -Depth 8 -Compress
          $dyn = Invoke-RestMethod -Uri $rpc -Method Post -ContentType "application/json" -Body $dynBody -TimeoutSec 40
          $prin = [int64]$dyn.result.data.content.fields.value.fields.principal
          if ($i -eq ($addrs.Count - 1)) {
            $shareRaw = $rawTotal - $allocated
          } else {
            $shareRaw = [int64](($rawTotal * $prin) / $totalP)
            $allocated += $shareRaw
          }
          if ($shareRaw -le 0) { continue }
          $rows += [pscustomobject]@{ address = $a; amount_10mm = ([string]([math]::Round($shareRaw / 100000000.0, 8))); principal_10mm = ([string]([math]::Round($prin / 100000000.0, 8))) }
        }
      }
    } catch {
      Write-Host ("registry split failed: " + $_)
    }
  }

  if (-not $rows.Count) {
    $rows = @([pscustomobject]@{ address = $OPS_ADDR; amount_10mm = ([string]$totalAmount) })
  }
  return $rows
}

if (-not $exists) {
  $rewarded = @(Get-RewardSplit -totalAmount ([double]$Amount) -digest $Digest)
  $note = if ($rewarded.Count -gt 1) {
    "Split across " + $rewarded.Count + " registered holders by principal"
  } else {
    "50 10MM per block"
  }
  $entry = [pscustomobject]@{
    ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.ffffffzzz")
    height = $Height
    blocks = $Blocks
    minted_raw = ([string]([int64]([double]$Amount * 100000000)))
    amount_10mm = ([string]$Amount)
    event = "mainnet_mine"
    digest = $Digest
    rewarded = $rewarded
    note = $note
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
  holders = $(try { $rpcH = if ($env:SUI_RPC) { $env:SUI_RPC } else { "https://sui-mainnet-endpoint.blockvision.org" }; $bh = @{ jsonrpc = "2.0"; id = 1; method = "sui_getObject"; params = @("0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9", @{ showContent = $true }) } | ConvertTo-Json -Depth 8 -Compress; $rh = Invoke-RestMethod -Uri $rpcH -Method Post -ContentType "application/json" -Body $bh -TimeoutSec 20; $nh = @($rh.result.data.content.fields.addresses).Count; if ($nh -gt 0) { "$nh registered" } else { "Hold-to-earn registry live" } } catch { "Hold-to-earn registry live" })
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
