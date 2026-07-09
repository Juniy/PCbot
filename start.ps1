# PCbot startup script (Windows PowerShell)
# Starts OpenCode serve + PCbot Web UI

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PCbot - Automation Workhorse System" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Bun
$bunCheck = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunCheck) {
    Write-Host "[ERROR] Bun not found! Install: https://bun.sh" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Bun $(bun --version)" -ForegroundColor Green

# Type check
Write-Host ""
Write-Host "[...] Running type check..." -ForegroundColor Yellow
$tscResult = bun run typecheck 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] TypeScript type check failed:" -ForegroundColor Red
    Write-Host $tscResult -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Type check passed" -ForegroundColor Green

# Check frontend
if (-not (Test-Path "frontend/index.html")) {
    Write-Host "[SKIP] Frontend not found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Starting services:" -ForegroundColor White
Write-Host "  * Web UI:      http://localhost:8081" -ForegroundColor Green
Write-Host "  * Webhook:     POST http://localhost:8080/webhook" -ForegroundColor Green
Write-Host "  * Chat API:    POST http://localhost:8081/api/chat" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Start PCbot
Write-Host "[...] Starting PCbot..." -ForegroundColor Yellow
bun run src/index.ts --serve
