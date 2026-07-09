---
name: check-services
description: Check health of all production services (Sentry, Vercel, Railway, Supabase, UptimeRobot, Cloudflare) and report issues
user_invocable: true
model: haiku
---

# Service Health Check

You are running a production service health check for SanoPOS. Run ALL checks below in order of priority, then output a single summary table. After completing, update the last-check timestamp.

## Environment

All credentials are in environment variables (loaded from `.claude/settings.local.json`):
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` = sanopos
- `UPTIMEROBOT_API_KEY` = monitor-specific key
- Supabase, Cloudflare = via MCP tools
- **Railway CLI** (`railway`) is authenticated locally — prefer over Railway MCP
- **Vercel CLI** (`vercel`) is authenticated locally — prefer over Vercel MCP (more reliable, long-lived token)

## Checks to Run (in priority order)

### P0 — Failures (stop and report if critical)

**1. Sentry — Unresolved errors (last 24h)**
```bash
sentry-cli issues list --project node-express --org sanopos --status unresolved 2>&1 | head -30
```
```bash
sentry-cli issues list --project sanopos-frontend --org sanopos --status unresolved 2>&1 | head -30
```
Count new/unresolved issues. If there are any, note the titles and frequency.

**2. Vercel — Recent deployment status**
Use the Vercel CLI (authenticated locally). Run from the repo root:
```bash
cd d:/newprojects/oneshoppos && vercel ls --yes 2>&1 | head -10
```
Parse the output — each row shows `Age | Project | Deployment URL | Status | Environment | Duration | Username`.
- Status `● Ready` = success
- Status `● Error` / `● Canceled` / `● Queued` = flag it
- Report the age and status of the latest 3 Production deployments
- If the latest is `● Ready`, that's green

Fallback: if `vercel` CLI returns an auth error, try `mcp__claude_ai_Vercel__list_deployments` with `projectId: "prj_molHCqGKI7tbbMrvznROJnbYyl4E"` and `teamId: "team_ivgPdR7exAdCGRMV9ZRs7AX4"`.

**3. UptimeRobot — Current status**
```bash
curl -s "https://api.uptimerobot.com/v2/getMonitors" -d "api_key=${UPTIMEROBOT_API_KEY}&format=json&logs=1&logs_limit=5" 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('monitors', []):
    status_map = {0:'paused',1:'not checked',2:'UP',8:'seems down',9:'DOWN'}
    s = status_map.get(m['status'], 'unknown')
    ratio = m.get('custom_uptime_ratio', 'N/A')
    print(f\"Status: {s} | Uptime 7d: {ratio}%\")
    for log in m.get('logs', [])[:3]:
        log_type = {1:'down',2:'up',98:'started',99:'paused'}.get(log['type'], '?')
        print(f\"  Event: {log_type} | Duration: {log.get('duration',0)}s\")
"
```

### P1 — Warnings

**4. Railway — Service health**

Run in parallel:
```bash
railway whoami 2>&1
```
```bash
railway status 2>&1
```
```bash
railway logs 2>&1 | grep -iE "error|fatal|crash|SIGTERM|OOM|killed" | head -10
```

Interpretation:
- `railway whoami` confirms auth. Any `Unauthorized` or `not logged in` message means stale auth — flag as "Railway: auth required, run `railway login`" and skip the rest.
- `railway status` should show `Project: zealous-friendship`, `Environment: production`, `Service: oneshoppos`. If `Service: None`, the workspace is missing its service link — see gotcha below.
- `railway logs` without `--service` will return `No service linked` if no service is set. If that happens, note "Railway log check skipped — no service linked in this workspace. Run `railway link` once to enable log tailing." Continue the health check — this is a warning, not a failure.
- If logs DO come back, flag any lines containing error/fatal/crash/OOM keywords. Zero matches = green.
- **Do NOT** auto-run `railway link` or `railway service <name>` to fix the linking — that modifies the user's local state without consent.

**Windows case-sensitivity gotcha** (resolved 2026-04-11): Railway CLI stores project links in `~/.railway/config.json` keyed by the *exact cwd string*. On Windows, Node-based tools (including Claude Code's Bash tool) can report the same directory with different drive-letter casing (`D:\...` vs `d:\...`), creating duplicate entries — one linked, one not. If `railway status` shows `Service: None` in this skill but the user insists they ran `railway link` successfully, read `~/.railway/config.json`, find both capital-D and lowercase-d entries for the repo path, and copy the `service` UUID from the linked one to the unlinked one. Both entries point to the same project; deduping them is safe.

**5. Supabase — Database health**
Use `mcp__claude_ai_Supabase__get_project` with `id: "tpjewvfoqtskscmwjtjj"`.
Check project status (`ACTIVE_HEALTHY` = good, anything else = problem).
Also use `mcp__claude_ai_Supabase__get_advisors` with `project_id: "tpjewvfoqtskscmwjtjj"` for any performance/security warnings.

### P2 — Routine

**6. Cloudflare — Domain status**
Use `mcp__claude_ai_Cloudflare_Developer_Platform__search_cloudflare_documentation` is NOT the right tool.
Instead run:
```bash
curl -s -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" "https://api.cloudflare.com/client/v4/zones/d6026bdc4ac1d65f02713a6c34ec74d5" 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result', {})
print(f\"Zone: {r.get('name')} | Status: {r.get('status')} | Paused: {r.get('paused')}\")
"
```

**7. Cloudflare R2 — Bucket status**
Use `mcp__claude_ai_Cloudflare_Developer_Platform__accounts_list` first, then `mcp__claude_ai_Cloudflare_Developer_Platform__set_active_account` with the account ID `d15d66c40671f2ca01843fbcb0a2ddbd`, then `mcp__claude_ai_Cloudflare_Developer_Platform__r2_buckets_list`.
Verify bucket `sanopos-uploads` exists. If missing or error, flag it.

**8. Backend health endpoint (also covers Resend)**
```bash
curl -s --max-time 10 "https://api.sanopos.com/api/health?deep=true" 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Health: {d.get('status')} | DB: {d.get('database',{}).get('status','?')} | Resend: {d.get('resend',{}).get('status','?')} | Uptime: {d.get('uptime','?')}s\")
" 2>/dev/null || echo "Health check FAILED or timed out"
```
Note: Resend is checked indirectly here — no separate Resend API call needed (the key is send-only permission).

## Output Format

After all checks complete, output a summary table:

```
━━━ SanoPOS Service Health ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Sentry (backend):   X unresolved issues
  Sentry (frontend):  X unresolved issues
  Vercel:             Last deploy STATUS (time ago)
  UptimeRobot:        UP/DOWN (uptime %)
  Railway:            Running/Error
  Supabase:           Healthy/Degraded
  Cloudflare:         Active/Issue
  API Health:         OK/FAILED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If ANY check found problems, list them below the table with recommended actions.
If everything is green, just say "All services healthy. No action needed."

## After Check

Update the timestamp file so the reminder hook knows when you last ran:
```bash
date +%s > d:/newprojects/oneshoppos/.claude/.last-service-check
```

## Important

- **Run checks in PARALLEL where possible** — Sentry (backend), Sentry (frontend), UptimeRobot, Vercel CLI, Railway CLI, API health endpoint, Cloudflare zone, and Supabase MCP can all fire in a single tool-call batch. Only the Cloudflare R2 flow is sequential (list accounts → set active → list buckets).
- **Prefer CLIs over MCP connectors** — Vercel CLI and Railway CLI are locally authenticated and more reliable than their MCP equivalents (which use OAuth tokens that expire). Only fall back to MCP if a CLI is missing or its auth is stale.
- Do NOT read any source code files — this is a monitoring skill, not a code review.
- Keep output concise — the user wants a quick status, not a wall of text.
- If a check fails to run (CLI not found, auth error), note it in the summary and continue with the rest. Never block the whole check on one failing subsystem.
