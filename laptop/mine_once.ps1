# One-shot 10MM mainnet mine + local txt log + GitHub site update
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$PACKAGE_ID = if ($env:PACKAGE_ID) { $env:PACKAGE_ID } else { "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98" }
$REWARD_POOL_ID = if ($env:REWARD_POOL_ID) { $env:REWARD_POOL_ID } else { "0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619" }
$HOLDER_REGISTRY_ID = if ($env:HOLDER_REGISTRY_ID) { $env:HOLDER_REGISTRY_ID } else { "0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9" }
$FEE_POT_ID = if ($env:FEE_POT_ID) { $env:FEE_POT_ID } else { "0xf74d1c532f9a676fcacdf92e4d70ea2d850fa5adc51e625224eda09e7a795213" }
$CLOCK_ID = if ($env:CLOCK_ID) { $env:CLOCK_ID } else { "0x6" }
$GAS_BUDGET = if ($env:GAS_BUDGET) { $env:GAS_BUDGET } else { "10000000" }
$OPS_ADDR = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a"
$TXT_LOG = Join-Path $here "mine_log.txt"
$REPO_DIR = if ($env:REPO_DIR) { $env:REPO_DIR } else { Join-Path (Split-Path $here -Parent) "10MinMine" }
if (-not (Test-Path (Join-Path $REPO_DIR ".git"))) {
  $alt = Join-Path $env:USERPROFILE "OneDrive\Desktop\10MinMine"
  if (Test-Path (Join-Path $alt ".git")) { $REPO_DIR = $alt }
}

if (-not (Get-Command sui -ErrorAction SilentlyContinue)) {
  Write-Error "sui CLI not found in PATH. Install Sui CLI 1.79+, then reopen PowerShell."
}
$envName = (sui client active-env 2>$null | Out-String).Trim()
$addr = (sui client active-address 2>$null | Out-String).Trim()
Write-Host ("env=" + $envName + " address=" + $addr)
if ($envName -notmatch "mainnet") {
  Write-Error "Switch to mainnet first:  sui client switch --env mainnet"
}

# height before
$tmpBefore = [System.IO.Path]::GetTempFileName()
sui client object $REWARD_POOL_ID --json | Out-File -FilePath $tmpBefore -Encoding ascii
$rawBefore = Get-Content -Path $tmpBefore -Raw
$heightBefore = "0"
$mB = [regex]::Match($rawBefore, "block_height\D+(\d+)")
if ($mB.Success) { $heightBefore = $mB.Groups[1].Value }
Remove-Item -LiteralPath $tmpBefore -ErrorAction SilentlyContinue

# Auto-register untracked holders (watchlist + coin owners) before mining so they share this block
$regScript = Join-Path $here "register_untracked.ps1"
if (Test-Path $regScript) {
  Write-Host "register_untracked: scanning / registering ..."
  try { & $regScript } catch { Write-Host ("register_untracked warning: " + $_) }
}

Write-Host "calling tenmm::mine ..."
$out = & sui client call --package $PACKAGE_ID --module tenmm --function mine --args $REWARD_POOL_ID $HOLDER_REGISTRY_ID $FEE_POT_ID $CLOCK_ID --gas-budget $GAS_BUDGET 2>&1 | Out-String
Write-Host $out

$digest = ""
$mD = [regex]::Match($out, "Transaction Digest:\s*([A-Za-z0-9]+)")
if (-not $mD.Success) { $mD = [regex]::Match($out, "Digest:\s*([A-Za-z0-9]+)") }
if ($mD.Success) { $digest = $mD.Groups[1].Value }

$tmpAfter = [System.IO.Path]::GetTempFileName()
sui client object $REWARD_POOL_ID --json | Out-File -FilePath $tmpAfter -Encoding ascii
$rawAfter = Get-Content -Path $tmpAfter -Raw
$heightAfter = $heightBefore
$mA = [regex]::Match($rawAfter, "block_height\D+(\d+)")
if ($mA.Success) { $heightAfter = $mA.Groups[1].Value }
Remove-Item -LiteralPath $tmpAfter -ErrorAction SilentlyContinue

$blocks = [Math]::Max(1, ([int]$heightAfter - [int]$heightBefore))
$amount = $blocks * 50
$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
$line = "$ts  height=$heightAfter  blocks=$blocks  amount=${amount}10MM  digest=$digest"
Add-Content -Path $TXT_LOG -Value $line -Encoding utf8
Write-Host ("logged -> " + $TXT_LOG)
Write-Host $line


# Split ops mine share: 98% Aftermath / 1% Cetus main LP / 1% Cetus position (other wallets keep their registry payout as dev)
$alloc = Join-Path $here "allocate_mine_rewards.ps1"
if (Test-Path $alloc) {
  try {
    # Prefer parsing TENMM credit to ops from the mine digest when available; fallback = full block amount to ops if sole/majority
    $opsAmt = [double]$amount
    if ($digest) {
      try {
        $tmpTx = [System.IO.Path]::GetTempFileName()
        sui client tx-block $digest --json 2>$null | Out-File -FilePath $tmpTx -Encoding utf8
        $txRaw = Get-Content -Raw $tmpTx
        Remove-Item -LiteralPath $tmpTx -ErrorAction SilentlyContinue
        $coinType = "$PACKAGE_ID::tenmm::TENMM"
        # crude extract: look for ops address near positive amount — PowerShell JSON is safer when available
        $j = $txRaw | ConvertFrom-Json
        foreach ($b in @($j.balanceChanges)) {
          if ($b.coinType -ne $coinType) { continue }
          $owner = [string]$b.owner.AddressOwner
          if ($owner -and $owner.ToLower().Contains($OPS_ADDR.Substring(2).ToLower())) {
            $amt = [int64]$b.amount
            if ($amt -gt 0) { $opsAmt = [math]::Round($amt / 100000000.0, 8) }
          }
        }
      } catch {
        Write-Host ("allocate: could not parse ops credit from digest, using amount=$amount")
      }
    }
    & $alloc -OpsAmount10mm $opsAmt -Height ([int]$heightAfter) -Digest $digest -Execute
  } catch {
    Write-Host ("allocate_mine_rewards warning: " + $_)
  }
}

# GitHub site update
$publish = Join-Path $here "publish_site.ps1"
if (Test-Path $publish) {
  & $publish -Height ([int]$heightAfter) -Blocks $blocks -Amount $amount -Digest $digest
} else {
  Write-Warning "publish_site.ps1 missing - skipped GitHub update"
}
