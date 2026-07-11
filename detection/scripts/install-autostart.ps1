# Creates a Startup-folder shortcut so the detector runs when the user logs in.
# Run: .\scripts\install-autostart.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$bat = Join-Path $Root "scripts\run-detector.bat"

if (-not (Test-Path $bat)) {
    Write-Host "Missing $bat" -ForegroundColor Red
    exit 1
}

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "No3 Darts Detector.lnk"

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath = $bat
$sc.WorkingDirectory = $Root
$sc.WindowStyle = 1
$sc.Description = "No3 Darts camera detector"
$sc.Save()

Write-Host "Installed autostart shortcut:" -ForegroundColor Green
Write-Host "  $shortcutPath"
Write-Host "It will run on next login for this Windows user."
Write-Host "To remove: delete that shortcut from the Startup folder (shell:startup)."
