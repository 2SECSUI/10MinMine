# Mine only if >= 600s since last on-chain block, then log + GitHub publish
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$REWARD_POOL_ID = if ($env:REWARD_POOL_ID) { $env:REWARD_POOL_ID } else { "0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619" }
$BLOCK_SECS = if ($env:BLOCK_SECS) { [int]$env:BLOCK_SECS } else { 600 }

if (-not (Get-Command sui -ErrorAction SilentlyContinue)) {
  Write-Error "sui CLI not found in PATH"
}

$tmp = [System.IO.Path]::GetTempFileName()
try {
  sui client object $REWARD_POOL_ID --json | Out-File -FilePath $tmp -Encoding ascii
  $raw = Get-Content -Path $tmp -Raw
  $height = "0"
  $ts = "0"
  $m1 = [regex]::Match($raw, "block_height\D+(\d+)")
  if ($m1.Success) { $height = $m1.Groups[1].Value }
  $m2 = [regex]::Match($raw, "last_block_ts\D+(\d+)")
  if ($m2.Success) { $ts = $m2.Groups[1].Value }
  $ts_i = [int64]$ts
  if ($ts_i -gt 1000000000000) { $ts_i = [int64]($ts_i / 1000) }
  $now = [int64](([DateTimeOffset](Get-Date)).ToUnixTimeSeconds())
  $elapsed = [Math]::Max(0, $now - $ts_i)
  Write-Host ("height=" + $height + " last_ts=" + $ts_i + " elapsed=" + $elapsed + "s (need >= " + $BLOCK_SECS + ")")
  if ($elapsed -lt $BLOCK_SECS) {
    $remain = $BLOCK_SECS - $elapsed
    Write-Host ("no block owed - wait ~" + $remain + "s")
    exit 0
  }
}
finally {
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
}

& (Join-Path $here "mine_once.ps1")
