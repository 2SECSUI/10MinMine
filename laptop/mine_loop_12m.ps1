# Mine every 12 minutes when a block is owed. Ctrl+C to stop.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$INTERVAL = if ($env:INTERVAL) { [int]$env:INTERVAL } else { 720 }
Write-Host ("10MM mine loop every " + $INTERVAL + "s - Ctrl+C to stop")
$owed = Join-Path $here "mine_if_owed.ps1"
while ($true) {
  Write-Host ("---- " + (Get-Date -Format o) + " ----")
  try { & $owed } catch { Write-Host $_ }
  Start-Sleep -Seconds $INTERVAL
}
