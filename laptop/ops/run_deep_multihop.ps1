[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ScannerArgs
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LogDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$Log = Join-Path $LogDir "deep_multihop_$Stamp.log"
Push-Location $Root
try {
  & node (Join-Path $Root 'laptop\deep_multihop_scan.mjs') @ScannerArgs 2>&1 | Tee-Object -FilePath $Log
  $Code = $LASTEXITCODE
} finally {
  Pop-Location
}
Write-Host "Log: $Log"
exit $Code
