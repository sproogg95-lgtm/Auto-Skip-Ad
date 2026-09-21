Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 128)
$outDir = Join-Path $PSScriptRoot 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-Pt([double]$x, [double]$y) {
    return New-Object System.Drawing.PointF -ArgumentList @([single]$x, [single]$y)
}

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Red disc (YouTube-style)
    $red = New-Object System.Drawing.SolidBrush -ArgumentList @([System.Drawing.Color]::FromArgb(255, 204, 0, 0))
    $g.FillEllipse($red, 0, 0, $s, $s)

    # White double chevron (fast-forward / skip icon)
    $white = New-Object System.Drawing.SolidBrush -ArgumentList @([System.Drawing.Color]::White)
    $chevron1 = @(
        (New-Pt ($s * 0.28) ($s * 0.26)),
        (New-Pt ($s * 0.52) ($s * 0.50)),
        (New-Pt ($s * 0.28) ($s * 0.74))
    )
    $chevron2 = @(
        (New-Pt ($s * 0.54) ($s * 0.26)),
        (New-Pt ($s * 0.78) ($s * 0.50)),
        (New-Pt ($s * 0.54) ($s * 0.74))
    )
    $g.FillPolygon($white, $chevron1)
    $g.FillPolygon($white, $chevron2)

    $path = Join-Path $outDir ("icon{0}.png" -f $s)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    $red.Dispose()
    $white.Dispose()
    Write-Host "Created $path"
}
