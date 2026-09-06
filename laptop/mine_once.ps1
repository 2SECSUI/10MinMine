# One-shot 10MM mainnet mine (Windows PowerShell + Sui CLI)
$ErrorActionPreference = "Stop"
$PACKAGE_ID = if ($env:PACKAGE_ID) { $env:PACKAGE_ID } else { "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98" }
$REWARD_POOL_ID = if ($env:REWARD_POOL_ID) { $env:REWARD_POOL_ID } else { "0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619" }
$HOLDER_REGISTRY_ID = if ($env:HOLDER_REGISTRY_ID) { $env:HOLDER_REGISTRY_ID } else { "0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9" }
$FEE_POT_ID = if ($env:FEE_POT_ID) { $env:FEE_POT_ID } else { "0xf74d1c532f9a676fcacdf92e4d70ea2d850fa5adc51e625224eda09e7a795213" }
$CLOCK_ID = if ($env:CLOCK_ID) { $env:CLOCK_ID } else { "0x6" }
$GAS_BUDGET = if ($env:GAS_BUDGET) { $env:GAS_BUDGET } else { "10000000" }
$OPS_ADDR = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a"

if (-not (Get-Command sui -ErrorAction SilentlyContinue)) {
  Write-Error "sui CLI not found in PATH. Install Sui CLI, then reopen PowerShell."
}
$envName = (sui client active-env 2>$null | Out-String).Trim()
$addr = (sui client active-address 2>$null | Out-String).Trim()
Write-Host "env=$envName address=$addr"
if ($envName -notmatch "mainnet") {
  Write-Error "Switch to mainnet first:  sui client switch --env mainnet"
}
if ($addr -ne $OPS_ADDR) {
  Write-Warning "Active address is not ops wallet. Same wallet is fine if it is $OPS_ADDR"
}

Write-Host "calling tenmm::mine ..."
sui client call `
  --package $PACKAGE_ID `
  --module tenmm `
  --function mine `
  --args $REWARD_POOL_ID $HOLDER_REGISTRY_ID $FEE_POT_ID $CLOCK_ID `
  --gas-budget $GAS_BUDGET
