# LANOVEL Local Quality & Integrity Check Suite
# Runs Ruff, Biome, and Pytest locally across server, scripts, and extension.

$ErrorActionPreference = "Continue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "         LANOVEL Zero-Defect Local Quality Check         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1. Python Linting (Ruff)
Write-Host "`n[1/3] Running Python Ruff Linter..." -ForegroundColor Yellow
$ruffPath = Join-Path $root "venv\Scripts\ruff.exe"
if (Test-Path $ruffPath) {
    & $ruffPath check server/ scripts/
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  --> Ruff Check: PASSED (0 errors)" -ForegroundColor Green
    } else {
        Write-Host "  --> Ruff Check: FAILED" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  --> Warning: venv\Scripts\ruff.exe not found, skipping." -ForegroundColor DarkYellow
}

# 2. Extension & Static JS Linting (Biome)
Write-Host "`n[2/3] Running Extension JS Biome Linter..." -ForegroundColor Yellow
npx --yes @biomejs/biome lint extension/ --diagnostic-level=error
if ($LASTEXITCODE -eq 0) {
    Write-Host "  --> Biome Check: PASSED (0 errors)" -ForegroundColor Green
} else {
    Write-Host "  --> Biome Check: FAILED" -ForegroundColor Red
    exit 1
}

# 3. Python Test Suite (pytest)
Write-Host "`n[3/3] Running Core Test Suite (pytest)..." -ForegroundColor Yellow
$pytestPath = Join-Path $root "venv\Scripts\pytest.exe"
if (Test-Path $pytestPath) {
    & $pytestPath tests/test_corpus_ai_service.py tests/test_character_fixer.py tests/test_sync_router.py tests/test_unclassified.py tests/test_dictionary_service.py -q
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  --> Pytest Suite: PASSED" -ForegroundColor Green
    } else {
        Write-Host "  --> Pytest Suite: FAILED" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "       All Checks Passed Cleanly! Ready to Commit.       " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
