# Mine only if >= 600s since last on-chain block
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$REWARD_POOL_ID = if ($env:REWARD_POOL_ID) { $env:REWARD_POOL_ID } else { "0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619" }
$BLOCK_SECS = if ($env:BLOCK_SECS) { [int]$env:BLOCK_SECS } else { 600 }

if (-not (Get-Command sui -ErrorAction SilentlyContinue)) {
  Write-Error "sui CLI not found in PATH"
}
$tmp = New-TemporaryFile
try {
  sui client object $REWARD_POOL_ID --json | Out-File -Encoding utf8 $tmp
  $raw = Get-Content -Raw $tmp
  $height = "0"; $ts = "0"
  if ($raw -match '"block_height"\s*:\s*"?(\d+)"?') { $height = $Matches[1] }
  if ($raw -match '"last_block_ts"\s*:\s*"?(\d+)"?') { $ts = $Matches[1] }
  $ts_i = [int64]$ts
  if ($ts_i -gt 1000000000000) { $ts_i = [int64]($ts_i / 1000) }
  $now = [int64](Get-Date -UFormat %s)
  $elapsed = [Math]::Max(0, $now - $ts_i)
  Write-Host "height=$height last_ts=$ts_i elapsed=${elapsed}s (need >= $BLOCK_SECS)"
  if ($elapsed -lt $BLOCK_SECS) {
    $remain = $BLOCK_SECS - $elapsed
    Write-Host "no block owed — wait ~${remain}s"
    exit 0
  }
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}
& "$here\mine_once.ps1"
