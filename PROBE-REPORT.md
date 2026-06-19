# Browser Feasibility Probe Report

**Date**: 2026-06-19  
**Environment**: Claude Code scheduled cloud routine (`claude-sonnet-4-6`)  
**Repo**: sano9942/oneshoppos  

---

## Executive Summary

**Browser testing of a live web app from a scheduled cloud routine is NOT currently viable** — neither via agentic browser MCP tools nor via scripted headless Playwright. Two independent blockers prevent it: (a) no browser MCP tools exist in this environment, and (b) the egress network policy blocks both the target website and the Playwright browser-binary CDN.

---

## Step 1 — Tool Inventory

**Agentic browser MCP tools available: NO**

A full scan of all deferred tools (listed in the `system-reminder` at session start) found **zero** browser-automation tools. Specifically absent:

- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `mcp__playwright__*` (any variant)
- `mcp__puppeteer__*` (any variant)

**Tools that ARE available** (relevant subset):

| Category | Tools |
|----------|-------|
| File system | Read, Write, Edit, Glob, Grep |
| Shell | Bash |
| GitHub | `mcp__github__*` (50+ tools for PRs, commits, code search) |
| Vercel | `mcp__Vercel__*` (deployments, logs, runtime logs) |
| Supabase | `mcp__Supabase__*` (DB queries, migrations, logs) |
| Cloudflare | `mcp__Cloudflare_Developer_Platform__*` (Workers, KV, R2, D1) |
| Figma | `mcp__Figma__*` |
| Notion, Gmail, Google Calendar/Drive | present |
| Canva, Invideo | present |

---

## Step 2 — Browser MCP Tools: N/A

Not available. Skipped.

---

## Step 3 — Bash Environment Probe

### 3a. Runtime versions

```
$ node -v
v22.22.2

$ npm -v
10.9.7
```

Node.js 22 LTS is present. The project already declares `"@playwright/test": "^1.58.2"` and `"playwright": "^1.58.2"` in `frontend/package.json`.

### 3b. Outbound network test — target website

```
$ curl -sS -I https://sanopos.com | head -5

HTTP/2 403
x-deny-reason: host_not_allowed
content-length: 98
content-type: text/plain
date: Fri, 19 Jun 2026 15:00:52 GMT
```

```
$ curl -sS -I https://api.sanopos.com/api/health | head -5

HTTP/2 403
x-deny-reason: host_not_allowed
content-length: 102
content-type: text/plain
date: Fri, 19 Jun 2026 15:00:58 GMT
```

```
$ curl -sS -I https://example.com | head -5

HTTP/2 403
x-deny-reason: host_not_allowed
content-length: 98
content-type: text/plain
date: Fri, 19 Jun 2026 15:00:57 GMT
```

**Finding**: The cloud environment enforces a strict egress allowlist. `sanopos.com`, `api.sanopos.com`, and even `example.com` return `403 host_not_allowed`. GitHub is reachable (confirmed: `https://github.com` → `HTTP/2 200`), which is why git operations work.

### 3c. Playwright install attempt — `--with-deps chromium`

```
$ npx -y playwright@1.48.0 install --with-deps chromium

... (apt-get runs, most Ubuntu mirrors succeed) ...
E: Failed to fetch https://ppa.launchpadcontent.net/deadsnakes/ppa/ubuntu/... 403 Forbidden
E: Failed to fetch https://ppa.launchpadcontent.net/ondrej/php/ubuntu/...   403 Forbidden
Failed to install browsers
Error: Installation process exited with code: 100
```

System-level `apt` dependency install partially succeeded (Ubuntu mirrors allowed) but two PPAs were blocked. Critically, the **Chromium binary download was not even attempted** when run with `--with-deps`.

### 3d. Playwright install attempt — chromium binary only

```
$ npx -y playwright@1.48.0 install chromium

Downloading Chromium 130.0.6723.31 (playwright build v1140)
  from https://playwright.azureedge.net/builds/chromium/1140/chromium-linux.zip
Error: Download failed: server returned code 403
  body 'Host not in allowlist: playwright.azureedge.net.
  Add this host to your network egress settings to allow access.'

Downloading Chromium 130.0.6723.31 (playwright build v1140)
  from https://playwright-akamai.azureedge.net/builds/chromium/1140/chromium-linux.zip
Error: Download failed: server returned code 403
  body 'Host not in allowlist: playwright-akamai.azureedge.net.
  Add this host to your network egress settings to allow access.'

Downloading Chromium 130.0.6723.31 (playwright build v1140)
  from https://playwright-verizon.azureedge.net/builds/chromium/1140/chromium-linux.zip
Error: Download failed: server returned code 403
  body 'Host not in allowlist: playwright-verizon.azureedge.net.
  Add this host to your network egress settings to allow access.'

Failed to install browsers
Error: Failed to download Chromium 130.0.6723.31 (playwright build v1140)
```

