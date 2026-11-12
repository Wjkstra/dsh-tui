# dsh-cli launcher body: UTF-8 console without chcp.com, then the line client.
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$cli = Join-Path $env:USERPROFILE '.dsh-cli\bin\dsh-cli.mjs'
if (-not (Test-Path $cli)) {
  Write-Error "[dsh-cli] missing $cli"
  exit 1
}
& node $cli @args
exit $LASTEXITCODE
