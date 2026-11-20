Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# rounded square path
$r = 116
$d = $r * 2
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $d, $d, 180, 90)
$path.AddArc($size - $d, 0, $d, $d, 270, 90)
$path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$path.AddArc(0, $size - $d, $d, $d, 90, 90)
$path.CloseFigure()

$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $size)),
    [System.Drawing.Color]::FromArgb(255, 58, 116, 166),
    [System.Drawing.Color]::FromArgb(255, 36, 84, 127))
$g.FillPath($bg, $path)

# red ring + white disc
$ringBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(88, 88)),
    (New-Object System.Drawing.Point(424, 424)),
    [System.Drawing.Color]::FromArgb(255, 240, 84, 74),
    [System.Drawing.Color]::FromArgb(255, 207, 47, 39))
$g.FillEllipse($ringBrush, 88, 88, 336, 336)
$g.FillEllipse([System.Drawing.Brushes]::White, 128, 128, 256, 256)

# play triangle
$pts = @(
    (New-Object System.Drawing.Point(226, 191)),
    (New-Object System.Drawing.Point(338, 256)),
    (New-Object System.Drawing.Point(226, 321)))
$tri = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 22, 24, 29))
$g.FillPolygon($tri, $pts)
$g.Dispose()

$root = "C:\Users\user\Desktop\Projecf\aniyomi-desktop"
$png = Join-Path $root "assets\icon-512.png"
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# single-image ICO carrying the PNG (keeps alpha)
$bytes = [System.IO.File]::ReadAllBytes($png)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$bytes.Length); $bw.Write([UInt32]22)
$bw.Write($bytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root "aniyomi.ico"), $ms.ToArray())
Write-Output ("png " + $bytes.Length + " bytes, ico " + (Get-Item (Join-Path $root "aniyomi.ico")).Length + " bytes")
