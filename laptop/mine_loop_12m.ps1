# Mine every 12 minutes when a block is owed. Ctrl+C to stop.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$INTERVAL = if ($env:INTERVAL) { [int]$env:INTERVAL } else { 720 }
Write-Host "10MM mine loop every ${INTERVAL}s — Ctrl+C to stop"
while ($true) {
  Write-Host "---- $(Get-Date -Format o) ----"
  try { & "$here\mine_if_owed.ps1" } catch { Write-Host $_ }
  Start-Sleep -Seconds $INTERVAL
}
