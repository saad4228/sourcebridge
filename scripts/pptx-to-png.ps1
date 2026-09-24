# Opens a .pptx in PowerPoint and exports every slide as a PNG.
#
# This checks the file a user actually downloads, rendered by the application
# they will actually open it in -- not a preview of it.
#
#   powershell -File scripts/pptx-to-png.ps1 <in.pptx> <outDir>

param(
  [Parameter(Mandatory = $true)] [string] $InputPath,
  [Parameter(Mandatory = $true)] [string] $OutDir
)

$ErrorActionPreference = 'Stop'
$InputPath = (Resolve-Path $InputPath).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

$app = New-Object -ComObject PowerPoint.Application
try {
  # Open read-only, untitled, without a window.
  $deck = $app.Presentations.Open($InputPath, $true, $true, $false)
  try {
    $i = 0
    foreach ($slide in $deck.Slides) {
      $i++
      $target = Join-Path $OutDir ("slide{0:D2}.png" -f $i)
      $slide.Export($target, 'PNG', 1600, 900)
      Write-Output "exported $target"
    }
    Write-Output "slides: $i"
  }
  finally {
    $deck.Close()
  }
}
finally {
  $app.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
