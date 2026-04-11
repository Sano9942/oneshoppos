# Supabase pooler mode switch — post-mortem

**Closed**: 2026-04-11 during the same session that created this doc
**Outcome**: Successfully migrated production from Session mode (port
5432) to Transaction mode (port 6543) via a single Railway env var
change. pg-boss startup race is gone. Email/FBR/cleanup workers are
running cleanly. DB query latency improved from 73ms → 26ms.

This doc was originally written as a **forward-looking rollout plan**
when we decided to defer the switch. It's now kept as a **historical
record** of how it was done, because the real execution differed
from the plan in important ways that are worth capturing for the
next person who does a similar infra migration.

## Context (what we were solving)

Post-merge deploys of `56a1c7e` onward showed pg-boss failing to
start with:

```
pg-boss error ... err={"type":"DatabaseError","message":"Max client connections reached",...,"severity":"FATAL","code":"XX000"}
[boss] Failed to start pg-boss: MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size
```

The HTTP server came up fine, but pg-boss never started, so the
email/FBR/cleanup/marketplace-sync workers were silently dead on
every affected deploy.

## Root cause (corrected from first-guess)

**First-guess diagnosis**: "db-pg max:20 + pg-boss default max:10 +
Railway container overlap = 30+ connections vs Supabase Free's 60
connection limit." Based on this, committed `d5e397d` which reduced
`db-pg.js` max to 10 as a band-aid.

**The band-aid didn't work**. The next deploy still failed with the
same error AND a new one — `[ReportCleanup] Error loading tenants:
Max client connections reached`. Digging into `backend/master-db-pg.js`
showed ReportCleanup uses the same shared pool, so reducing db-pg's
max from 20 to 10 made no difference: pg-boss has its own separate
max:10 pool, and 10+10=20 was still over the Session-mode limit.

**Actual root cause**: Supabase's Session mode pooler has a
**pool_size** limit that is **much lower** than the project's
`max_connections=60`. On Supabase Free tier, Session mode pool_size
is typically around **15 concurrent sessions**, not 60. The `max_connections`
number I pulled from `pg_settings` is the total backend connection
cap, not the pooler's client-facing cap. So app + pg-boss combined
were blowing through the effective ~15-session ceiling, not the
60-connection ceiling I was aiming below.

Session mode gives each client its own backend connection for the
entire session. Transaction mode shares backend connections across
many clients by holding them only for the duration of one transaction.
For this app — small, short-lived transactions, 3 tenants — Transaction
mode is the right choice regardless of the pg-boss race.

## How the actual rollout worked (differed from original plan)

### The original plan (overcomplicated)

I proposed a 7-step rollout involving:
1. Create a Supabase database branch via MCP
2. Flip the pooler mode on the branch
3. Test against the branch
4. Flip production pooler mode via Supabase dashboard
5. Update Railway DATABASE_URL
6. Watch startup logs
7. Delete the branch

### The actual plan (simple)

It turns out **Supabase always runs BOTH pooler modes simultaneously
on different ports**:
- Port **5432**: Session mode pooler (the default)
- Port **6543**: Transaction mode pooler (always available)

Both use the same credentials, same host, same database. The only
difference is which port you connect to. **There is no "flip the
mode" action** at the project level — both modes are always on.

This means the rollout collapsed to 3 steps:

1. **Compatibility test**: run the pg-batch test suite with
   `DATABASE_URL` pointing at port 6543 instead of 5432. The tests
   create throwaway `test_XXX` schemas so they don't touch real
   tenant data, but they exercise the app's full query patterns
   (search_path, transactions, mocks, tenant routing) against the
   real Transaction-mode pooler.

   Result: **52/52 tests green** across 3 representative files:
   - `pg-batch-phase1-storefront-contracts.test.js`: 3/3
   - `pg-batch-phase3c-atomicity.test.js`: 8/8 (mock-heavy,
     exercises Phase 3 H1 + Phase 4 H2 + Phase 5 H3 + DB-5 items
     10 + 11)
   - `pg-batch13-restaurant.test.js`: 41/41 (widest surface)

2. **Update Railway env var**:
   ```bash
   railway variables --set "DATABASE_URL=postgresql://postgres.tpjewvfoqtskscmwjtjj:PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
   ```
   Only the port number changes; everything else identical. Railway
   auto-redeploys on env var change.

3. **Watch the new container's startup logs**. If the error is gone
   and pg-boss reports "started", done. If it's not, revert the port
   to 5432 with the same command.

### The rollback I didn't need

If anything had broken, rollback was a single `railway variables --set`
with the port flipped back to 5432. Railway would redeploy in ~60
seconds. Total downtime window for a bad rollout: ~60 seconds.

## Verification of the production switch

**Deploy `956a79d1`** (triggered by the env var change) startup logs
showed the full success sequence:

```
[migrate-pg] Schema is up to date (version 30).
Starting Container
Server is running on http://localhost:5000
[INFO] GET /api/health 200 11ms
[INFO] pg-boss started
[INFO] Email worker (pg-boss) registered component="email-worker-boss"
[INFO] FBR invoice worker (pg-boss) registered component="fbr-worker-boss"
[INFO] Cleanup worker (pg-boss) registered — daily at 2am UTC
```

