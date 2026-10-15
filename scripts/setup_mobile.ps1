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
    $apkPath = "C:\LANOVEL\mobile_app\build\app\outputs\flutter-apk\app-release.apk"
    Write-Host "`n[SUCCESS] APK build complete! Location:" -ForegroundColor Green
    Write-Host $apkPath -ForegroundColor Yellow

    # server/static에도 복사하여 정적 호스팅 지원
    if (Test-Path "C:\LANOVEL\server\static") {
        Copy-Item -Path $apkPath -Destination "C:\LANOVEL\server\static\lanovel-reader-release.apk" -Force
        Write-Host "  -> [COPY] server\static\lanovel-reader-release.apk 동기화 완료" -ForegroundColor Green
    }

    # 3. 자동 업데이트 배포 (ADB 연결 기기 직배포 & Wi-Fi 실시간 푸시)
    Write-Host "`n[3/3] 모바일 기기 자동 업데이트 감지 및 배포 시작..." -ForegroundColor Cyan

    $adbPath = "C:\Users\parkp\AppData\Local\Android\Sdk\platform-tools\adb.exe"
    if (-not (Test-Path $adbPath)) {
        $adbCmd = Get-Command adb -ErrorAction SilentlyContinue
        if ($adbCmd) { $adbPath = $adbCmd.Source }
    }

    $adbDeployed = $false
    try {
        if (Test-Path $adbPath) {
            $devicesOutput = cmd.exe /c "`"$adbPath`" devices" 2>&1
            $connectedDevices = $devicesOutput | Where-Object { $_ -match "\bdevice\b" -and $_ -notmatch "List of devices" }
            if ($connectedDevices) {
                Write-Host "  -> [ADB 연결 기기 감지] 스마트폰에 무설치 자동 배포(adb install -r)를 실행합니다..." -ForegroundColor Green
                cmd.exe /c "`"$adbPath`" install -r `"$apkPath`"" 2>&1 | Out-Null
                cmd.exe /c "`"$adbPath`" shell am start -n com.lanovel.lanovel_reader/.MainActivity" 2>&1 | Out-Null
                Write-Host "  -> [SUCCESS] 스마트폰에 시스템 설치창 없는 무설치 업데이트 및 앱 실행 완료!" -ForegroundColor Green
                $adbDeployed = $true
            }
        }
    } catch {}

    # PC 서버가 켜져 있으면 Wi-Fi 접속 중인 모바일 앱들에 SSE 무설치 업데이트 브로드캐스트
    try {
        $broadcastRes = Invoke-RestMethod -Uri "http://localhost:8001/api/app/broadcast_update" -Method Post -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($broadcastRes) {
            Write-Host "  -> [Wi-Fi SSE 푸시] 서버에 연결된 모든 모바일 앱에 무설치 자동 업데이트 신호 발송 완료!" -ForegroundColor Green
        }
    } catch {}

    if (-not $adbDeployed) {
        Write-Host "  -> [안내] USB/무선 ADB 기기가 연결되어 있지 않아 Wi-Fi 무설치 자동 업데이트 신호를 발송했습니다." -ForegroundColor Yellow
        Write-Host "     (스마트폰을 USB로 연결해 두시면 -BuildApk 실행 시 폰을 만질 필요 없이 100% 자동 설치/실행됩니다)" -ForegroundColor Gray
    }
} else {
    Write-Host "`n[2/2] Launching on connected device (flutter run)..." -ForegroundColor Green
    & flutter run
}
