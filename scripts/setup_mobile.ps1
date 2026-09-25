# ==============================================================================
# LANOVEL Mobile Independent Library - Setup & Build Helper
# ==============================================================================

param (
    [switch]$InstallFlutter,
    [switch]$RunWeb,
    [switch]$BuildApk,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   LANOVEL Independent Reader (Flutter) Setup & Build" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Environment & Path configuration
$flutterDir = "D:\flutter"
$binPath = "D:\flutter\bin"
$jdkDir = "D:\jdk-17"

if (Test-Path $binPath) {
    if ($env:Path -notlike "*$binPath*") {
        $env:Path = "$binPath;$env:Path"
    }
}

if (Test-Path $jdkDir) {
    $env:JAVA_HOME = $jdkDir
    if ($env:Path -notlike "*$jdkDir\bin*") {
        $env:Path = "$jdkDir\bin;$env:Path"
    }
}

# 2. Check Flutter CLI
$flutterInstalled = $false
try {
    $ver = & flutter --version 2>$null
    if ($ver) {
        $flutterInstalled = $true
        Write-Host "[OK] Flutter found and ready." -ForegroundColor Green
    }
} catch {
    $flutterInstalled = $false
}

# 3. Handle -InstallFlutter
if (-not $flutterInstalled -and $InstallFlutter) {
    Write-Host "[INFO] Installing Flutter SDK to D:\flutter ..." -ForegroundColor Yellow
    $flutterZip = "D:\flutter_windows_stable.zip"
    $flutterUrl = "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.3-stable.zip"

    if (-not (Test-Path $flutterDir)) {
        Write-Host "Step 1: Downloading Flutter SDK (curl.exe)..." -ForegroundColor Cyan
        & curl.exe -L --progress-bar -o $flutterZip $flutterUrl

        Write-Host "Step 2: Extracting (tar.exe)..." -ForegroundColor Cyan
        & tar.exe -xf $flutterZip -C "D:\"

        if (Test-Path $flutterZip) {
            Remove-Item $flutterZip -Force
        }
    }

    $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($currentPath -notlike "*$binPath*") {
        $newPath = "$currentPath;$binPath"
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        $env:Path = "$binPath;$env:Path"
        Write-Host "[OK] User PATH updated with Flutter!" -ForegroundColor Green
    }
    $flutterInstalled = $true
}

if (-not $flutterInstalled) {
    Write-Host "[ERROR] Flutter not found. Run: .\scripts\setup_mobile.ps1 -InstallFlutter" -ForegroundColor Red
    return
}

# 4. Navigate and Run Tasks
Set-Location "C:\LANOVEL\mobile_app"

if ($Clean) {
    Write-Host "`n[CLEAN] Cleaning Flutter project..." -ForegroundColor Yellow
    & flutter clean
}

Write-Host "`n[1/2] Resolving dependencies (flutter pub get)..." -ForegroundColor Cyan
& flutter pub get

if ($RunWeb) {
    Write-Host "`n[2/2] Launching in Chrome browser..." -ForegroundColor Green
    & flutter run -d chrome
} elseif ($BuildApk) {
    Write-Host "`n[2/2] Building Android Release APK (flutter build apk --release)..." -ForegroundColor Green
    & flutter build apk --release
    Write-Host "`n[SUCCESS] APK build complete! Location:" -ForegroundColor Green
    Write-Host "C:\LANOVEL\mobile_app\build\app\outputs\flutter-apk\app-release.apk" -ForegroundColor Yellow
} else {
    Write-Host "`n[2/2] Launching on connected device (flutter run)..." -ForegroundColor Green
    & flutter run
}
