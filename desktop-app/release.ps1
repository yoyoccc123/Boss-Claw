param([switch]$Check,[ValidateSet('dir','portable','nsis')][string]$Target='dir')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if($Check) { & node (Join-Path $PSScriptRoot 'scripts\release.mjs') --check }
else { & node (Join-Path $PSScriptRoot 'scripts\release.mjs') --target $Target --install }
exit $LASTEXITCODE
