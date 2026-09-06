# Mine every 10 minutes when owed: each success logs txt + pushes GitHub site. Ctrl+C to stop.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$INTERVAL = if ($env:INTERVAL) { [int]$env:INTERVAL } else { 600 }
Write-Host ("10MM mine loop every " + $INTERVAL + "s (10m) - log+GitHub on each mine - Ctrl+C to stop")
$owed = Join-Path $here "mine_if_owed.ps1"
while ($true) {
  Write-Host ("---- " + (Get-Date -Format o) + " ----")
  try { & $owed } catch { Write-Host $_ }
  Start-Sleep -Seconds $INTERVAL
}