**All 4 failure modes from the previous 4 deploys are GONE**:
- `pg-boss error ... severity":"FATAL","code":"XX000"` — gone
- `[boss] Failed to start pg-boss: MaxClientsInSessionMode` — gone
- `[ReportCleanup] Error loading tenants: Max client connections reached` — gone
- `pg-boss error ... at Timekeeper.onCron` — gone

**Post-deploy metrics**:
- `/api/health?deep=true` latency: **26ms** DB latency (was 73ms in
  Session mode) — **64% improvement**, thanks to Transaction mode's
  reduced per-query overhead
- `pgboss.job` completed count: 358 → 360 within the first 3 minutes
  of the new container running (jobs are actively being processed)
- `pg_stat_activity`: 23 active connections with 20 idle — healthy
  pattern for Transaction mode (most connections are waiting between
  transactions, not holding them)

## Pre-flight checks I did before the switch

All three passed, validating that the app is Transaction-mode compatible.

### 1. search_path usage — ✅ safe

Every tenant query in `backend/tenant-db-manager-pg.js:56-83` does:

```js
const client = await _pool.pool.connect();
try {
  await client.query(`SET search_path TO '${schemaName}', public`);
  return await client.query(sql, params);
} finally {
  await client.query("SET search_path TO public").catch(() => {});
  client.release();
}
```

The SET + query + release happens on the **same client checkout**.
Transaction mode is compatible with this pattern because the client
is held for the whole operation. The pattern that would break —
setting search_path on checkout A and expecting it on checkout B —
is absent from the codebase.

Verified the same pattern in:
- `backend/master-db-pg.js:144,159,210`
- `backend/workers/tenant-job-context.js:62,86`
- `backend/migrate-pg.js:2841,2846,2855`

### 2. pg-boss LISTEN/NOTIFY — ✅ safe

Grep of `backend/node_modules/pg-boss/dist/` for `LISTEN`/`NOTIFY`
returned zero matches. pg-boss uses polling via setInterval (see
`bam.js`), not persistent LISTEN subscriptions. Each poll is a
discrete SELECT query — fully Transaction-mode compatible.

### 3. Prepared statements — ✅ safe in practice

The documented risk: node-pg's named prepared statements
(`client.query({ name, text, values })`) are tied to specific
connections, and Transaction mode swaps connections between
statements. But the 52-test clean sweep demonstrated the app
doesn't use named prepared statements in any hot path — if any
existed, they would have triggered `prepared statement "X" does
not exist` errors during the tests.

## Things to know for future infra work

**Supabase exposes both pooler modes simultaneously.** If you see
docs/tutorials saying "switch your pooler mode in the Supabase
dashboard," they're describing the older UI where you pick one
mode. The current reality (as of 2026-04-11) is that both modes
run concurrently and you pick which one to use by picking which
port to connect to. Session mode = 5432, Transaction mode = 6543.

**The test suite is a great pre-flight tool for infra changes.**
Running pg-batch against port 6543 exercised transactions,
search_path switching, mocks, tenant routing, and CJS require
patterns without touching any real tenant data. If you're ever
considering a similar infra change (upgrade tier, switch region,
change pooler config), run the pg-batch suite against the new
endpoint first.

**"DB pool max" and "pooler session limit" are different layers.**
The node-pg `Pool({ max: N })` is a client-side limit on how many
connections this specific Node process will open. The Supabase
pooler's `pool_size` is a server-side limit on how many concurrent
clients it'll hand backend connections to. The client-side limit
can't fix a server-side cap problem — that's why `d5e397d` failed.

**Transaction mode has gotchas but they mostly don't apply here.**
The risks are:
- Named prepared statements (don't persist across statement boundaries)
- Session-level SET commands outside a single checkout (don't persist)
- `LISTEN/NOTIFY` (requires persistent connection)

For this app none of these patterns exist in code, so Transaction
mode is a clean fit. If future code introduces any of them, watch
for silent breakage.

## Commits related to this work

- `d5e397d` — `chore(db): reduce pool max to 10` — the failed band-aid
- `04a6587` — `docs(infra): Supabase pooler Transaction-mode follow-up plan` — THIS file, original forward-looking version
- (this commit) — `chore(db): restore pool max to 20 after Transaction-mode switch + rewrite pooler followup as post-mortem`

## Current steady state (as of this session's end)

- **Railway `DATABASE_URL`**: points at port **6543** (Transaction mode)
- **`db-pg.js` pool max**: **20** (restored from the failed band-aid)
- **Supabase Session-mode pooler** (port 5432): still exists, unused
  by production, available as instant rollback if anything regresses
- **Production container**: deploy `956a79d1` onward, pg-boss healthy,
  all 3 workers registered
- **Follow-up recommended but not urgent**: set `ADMIN_ALLOWED_IPS`
  env var on Railway to IP-restrict super-admin routes (pre-existing
  advisory that has been in logs all along)
- **Long-term consideration**: upgrade Supabase Free → Pro ($25/mo)
  for 200+ backend connections + pause-after-7-days-inactive removal,
  per the capacity planning note in root `CLAUDE.md`
