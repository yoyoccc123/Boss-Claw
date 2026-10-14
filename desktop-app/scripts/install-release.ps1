param([Parameter(Mandatory=$true)][string]$Plan)
$ErrorActionPreference='Stop'
$p=Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$source=[IO.Path]::GetFullPath($p.source)
$destination=[IO.Path]::GetFullPath($p.destination)
$base=[IO.Path]::GetFullPath($p.backupRoot)
$data=[IO.Path]::GetFullPath($p.userData)
$logDir=[IO.Path]::GetFullPath($p.logDir)
function Assert-Child([string]$root,[string]$target) {
  if(-not $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped its declared directory' }
  if((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked target is forbidden' }
}
Assert-Child $base $destination
if([IO.Path]::GetFileName($destination) -ne 'BossClaw-新版-2.5.15') { throw 'Unexpected fixed installation directory' }
if($data -ne [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'BossClaw'))) { throw 'Unexpected user data directory' }
$manifest=Get-Content -LiteralPath (Join-Path $logDir 'program-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if((Get-Item -LiteralPath (Join-Path $source 'BossClaw.exe')).VersionInfo.ProductVersion -ne ($p.version+'.0')) { throw 'Candidate version mismatch' }
if(-not (Test-Path -LiteralPath (Join-Path $source 'resources\app.asar'))) { throw 'Verified ASAR candidate is missing' }

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class BossClawReleaseClose {
  public delegate bool Callback(IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr w,StringBuilder t,int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr w,StringBuilder t,int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr w,uint m,IntPtr a,IntPtr b);
  public static void Close(uint[] ids) { EnumWindows((w,l)=>{uint pid;GetWindowThreadProcessId(w,out pid);
    if(Array.IndexOf(ids,pid)>=0){var t=new StringBuilder(256);var c=new StringBuilder(256);GetWindowText(w,t,256);GetClassName(w,c,256);
      if(c.ToString()=="Chrome_WidgetWin_1"&&t.ToString().Contains("BossClaw"))PostMessage(w,0x10,IntPtr.Zero,IntPtr.Zero);}
    return true;},IntPtr.Zero); }
}
'@
$exe=Join-Path $destination 'BossClaw.exe'
$processes=@(Get-CimInstance Win32_Process -Filter "Name='BossClaw.exe'")
if($processes | Where-Object { $_.ExecutablePath -ne $exe }) { throw 'Another BossClaw directory is running; no forced close performed' }
if($processes.Count -gt 0) {
  [BossClawReleaseClose]::Close([uint32[]]@($processes | ForEach-Object { [uint32]$_.ProcessId }))
  $deadline=[DateTime]::UtcNow.AddSeconds(30)
  while(@(Get-CimInstance Win32_Process -Filter "Name='BossClaw.exe'").Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 300 }
}
if(@(Get-CimInstance Win32_Process -Filter "Name='BossClaw.exe'").Count -gt 0) { throw 'BossClaw did not close normally; release was not installed' }
$stamp=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'China Standard Time').ToString('yyyyMMdd-HHmmss')
$backup=[IO.Path]::GetFullPath((Join-Path $base ('BossClaw-更新备份-'+$stamp)))
Assert-Child $base $backup
if(Test-Path -LiteralPath $backup) { throw 'Backup already exists; it will not be overwritten' }
New-Item -ItemType Directory -Path $backup | Out-Null
$dataManifest=New-Object 'System.Collections.Generic.List[object]'
Write-Output 'Backing up and checking user data'
if(Test-Path -LiteralPath $data) {
  $dataCopy=Join-Path $backup 'userData'
  & robocopy $data $dataCopy /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
  if($LASTEXITCODE -ge 8) { throw 'User data backup failed; installation unchanged' }
  $originalFiles=@(Get-ChildItem -LiteralPath $data -Recurse -File)
  if($originalFiles.Count -ne @(Get-ChildItem -LiteralPath $dataCopy -Recurse -File).Count) { throw 'User data backup file count mismatch' }
  foreach($f in $originalFiles) {
    $relative=$f.FullName.Substring($data.Length+1);$copy=Join-Path $dataCopy $relative
    $hash=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if($f.Length -ne (Get-Item -LiteralPath $copy).Length -or $hash -ne (Get-FileHash -LiteralPath $copy).Hash) { throw 'User data backup checksum mismatch' }
    $dataManifest.Add([PSCustomObject]@{relative=$relative;size=$f.Length;sha256=$hash})
  }
}
ConvertTo-Json -InputObject @($dataManifest.ToArray()) -Depth 6 | Set-Content -LiteralPath (Join-Path $logDir 'user-data-manifest.json') -Encoding UTF8
ConvertTo-Json -InputObject @($dataManifest.ToArray()) -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'userData-manifest.json') -Encoding UTF8
# Preserve separate private documents and engine data; cleanup never removes these backups.
foreach($entry in @(
  @{source=(Join-Path $base 'BossClaw-简历样例');name='resume-documents'},
  @{source=(Join-Path $env:USERPROFILE '.bossclaw');name='camoufox-data'}
)) {
  if(Test-Path -LiteralPath $entry.source) {
    & robocopy $entry.source (Join-Path $backup $entry.name) /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
    if($LASTEXITCODE -ge 8) { throw 'Private document backup failed' }
  }
}
if(@(Get-CimInstance Win32_Process -Filter "Name='BossClaw.exe'").Count -gt 0) { throw 'BossClaw restarted before replacement' }
$previous=Join-Path $backup 'previous-program'
Assert-Child $backup $previous
if(Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $previous }
try {
  & robocopy $source $destination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
  if($LASTEXITCODE -ge 8) { throw 'Program copy failed' }
  if(@(Get-ChildItem -LiteralPath $destination -Recurse -File).Count -ne $manifest.Count) { throw 'Program file count mismatch' }
  foreach($f in $manifest) {
    $file=[IO.Path]::GetFullPath((Join-Path $destination $f.relative));Assert-Child $destination $file
    if((Get-Item -LiteralPath $file).Length -ne $f.size -or (Get-FileHash -LiteralPath $file).Hash -ne $f.sha256) { throw 'Installed program checksum mismatch' }
  }
  foreach($f in $dataManifest) {
    $file=Join-Path $data $f.relative
    if((Get-Item -LiteralPath $file).Length -ne $f.size -or (Get-FileHash -LiteralPath $file).Hash -ne $f.sha256) { throw 'User data changed during deployment' }
  }
  if(@(Get-ChildItem -LiteralPath $data -Recurse -File -ErrorAction SilentlyContinue).Count -ne $dataManifest.Count) { throw 'User data file count changed during deployment' }
  if((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne ($p.version+'.0')) { throw 'Installed version mismatch' }
  $result=[ordered]@{success=$true;version=$p.version;path=$exe;backup=$backup;previousProgram=$previous;userDataFilesVerified=$dataManifest.Count;programFilesVerified=$manifest.Count;sourceCommit=$p.sourceCommit;asar=$true}
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $logDir 'install-result.json') -Encoding UTF8
  Write-Output ('Installed '+$p.version+'; verified '+$dataManifest.Count+' user data files')
} catch {
  if(Test-Path -LiteralPath $destination) {
    $partial=[IO.Path]::GetFullPath((Join-Path $backup 'incomplete-program'));Assert-Child $backup $partial
    Move-Item -LiteralPath $destination -Destination $partial
  }
  if(Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $destination }
  throw
}
exit 0
