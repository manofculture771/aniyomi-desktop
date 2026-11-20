$root = "C:\Users\user\Desktop\Projecf\aniyomi-desktop"
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "Aniyomi.lnk"

$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $root "Start Aniyomi.bat"
$lnk.WorkingDirectory = $root
$lnk.IconLocation = (Join-Path $root "aniyomi.ico") + ",0"
$lnk.WindowStyle = 7   # minimised: the batch only starts the engine and the app window
$lnk.Description = "Aniyomi - Aniyomi extensions on the desktop"
$lnk.Save()

Write-Output ("shortcut: " + $lnkPath + " -> " + (Test-Path $lnkPath))
