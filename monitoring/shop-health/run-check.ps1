# Daily shop-health check launcher.
# Runs Claude Code headless, which drives sanopos.com via the Playwright MCP and writes
# a dated markdown report to monitoring/shop-health/reports/.
# Intended to be invoked by Windows Task Scheduler (see README.md), but you can run it by hand.

$ErrorActionPreference = 'Stop'
$repo   = 'D:\newprojects\oneshoppos'
$dir    = Join-Path $repo 'monitoring\shop-health'
$prompt = Get-Content (Join-Path $dir 'check-prompt.md') -Raw

# Log this run so a scheduled (unattended) failure is diagnosable.
$logDir = Join-Path $dir 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ("run-" + (Get-Date -Format 'yyyy-MM-dd_HHmmss') + ".log")

Set-Location $repo

# --dangerously-skip-permissions: required for unattended MCP/browser tool use (no human to approve prompts).
# --model sonnet: capable enough for adaptive browsing, cheap enough for a daily run. Bump to opus if you want.
& claude -p $prompt --dangerously-skip-permissions --model sonnet *>&1 | Tee-Object -FilePath $log

Write-Host "Done. Log: $log"
