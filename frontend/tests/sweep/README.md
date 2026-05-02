# Sweep — full real-user functional test

A single Playwright spec that signs up a brand-new tenant on production, runs through ~50 ordered steps as a real merchant would (signup → onboarding → upgrade → POS → inventory → reports → cleanup), and writes a findings file you can act on.

This is **option 2** from the pre-launch verification plan: write paths, real tenant, real emails, real sandbox payments. ~3–4 hours per run. Manually triggered, no CI.

## Prerequisites

- Hotmail inbox `sano9942@hotmail.com` accessible to the operator (you'll click the verify email)
- Production reachable: `https://sanopos.com` + `https://api.sanopos.com`
- `PAYMENT_GATEWAY=sandbox` on Railway (confirmed 2026-05-03)
- `npx playwright install` has been run at least once on this machine

## Run it

```bash
cd frontend
npx playwright test tests/sweep/functional-sweep.spec.js --headed
```

A Chromium window opens. The sweep walks through every step at 200ms per action — you can watch every click, type, and navigation. Total run time: ~3–4 hours.

## What you do during the run

You're in the loop **twice**:

1. **Email verify (~5 min into the run)** — Open Hotmail, find the verify email from `noreply@sanopos.com`, click the link. The Playwright window picks up automatically. The terminal tells you when this is needed.

2. **Sandbox payment (~30 min into the run)** — When the sweep adds a 2nd outlet, the Pro upgrade paywall appears. The sweep clicks Pay Now → lands on the SanoPay sandbox redirect → you approve the sandbox payment in the Playwright window (one click). Sweep continues.

Otherwise: leave the machine alone. Don't click inside the Playwright window — it confuses the test.

## What lands where

| Output | Path |
|--------|------|
| Per-step findings (raw JSON) | `frontend/test-results/sweep-findings.json` |
| Triage punch list (markdown) | `docs/sweep-findings-YYYY-MM-DD.md` |
| Failure screenshots | `frontend/test-results/sweep/<step>/screenshot.png` |
| Failure traces (Playwright) | `frontend/test-results/sweep/<step>/trace.zip` |
| Playwright HTML report | `frontend/playwright-report/` (open with `npx playwright show-report`) |

After the run, generate the punch list:

```bash
node scripts/build-sweep-findings.mjs
```

## After the run

The test tenant **stays alive** in production. You manually delete it via:

1. Open `https://sanopos.com/admin`
2. Find the tenant (slug starts with `livetestauto`)
3. Click into it → Delete

This is intentional — leaves the populated tenant available for poking around if any finding needs reproducing.

## Safety notes

- Real emails go to `sano9942@hotmail.com` (~15–25 per run: verify, welcome, drips, receipts, support, billing). Set up a Hotmail filter for `@sanopos.com` if needed.
- Real Sentry traffic during the run. Expect 5–10 events per run.
- Sandbox payments **do not move real money** — `PAYMENT_GATEWAY=sandbox`, no `XPAY_API_KEY` set on Railway.
- The sweep tenant will appear in MRR / tenant-count queries until manually deleted. Filter by `slug NOT LIKE 'livetestauto%'`.
- If the run crashes mid-flow, the tenant lingers. Delete via `/admin` (same as a successful run).

## Recovering from a crashed run

1. Find the slug — it's in the terminal output and in the findings JSON
2. Open `/admin`, search for the slug, delete the tenant
3. Re-run the sweep — it generates a fresh slug each time (timestamp-based)

## Adding new steps

Each step in `functional-sweep.spec.js` is an isolated `test()` block inside the serial describe. Pattern:

```js
test("N — <one-line summary>", async () => {
  await captureStep(page, "step-N-name", async () => {
    // do user actions
    // assert visible state
  });
});
```

`captureStep` records pass/fail, console errors, and 4xx/5xx network responses for the step. Failures don't abort — subsequent steps still run, partial findings are still useful.

## Known one-time-paste workarounds

None currently. If signup / verify / payment ever stops working in pure-headed mode, fall back to the inbox-paste pattern documented in `helpers/pause-for-email-verify.js`.
