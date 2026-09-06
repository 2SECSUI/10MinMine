# Detect untracked v2 10MM wallets (watchlist + GraphQL coin owners) and register via protocol_transfer from ops.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$PACKAGE_ID = if ($env:PACKAGE_ID) { $env:PACKAGE_ID } else { "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98" }
$REWARD_POOL_ID = if ($env:REWARD_POOL_ID) { $env:REWARD_POOL_ID } else { "0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619" }
$HOLDER_REGISTRY_ID = if ($env:HOLDER_REGISTRY_ID) { $env:HOLDER_REGISTRY_ID } else { "0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9" }
$CLOCK_ID = if ($env:CLOCK_ID) { $env:CLOCK_ID } else { "0x6" }
$OPS_ADDR = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a"
$COIN_TYPE = "$PACKAGE_ID::tenmm::TENMM"
$REGISTER_10MM = if ($env:REGISTER_10MM) { [double]$env:REGISTER_10MM } else { 1.0 }
$GAS_BUDGET = if ($env:GAS_BUDGET) { $env:GAS_BUDGET } else { "20000000" }
$RPC = if ($env:SUI_RPC) { $env:SUI_RPC } else { "https://sui-mainnet-endpoint.blockvision.org" }
$GQL = if ($env:SUI_GQL) { $env:SUI_GQL } else { "https://graphql.mainnet.sui.io/graphql" }
$DRY = ($env:REGISTER_DRY_RUN -eq "1")

$EXCLUDE = @(
  $OPS_ADDR.ToLower(),
  "0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2",
  "0xaaf7498f5604f4e97f2350051caeb718a0963cd103b647d38435be1c22c886fc",
  "0x946f3fd959e8232cf50684f3f54750ba85b591581976bb6321746222de2b36d9",
  "0xf74d1c532f9a676fcacdf92e4d70ea2d850fa5adc51e625224eda09e7a795213",
  $REWARD_POOL_ID.ToLower(),
  $HOLDER_REGISTRY_ID.ToLower(),
  $PACKAGE_ID.ToLower()
) | ForEach-Object { $_.ToLower() }

function Normalize-Addr([string]$a) {
  $v = ($a -replace '\s','').ToLower()
  if (-not $v) { return "" }
  if (-not $v.StartsWith("0x")) { $v = "0x" + $v }
  $hex = $v.Substring(2)
  if ($hex.Length -gt 64) { return "" }
  return ("0x" + $hex.PadLeft(64, "0"))
}

function Invoke-Rpc($method, $params) {
  $body = @{ jsonrpc = "2.0"; id = 1; method = $method; params = $params } | ConvertTo-Json -Depth 12 -Compress
  $resp = Invoke-RestMethod -Uri $RPC -Method Post -ContentType "application/json" -Body $body -TimeoutSec 40
  if ($resp.error) { throw ($resp.error | ConvertTo-Json -Compress) }
  return $resp.result
}

function Get-RegistryState {
  $obj = Invoke-Rpc "sui_getObject" @($HOLDER_REGISTRY_ID, @{ showContent = $true })
  $fields = $obj.data.content.fields
  $addrs = @()
  if ($fields.addresses) { $addrs = @($fields.addresses | ForEach-Object { Normalize-Addr $_ }) }
  $tableId = $null
  try { $tableId = $fields.holders.fields.id.id } catch {}
  $principals = @{}
  foreach ($a in $addrs) {
    try {
      $dyn = Invoke-Rpc "suix_getDynamicFieldObject" @($tableId, @{ type = "address"; value = $a })
      $val = $dyn.data.content.fields.value.fields
      $principals[$a] = [int64]$val.principal
    } catch {
      $principals[$a] = 0
    }
  }
  return @{
    addresses = $addrs
    principals = $principals
    total = [int64]$fields.total_principal
    tableId = $tableId
  }
}

function Get-Watchlist {
  $path = Join-Path $here "register_watchlist.txt"
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line.Split(",")
    $addr = Normalize-Addr $parts[0]
    if (-not $addr) { return }
    $amt = $REGISTER_10MM
    if ($parts.Length -gt 1 -and $parts[1].Trim()) {
      try { $amt = [double]$parts[1].Trim() } catch {}
    }
    $map[$addr] = $amt
  }
  return $map
}

function Get-GraphqlOwners {
  $owners = @{}
  $type = "0x2::coin::Coin<$COIN_TYPE>"
  $after = $null
  $q = @'
query($t: String!, $after: String) {
  objects(first: 50, after: $after, filter: { type: $t }) {
    nodes {
      owner {
        __typename
        ... on AddressOwner { address { address } }
      }
      asMoveObject { contents { json } }
    }
    pageInfo { hasNextPage endCursor }
  }
}
'@
  for ($i = 0; $i -lt 20; $i++) {
    $payload = @{ query = $q; variables = @{ t = $type; after = $after } } | ConvertTo-Json -Depth 8 -Compress
    try {
      $res = Invoke-RestMethod -Uri $GQL -Method Post -ContentType "application/json" -Body $payload -TimeoutSec 40
    } catch {
      Write-Host ("graphql scan failed: " + $_)
      break
    }
    if ($res.errors) { Write-Host ("graphql errors: " + ($res.errors | ConvertTo-Json -Compress)); break }
    foreach ($n in $res.data.objects.nodes) {
      $bal = 0
      try { $bal = [int64]$n.asMoveObject.contents.json.balance } catch {}
      if ($bal -le 0) { continue }
      if ($n.owner.__typename -ne "AddressOwner") { continue }
      $a = Normalize-Addr $n.owner.address.address
      if (-not $a) { continue }
      if (-not $owners.ContainsKey($a)) { $owners[$a] = 0 }
      $owners[$a] = [int64]$owners[$a] + $bal
    }
    if (-not $res.data.objects.pageInfo.hasNextPage) { break }
    $after = $res.data.objects.pageInfo.endCursor
  }
  return $owners
}

