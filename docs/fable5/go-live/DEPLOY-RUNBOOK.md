# Deploy Runbook — V01–V10 stack (v109 → v122)

> Companion to [DEPLOY-AUDIT.md](DEPLOY-AUDIT.md). Written 2026-07-07.
> You (the owner) execute every step below — the audit session prepared but did not deploy.
> Total expected window: ~15–25 minutes including verification.

## 0. Pre-push go/no-go checklist

Run each; ALL must pass before step 1.

- [ ] `git -C D:/newprojects/oneshoppos status` → clean tree, on `main`.
- [ ] `git log --oneline origin/main..main | wc -l` → 38 commits (V01–V10 + 3 recovery merges). If the count differs from what you expect, STOP and diff.
- [ ] `git branch --no-merged main` → only `fix/completion-04` remains (stale, content already in main — do NOT merge it).
- [ ] **Backup**: Supabase dashboard → Database → Backups → confirm a backup from the last 24 h exists (Pro plan: daily + 7-day PITR). Optionally download a snapshot. Do not proceed without this.
- [ ] `/check-services` (or minimum: `curl "https://api.sanopos.com/api/health?deep=true"` → `status:ok`) — don't deploy onto an already-degraded stack.
- [ ] Railway staged vars present: `railway variables | grep -E "RECALL|DUNNING|DEPOSIT_HOLD|EXPIRY_ALERT|BOOKING_REMINDER|CHANNEL_SYNC|NIGHT_AUDIT"` → 7 rows, all `1`.
- [ ] Pick a low-traffic window (tenants are PKT; late-night PKT is safest).

## 1. Push (the deploy trigger)

```bash
git -C D:/newprojects/oneshoppos push origin main
```

This triggers BOTH deploys: Railway (backend, via GitHub webhook) and Vercel (frontend).
No manual migrate step exists or is needed — Railway's `backend/start.sh` runs
`node migrate-pg.js` at container boot (public schema first, then each `status='active'`
tenant schema sequentially; per-tenant failures are logged but don't abort the others),
then `exec node index.js`. The old container keeps serving until the new one is healthy.

## 2. Watch the build

```bash
railway status --json | grep -oE '"status":"[A-Z_]+"' | head -3   # BUILDING → DEPLOYING → SUCCESS
```

**If the build never starts or dies at "uploading snapshot" before any Dockerfile step** —
this is the known Railway transient-build failure (hit 2026-07-06). Production is unharmed
(old container keeps serving; migrations never ran). `railway redeploy` is usually blocked
on the failed deploy. Fix = re-trigger the webhook with an empty commit:

```bash
git commit --allow-empty -m "chore: retrigger railway build" && git push origin main
```

## 3. Verify migrations (ground truth = DB, not HTTP)

⚠️ This backend 401s on ANY unknown/api path even when old code is live — a 401 does NOT
prove new code deployed. Use `schema_version` via Supabase SQL editor (or MCP):

```sql
SELECT 'public' s, max(version) v FROM public.schema_version
UNION ALL SELECT 'cafetestphase8', max(version) FROM tenant_cafetestphase8.schema_version
UNION ALL SELECT 'grocerywalktest1778451', max(version) FROM tenant_grocerywalktest1778451.schema_version
UNION ALL SELECT 'livetest1', max(version) FROM tenant_livetest1.schema_version
UNION ALL SELECT 'livetestauto', max(version) FROM tenant_livetestauto.schema_version
UNION ALL SELECT 'sanoposlivetest1778021564659', max(version) FROM tenant_sanoposlivetest1778021564659.schema_version
UNION ALL SELECT 'wholesalewalktest1778451', max(version) FROM tenant_wholesalewalktest1778451.schema_version;
```

Expected: **122 on all 7 rows.** Also check Railway deploy logs for `[migrate-pg]` lines —
"warns on the public schema" messages (e.g. `van sales schema skipped`) are EXPECTED and harmless.

## 4. Health + workers

- `curl "https://api.sanopos.com/api/health?deep=true"` → `status:ok`, database + resend ok.
- Super-admin → `/admin` → worker status (`GET /api/admin/worker-status`): the panel now has
  new rows — `channel_sync`, `night_audit`, `recall`, `deposit_hold_expiry`, `expiry_alert`,
  `subscription_dunning`, `booking_reminder`. Each should show a heartbeat within its interval
  (recall/night_audit are daily — "no heartbeat yet" right after boot is fine; confirm next day).
  `marketplace_sync` should now report `mode:"manual"` (the recovered completion-11 fix).
- Vercel: dashboard shows READY; hard-refresh https://sanopos.com.

## 5. Post-deploy smoke (10 min)

1. Login `livetest1` → dashboard renders → POS cash sale → receipt.
2. Wholesale tenant (`wholesalewalktest1778451`, PIN 4321): Backorders screen exists;
   flags `wholesale_backorders`/`wholesale_van_sales` show ON (v110/111 backfill fired).
3. Restaurant tenant: floor plan + KDS load; place one order.
4. Fresh-signup spot check (optional but recommended): sign up a throwaway `hostel` or
   `dental_clinic` tenant → verify vertical nav appears (modes + extra flags seeded) → delete
   the tenant from `/admin`.
5. Grocery tenant: POS loads; PLU pad only appears after the owner opts in (no barcode_scheme
   configured = feature off) — no behavior change expected.
6. Known-issue check (do NOT treat as regressions): currency shows `$` instead of `Rs`
   (pre-existing P1 currency-401); see audit §6.
7. Sentry: no new error spike in the hour after deploy.

## 6. Rollback

**Trigger:** migrations failed on ≥1 schema with real errors (not the expected warns), health
deep-check red, or the smoke list shows a data-writing defect.

**Code rollback (safe — migrations are additive):**
```bash
git revert -m 1 <merge-or-range>    # or: git push origin <last-good-sha>:main --force-with-lease
```
Practical fast path: `git push origin 1cd222b:main --force-with-lease` returns prod to the
exact pre-deploy code. v110–v122 are additive (new tables/columns/flag rows, no drops, no
rewrites), so v109 code runs fine against a v122 schema — schema rollback is NOT required
for a code rollback.

**Data rollback (only if bad writes occurred):** Supabase dashboard → Database → Backups →
PITR to a timestamp just before the deploy. This loses all tenant writes after that point —
last resort only, coordinate with tenants.

**Worker rollback:** any new worker misbehaving → `railway variables --set <NAME>=0` +
redeploy (or Railway dashboard toggle). Workers are individually gated.

## 7. After success

- Delete `fix/completion-04` (stale; content confirmed in main): `git branch -D fix/completion-04 && git push origin --delete fix/completion-04` (also completion-03/08/11 branch cleanup).
- Decide `SHIFT_AUTO_CLOSE_WORKER_ENABLED` (audit §4).
- Schedule the two P1 fixes: currency-401, reservations-TZ (audit §6).
- V03 aggregator/FBR go-live gates remain closed until their non-code checklist is done (audit §6.3).
- Run the shop-health Playwright walkthrough against the 4 test shops next morning.
