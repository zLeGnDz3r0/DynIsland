# Genera icon.ico e icon.png (píldora oscura con "12:37"). Solo GDI+.
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [int][Math]::Round($size * 0.06)
    $w = $size - (2 * $pad)
    $h = [int][Math]::Round($size * 0.42)
    $y = [int](($size - $h) / 2)
    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 18, 18, 22))
    $g.FillEllipse($bg, $pad, $y, $w, $h)

    $fontSize = [int]($h * 0.6)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rectF = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString('12:37', $font, [System.Drawing.Brushes]::White, $rectF, $fmt)

    $g.Dispose()
    return $bmp
}

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'src-tauri\icons'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$big = New-Icon 512
$big.Save((Join-Path $out 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = @()
foreach ($s in $sizes) {
    $img = New-Icon $s
    $p = New-Object System.IO.MemoryStream
    $img.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs += ,($p.ToArray())
    $img.Dispose()
}

$ms = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ms)
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $w.Write([Byte]($sizes[$i] -band 0xFF)); $w.Write([Byte]($sizes[$i] -band 0xFF))
    $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$pngs[$i].Length); $w.Write([UInt32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'), $ms.ToArray())
$w.Close()
Write-Host "Iconos generados en $out"