function Get-V2CoinId([int64]$needRaw) {
  $coins = Invoke-Rpc "suix_getCoins" @($OPS_ADDR, $COIN_TYPE, $null, 50)
  $best = $null
  foreach ($c in $coins.data) {
    $b = [int64]$c.balance
    if ($b -ge $needRaw) {
      if ($null -eq $best -or $b -lt [int64]$best.balance) { $best = $c }
    }
  }
  if ($null -eq $best) { throw "No v2 10MM coin large enough for $needRaw (check ops wallet)." }
  return $best.coinObjectId
}

function Register-Address([string]$addr, [double]$amount10) {
  $raw = [int64]([math]::Round($amount10 * 100000000))
  if ($raw -le 0) { throw "amount must be > 0" }
  $coinId = Get-V2CoinId $raw
  Write-Host ("protocol_transfer $amount10 10MM -> $addr from coin $coinId")
  if ($DRY) { Write-Host "DRY RUN - skipped"; return $null }
  $out = & sui client ptb `
    --split-coins "@$coinId" "[$raw]" `
    --assign payment `
    --move-call "${PACKAGE_ID}::tenmm::protocol_transfer" "@$REWARD_POOL_ID" "@$HOLDER_REGISTRY_ID" payment.0 "@$addr" "@$CLOCK_ID" `
    --gas-budget $GAS_BUDGET 2>&1 | Out-String
  Write-Host $out
  $m = [regex]::Match($out, "Transaction Digest:\s*([A-Za-z0-9]+)")
  if (-not $m.Success) { throw "protocol_transfer failed for $addr" }
  return $m.Groups[1].Value
}

if (-not (Get-Command sui -ErrorAction SilentlyContinue)) {
  Write-Error "sui CLI not found"
  exit 1
}

$reg = Get-RegistryState
Write-Host ("registry holders=" + $reg.addresses.Count + " total_principal=" + ($reg.total / 100000000.0))

$watch = Get-Watchlist
$gqlOwners = Get-GraphqlOwners
$candidates = @{}
foreach ($k in $watch.Keys) { $candidates[$k] = $watch[$k] }
foreach ($k in $gqlOwners.Keys) {
  if (-not $candidates.ContainsKey($k)) { $candidates[$k] = $REGISTER_10MM }
}

$registered = 0
foreach ($addr in $candidates.Keys) {
  if ($EXCLUDE -contains $addr.ToLower()) { continue }
  if ($reg.addresses -contains $addr) {
    Write-Host ("already registered: " + $addr.Substring(0,10) + "… principal=" + (($reg.principals[$addr]) / 100000000.0))
    continue
  }
  # Prefer wallets that already hold some v2 10MM (DEX/plain send), but still honor watchlist even if balance read fails.
  $bal = 0
  try {
    $b = Invoke-Rpc "suix_getBalance" @($addr, $COIN_TYPE)
    $bal = [int64]$b.totalBalance
  } catch {}
  $fromWatch = $watch.ContainsKey($addr)
  if (-not $fromWatch -and $bal -le 0) { continue }
  $amt = [double]$candidates[$addr]
  if (($reg.principals[$OPS_ADDR] -as [int64]) -lt [int64]($amt * 100000000)) {
    # fall back to ops total principal from registry
    $opsP = 0
    if ($reg.principals.ContainsKey($OPS_ADDR)) { $opsP = [int64]$reg.principals[$OPS_ADDR] }
    elseif ($reg.principals.ContainsKey($OPS_ADDR.ToLower())) { $opsP = [int64]$reg.principals[$OPS_ADDR.ToLower()] }
    else {
      foreach ($k in $reg.principals.Keys) { if ((Normalize-Addr $k) -eq $OPS_ADDR) { $opsP = [int64]$reg.principals[$k] } }
    }
    if ($opsP -lt [int64]($amt * 100000000)) {
      Write-Host ("skip $addr - ops tracked principal too low for $amt")
      continue
    }
  }
  try {
    $dig = Register-Address $addr $amt
    Write-Host ("registered $addr digest=$dig")
    $registered++
    # refresh registry after each success
    $reg = Get-RegistryState
  } catch {
    Write-Host ("register failed for ${addr}: $_")
  }
}

Write-Host ("done. newly_registered=$registered holders_now=" + $reg.addresses.Count)
