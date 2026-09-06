# Clone 10MinMine next to this folder so publish_site.ps1 can git push
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$parent = Split-Path $here -Parent
$dest = Join-Path $parent "10MinMine"
if (Test-Path (Join-Path $dest ".git")) {
  Write-Host ("already cloned: " + $dest)
  Push-Location $dest
  git pull --ff-only origin main
  Pop-Location
  exit 0
}
Write-Host ("cloning into " + $dest)
git clone https://github.com/2SECSUI/10MinMine.git $dest
Write-Host "done. You can run mine_loop_12m.ps1 now."
