Add-Type -AssemblyName System.Drawing
$root = "C:\Users\user\Desktop\Projecf\aniyomi-desktop"
$src  = Join-Path $root "assets\main.png"
$png  = [System.IO.File]::ReadAllBytes($src)
$ms   = New-Object System.IO.MemoryStream
$bw   = New-Object System.IO.BinaryWriter($ms)
# ICONDIR
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
# ICONDIRENTRY (256x256 -> 0/0)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
$bw.Write($png)
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root "aniyomi.ico"), $ms.ToArray())
Write-Output ("ico bytes: " + (Get-Item (Join-Path $root "aniyomi.ico")).Length)