All three Playwright CDN mirrors (`playwright.azureedge.net`, `playwright-akamai.azureedge.net`, `playwright-verizon.azureedge.net`) are blocked. The error messages explicitly say **"Add this host to your network egress settings."**

### 3e. Pre-installed browser check

```
$ ls ~/.cache/ms-playwright/
ls: cannot access '/root/.cache/ms-playwright/': No such file or directory

$ which chromium-browser || which chromium || which google-chrome || which google-chrome-stable
(no output — exit code 1)
```

No Playwright browser cache and no system-installed Chromium or Chrome found.

---

## Step 4 — Final Report

### (a) Are agentic browser MCP tools available in cloud routines?

**NO.** The full deferred-tool manifest for this session contains zero browser-automation MCP tools. There is no `browser_navigate`, `browser_snapshot`, `browser_click`, or any `mcp__playwright__*` / `mcp__puppeteer__*` tool. Agentic browsing is simply not wired into the scheduled cloud routine environment.

### (b) Is scripted headless Playwright-via-shell viable here?

**NO — blocked at two layers:**

1. **Binary download blocked**: All three Playwright Chromium CDN mirrors (`playwright.azureedge.net` and two Akamai/Verizon aliases) return `403 host_not_allowed`. The egress allowlist does not include them.
2. **Target website blocked**: Even if a browser binary were available, `https://sanopos.com` and `https://api.sanopos.com` both return `403 host_not_allowed`. A headless browser would receive the same block.

The blockers are independent — fixing either one alone is not sufficient.

### (c) Is outbound internet to sanopos.com reachable?

**NO.** Both `sanopos.com` (frontend) and `api.sanopos.com` (backend) are blocked with HTTP 403 `x-deny-reason: host_not_allowed`. The cloud environment uses a strict egress allowlist. GitHub, npm registries, Ubuntu apt mirrors, and Supabase/Vercel/Railway APIs are allowlisted (they work), but arbitrary external web addresses are not.

### (d) Bottom line: can a daily scheduled cloud routine do browser testing?

**Not without environment changes.** The current default network policy for Claude Code cloud routines does not permit:

- Downloading Playwright browser binaries
- Making HTTP requests to the production web app

**What would need to change** to make browser testing viable:

| Requirement | Action needed |
|-------------|---------------|
| Reach `sanopos.com` + `api.sanopos.com` | Add to network egress allowlist in session/environment settings |
| Download Playwright Chromium | Add `playwright.azureedge.net`, `playwright-akamai.azureedge.net`, `playwright-verizon.azureedge.net` to egress allowlist |
| Browser MCP tools | Use a Claude Code environment or agent configuration that includes a browser MCP server |

**Alternative approaches that DO work in current environment:**

- **API-level health checks** via GitHub Actions (separate CI environment, no egress restriction) running `npx playwright test` against production — the project already has 43 Playwright specs in `frontend/tests/`
- **Vercel/Sentry MCP monitoring**: `mcp__Vercel__get_runtime_logs`, `mcp__Vercel__get_deployment_build_logs`, Sentry error queries — all work today and cover a subset of what browser tests check
- **Supabase DB queries**: can verify backend data integrity without a browser
- **GitHub Actions scheduled workflow**: run `frontend/tests/*.spec.js` on a GitHub-hosted runner (full internet access, Playwright supported natively) and report results back

---

## Raw Evidence Summary

| Test | Result |
|------|--------|
| Browser MCP tools in session | None found |
| `node -v` | v22.22.2 |
| `npm -v` | 10.9.7 |
| `curl https://sanopos.com` | `403 host_not_allowed` |
| `curl https://api.sanopos.com/api/health` | `403 host_not_allowed` |
| `curl https://example.com` | `403 host_not_allowed` |
| `curl https://github.com` | `200 OK` (allowlisted) |
| `npx playwright install --with-deps chromium` | Failed — apt PPAs blocked, exit code 100 |
| `npx playwright install chromium` | Failed — all 3 CDN mirrors blocked with `403 host_not_allowed` |
| Playwright browser cache (`~/.cache/ms-playwright/`) | Does not exist |
| System chromium/chrome binary | Not installed |
