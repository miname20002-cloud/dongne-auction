# ================================================================
#  Dongne Auction - Phase 0 file organizer
#  Usage:
#    powershell -ExecutionPolicy Bypass -File .\setup.ps1
# ================================================================

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Down = "$env:USERPROFILE\Downloads"
$Root = "$env:USERPROFILE\Documents\GitHub\dongne-auction"
if (-not (Test-Path "$env:USERPROFILE\Documents")) {
    $Root = "$env:USERPROFILE\Munseo\GitHub\dongne-auction"
    $alt  = Join-Path $env:USERPROFILE ([char]0xBB38 + [char]0xC11C)
    if (Test-Path $alt) { $Root = Join-Path $alt "GitHub\dongne-auction" }
}

Write-Host ""
Write-Host "=== Dongne Auction file organizer ===" -ForegroundColor Cyan
Write-Host "  Downloads : $Down"
Write-Host "  Project   : $Root"
Write-Host ""

# ---------- create folders ----------
foreach ($d in @("docs","docs\data","docs\archive","web","web\js","web\images")) {
    $full = Join-Path $Root $d
    if (-not (Test-Path $full)) {
        New-Item -ItemType Directory -Path $full -Force | Out-Null
        Write-Host "  [MKDIR] $d" -ForegroundColor DarkGray
    }
}

# ---------- move rules ----------
$Moves = New-Object System.Collections.Specialized.OrderedDictionary
$Moves.Add("index.html",      "web\index.html")
$Moves.Add("predict.html",    "web\predict.html")
$Moves.Add("live.html",       "web\live.html")
$Moves.Add("result.html",     "web\result.html")
$Moves.Add("common.js",       "web\js\common.js")
$Moves.Add("AppsScript_Code.gs", "docs\AppsScript_Code.gs")
$Moves.Add("Phase0_",         "docs\Phase0_spec.md")
$Moves.Add("1_events.csv",      "docs\data\1_events.csv")
$Moves.Add("2_lots.csv",        "docs\data\2_lots.csv")
$Moves.Add("3_predictions.csv", "docs\data\3_predictions.csv")
$Moves.Add("4_config.csv",      "docs\data\4_config.csv")

Write-Host "---- moving files ----" -ForegroundColor Cyan
$moved = 0; $missing = 0

foreach ($key in $Moves.Keys) {
    $dst = Join-Path $Root $Moves[$key]

    if ($key.EndsWith("_")) {
        $pattern = "$key*"                     # prefix match (Korean filename)
    } else {
        $b = [IO.Path]::GetFileNameWithoutExtension($key)
        $e = [IO.Path]::GetExtension($key)
        $pattern = "$b*$e"
    }

    $file = Get-ChildItem $Down -Filter $pattern -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if ($file) {
        Move-Item $file.FullName $dst -Force
        Write-Host ("  [OK]   {0,-28} -> {1}" -f $file.Name, $Moves[$key]) -ForegroundColor Green
        $moved++
    } else {
        Write-Host ("  [MISS] {0}" -f $key) -ForegroundColor DarkYellow
        $missing++
    }
}

# ---------- Korean-named CSV files (prefix match) ----------
Write-Host ""
Write-Host "---- korean-named csv ----" -ForegroundColor Cyan
foreach ($pre in @("05_","01_","02_","03_","04_")) {
    Get-ChildItem $Down -Filter "$pre*.csv" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Move-Item $_.FullName (Join-Path $Root "docs\data\$($_.Name)") -Force
        Write-Host "  [OK]   $($_.Name)" -ForegroundColor Green
        $moved++
    }
}
Get-ChildItem $Down -Filter "*.md" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Move-Item $_.FullName (Join-Path $Root "docs\$($_.Name)") -Force
    Write-Host "  [OK]   $($_.Name)" -ForegroundColor Green
    $moved++
}

# ---------- archive old versions ----------
Write-Host ""
Write-Host "---- archiving old versions ----" -ForegroundColor Cyan
$arch = 0
$archDir = Join-Path $Root "docs\archive"
foreach ($p in @("index_v*.html","index_final*.html","index_full*.html","index_round*.html","index_redesign*.html")) {
    Get-ChildItem $Down -Filter $p -File -ErrorAction SilentlyContinue | ForEach-Object {
        Move-Item $_.FullName (Join-Path $archDir $_.Name) -Force
        Write-Host "  [ARC]  $($_.Name)" -ForegroundColor DarkGray; $arch++
    }
    Get-ChildItem $Root -Filter $p -File -ErrorAction SilentlyContinue | ForEach-Object {
        Move-Item $_.FullName (Join-Path $archDir $_.Name) -Force
        Write-Host "  [ARC]  $($_.Name)" -ForegroundColor DarkGray; $arch++
    }
}

# ---------- result ----------
Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Cyan
Write-Host "  moved $moved / missing $missing / archived $arch"
Write-Host ""
Write-Host "---- structure ----" -ForegroundColor Cyan
Get-ChildItem $Root -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = $_.FullName.Replace($Root, "")
    if ($_.PSIsContainer) { Write-Host "  $rel\" -ForegroundColor Yellow }
    else { Write-Host "  $rel" -ForegroundColor Gray }
}

# ---------- todo ----------
Write-Host ""
Write-Host "---- TODO ----" -ForegroundColor Cyan
$imgN = (Get-ChildItem (Join-Path $Root "web\images") -File -ErrorAction SilentlyContinue).Count
if ($imgN -eq 0) { Write-Host "  [ ] put 5 product images into web\images\" -ForegroundColor Yellow }
else { Write-Host "  [O] images found: $imgN" -ForegroundColor Green }

$cj = Join-Path $Root "web\js\common.js"
if (Test-Path $cj) {
    if ((Get-Content $cj -Raw) -match 'API_URL\s*:\s*""') {
        Write-Host "  [ ] set CONFIG.API_URL in web\js\common.js" -ForegroundColor Yellow
    } else { Write-Host "  [O] API_URL is set" -ForegroundColor Green }
} else { Write-Host "  [ ] common.js is missing" -ForegroundColor Yellow }

Write-Host ""
explorer $Root
Read-Host "press Enter to exit"
