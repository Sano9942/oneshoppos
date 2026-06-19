# Shop Health Check (adaptive daily walkthrough)

An agentic, **not** scripted, daily check of the four live test shops on sanopos.com.
Claude Code logs into each shop like a real owner, uses the app the way a person would,
notices when something looks broken or behaves wrong, and writes a plain-language report.

Because it's an LLM driving a real browser (adapts when buttons move) rather than a brittle
script, it can't run in Anthropic's cloud scheduler (no browser there + sanopos.com is
egress-blocked). So it runs **on this machine**, launched by Windows Task Scheduler.

## Files
- `check-prompt.md` — the instructions Claude follows each run (what "works" means, how to adapt, what to write).
- `shops.local.json` — the four shops' credentials. **Gitignored. Never commit.**
- `run-check.ps1` — launcher: runs `claude` headless with the prompt; logs each run to `logs/`.
- `reports/<YYYY-MM-DD>.md` — the deliverable, one per run. Committed so history builds up.

## Run it by hand
```powershell
powershell -ExecutionPolicy Bypass -File "D:\newprojects\oneshoppos\monitoring\shop-health\run-check.ps1"
```
The report lands in `reports/`. The raw transcript lands in `logs/`.

## Schedule it (daily 8:00 AM)
Run once, in a normal (non-admin) PowerShell, to register a per-user scheduled task:
```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "D:\newprojects\oneshoppos\monitoring\shop-health\run-check.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun:$false
Register-ScheduledTask -TaskName 'SanoPOS Shop Health Check' -Action $action -Trigger $trigger -Settings $settings -Description 'Daily adaptive walkthrough of the 4 test shops; writes monitoring/shop-health/reports/<date>.md'
```
- `-StartWhenAvailable` runs the check late if the PC was off at 8 AM.
- The check only runs when this machine is on. If you need true 24/7 coverage, move it to
  an always-on box (same files, register the equivalent OS scheduler entry there).

Manage it later:
```powershell
Get-ScheduledTask -TaskName 'SanoPOS Shop Health Check'        # status
Start-ScheduledTask  -TaskName 'SanoPOS Shop Health Check'     # run now
Unregister-ScheduledTask -TaskName 'SanoPOS Shop Health Check' # remove
```

## Maintenance
- Credentials change? Edit `shops.local.json` only.
- Want a different cadence, deeper checks, or to watch for a new bug? Edit `check-prompt.md` — no code changes needed.
- Cost: defaults to `--model sonnet` for a cheap daily run. Bump to opus in `run-check.ps1` for deeper reasoning.
