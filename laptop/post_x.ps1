param(
  [Parameter(Mandatory = $true)][string]$Text
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here "secrets\x-api.env"
if (-not (Test-Path $envFile)) {
  Write-Warning "No secrets\x-api.env yet - skipped X post. Copy secrets\x-api.env.example and fill keys."
  exit 0
}
$py = $null
foreach ($c in @("python", "py")) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break }
}
if (-not $py) { Write-Error "Python not found (needed for X post)" }
& $py (Join-Path $here "post_x_tweet.py") --env-file $envFile --text $Text
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
