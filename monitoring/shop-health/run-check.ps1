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

# Auto-commit + push the day's report so history is preserved with zero manual steps.
# Only the reports/ folder is touched — credentials (shops.local.json) and logs/ are gitignored.
try {
  & git -C $repo add monitoring/shop-health/reports/ 2>&1 | Out-Null
  $pending = & git -C $repo status --porcelain monitoring/shop-health/reports/
  if ($pending) {
    $today = Get-Date -Format 'yyyy-MM-dd'
    & git -C $repo commit -q -m "chore(monitoring): shop-health report $today (automated run)"
    & git -C $repo push origin HEAD 2>&1 | Out-Null
    Write-Host "Report committed + pushed."
  } else {
    Write-Host "No report changes to commit."
  }
} catch {
  Write-Host "Auto-commit skipped (git error): $($_.Exception.Message)"
}

Write-Host "Done. Log: $log"
