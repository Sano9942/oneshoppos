# Supabase pooler mode investigation follow-up

**Created**: 2026-04-11 at end of Wave 3 drive-by hygiene session
**Owner**: next session picking up infra work on sanopos
**Priority**: medium — the immediate pg-boss startup race is fixed by
`d5e397d` (max:10 cut), but this is the proper long-term fix

## Context

During post-merge sanity checks on 2026-04-11, the Railway deploy of
commit `56a1c7e` showed a pg-boss startup failure:

```
pg-boss error ... err={"type":"DatabaseError","message":"Max client connections reached",...,"severity":"FATAL","code":"XX000"}
[boss] Failed to start pg-boss: MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size
```

Root cause diagnosis in that session:

1. Supabase Free tier caps total DB connections at 60.
2. The Supabase **pooler** is configured in **Session mode**, which
   allocates one backend connection per client for the client's
   entire session.
3. `backend/db-pg.js` had `max: 20` on its pg.Pool.
4. pg-boss's own pool defaults to `max: 10`.
5. During Railway container handoff, the departing and arriving
   containers briefly overlap, temporarily holding connections
   from BOTH instances' pools — total demand 20+10+20+10 = 60,
   right at the cap, with no headroom for Supabase's ~5 internal
   overhead.
6. pg-boss loses the race and fails to start; the HTTP server
   continues running but with no email/FBR/cleanup/marketplace
   workers.
7. Observed steady-state connection usage is ~26/60, so under
   normal operation the app is well under the cap.

**Immediate fix landed**: commit `d5e397d` on main reduces db-pg
pool to `max: 10`, cutting the app's steady-state footprint and
making the overlap window fit under 60. Effective but not the
proper fix.

## The proper fix: switch Supabase pooler to Transaction mode

Transaction mode pools backend connections **between** transactions
rather than for entire sessions — each transaction briefly checks
out a connection and releases it at COMMIT/ROLLBACK. This increases
effective client capacity from ~20 simultaneous sessions to
hundreds of concurrent transactions, because most clients hold a
connection only for milliseconds.

**Where to make the change**:
Supabase dashboard → Settings → Database → Connection Pooling →
change mode from "Session" to "Transaction"

**Free tier caveat**: Transaction mode is available on all tiers,
but the pool_size under Free is still limited. Check the dashboard
for the exact number. Typical pooler config exposes port 6543 for
transaction mode (the current session mode uses 5432).

## Pre-flight checks before flipping the switch

### 1. Search_path compatibility — ✅ already verified safe

Verified in the 2026-04-11 session (see
`backend/tenant-db-manager-pg.js:56-83`). Every tenant query does:

```js
query: async (sql, params) => {
  const client = await _pool.pool.connect();
  try {
    await client.query(`SET search_path TO '${schemaName}', public`);
    return await client.query(sql, params);
  } finally {
    await client.query("SET search_path TO public").catch(() => {});
    client.release();
  }
}
```

SET + query + release happens on the same client checkout. Transaction
mode is compatible because the client is held for the whole operation.
The pattern that WOULD break Transaction mode — setting search_path on
one checkout and expecting it on a later checkout — is absent from
the codebase.

Same pattern in:
- `backend/master-db-pg.js:144,159,210` (public search_path)
- `backend/workers/tenant-job-context.js:62,86` (tenant + reset)
- `backend/migrate-pg.js:2841,2846,2855` (per-tenant migration loop)

### 2. pg-boss polling mechanism — ✅ already verified safe

Verified in the same session (see `backend/node_modules/pg-boss/dist/bam.js`).
pg-boss uses **polling via setInterval**, NOT `LISTEN/NOTIFY`. Each
poll is a discrete SELECT that checks out a connection, runs, and
releases. No persistent session state.

### 3. Prepared statements — ⚠️ NEEDS VERIFICATION

The `node-pg` driver (used by both db-pg.js and pg-boss) supports
named prepared statements via `client.query({ name, text, values })`.
In Transaction mode, prepared statements created on connection A
don't exist on connection B because connections get recycled between
statements.

**Before flipping the switch, grep for prepared statements**:

```bash
grep -rn "name:\s*['\"]" backend/ --include="*.js" | grep -iE "name.*:[\"']|prepare"
grep -rn "client\.query\(\s*{" backend/ --include="*.js"
```

If any call site uses the `{ name, text, values }` form, that call
site will break in Transaction mode (silently — the query will work
the first time but fail on subsequent calls with
`prepared statement "X" does not exist`).

Check especially:
- `backend/routes/sales.js` — hot path, high query volume
- `backend/routes/products.js` — hot path
- `backend/workers/*` — long-lived processes where prepared
  statement cache builds up

If any are found, the mitigation is to rewrite those call sites
to use string-based queries with parameters (`client.query(sql, params)`
instead of `client.query({ name, text, values })`). The app's pattern
is already mostly string-based, so this may be a non-issue.

### 4. Supabase pool_size in Transaction mode — ⚠️ CHECK DASHBOARD

Free tier may still have a low effective pool_size even in
Transaction mode. Check the Supabase dashboard for the exact limit
before deciding whether the switch solves the race entirely or
just mitigates it.

### 5. Application-level SET commands beyond search_path — ⚠️ CHECK

Grep for other `SET` commands that might leak between transactions:

```bash
grep -rn "client\.query\(\s*['\"]\s*SET" backend/ --include="*.js"
```

Things to watch for:
- `SET statement_timeout` (session-level)
- `SET application_name` (session-level)
- `SET TIME ZONE` (session-level)
- `SET transaction_isolation` (actually OK — transaction-scoped)

If any session-level SETs are found, they need to move inside
transactions OR be set via connection params at pool init time.

## Rollout plan

**Do NOT run this in production without a dry run.** The pooler
mode setting is a shared-state change with no code-side rollback.

### Step 1: pre-flight verification (all green required before Step 2)

Run each of these and confirm the expected result:

```bash
# 1. search_path usage — should show only the safe patterns above
grep -rn "SET search_path" backend/ --include="*.js" | grep -v node_modules

# 2. Prepared statement usage — should return ZERO rows
grep -rn "client\.query\(\s*{" backend/ --include="*.js" | grep -v node_modules

# 3. Session-level SET commands beyond search_path — should show ZERO unexpected results
grep -rn "SET " backend/ --include="*.js" | grep -v search_path | grep -v node_modules
```

### Step 2: create a Supabase branch (database branch feature)

```
Use Supabase MCP: mcp__claude_ai_Supabase__create_branch with name "pooler-transaction-mode-test"
```

Branches in Supabase are copy-on-write clones of production that share
the same connection infrastructure. Perfect for testing config changes
that might affect query patterns.

### Step 3: flip the pooler mode on the branch

Via Supabase dashboard on the branch:
- Settings → Database → Connection Pooling → change to Transaction mode
- Note the new port (usually 6543)

### Step 4: run the full pg-batch suite against the branch

```bash
cd backend
# Point to the branch's DATABASE_URL with port 6543
DATABASE_URL="<branch-pooler-url>" npx vitest run tests/integration/pg-batch
```

Expected result: all pg-batch tests green. Any failure in a test
that was previously passing is a Transaction-mode incompatibility
that needs fixing in code before the real switch.

### Step 5: if tests green, flip production pooler mode

Supabase dashboard on the production project → Settings → Database →
Connection Pooling → Transaction mode.

**Railway env var**: update `DATABASE_URL` to use port 6543 instead of
5432. This is the critical step — the mode switch is per-port, not
global. Sessions still use port 5432.

```
railway variables set DATABASE_URL=<new-url-with-6543>
```

Railway will restart the backend on the new URL. Watch the deploy logs
for `pg-boss started` without the `MaxClients` error.

### Step 6: revert db-pg.js max back to 20

Once Transaction mode is live and stable for a week, reverting commit
`d5e397d` is safe — Transaction mode means the per-session cap is
gone and the app can have 20 concurrent transactions comfortably.

Commit message suggestion:

```
chore(db): restore pool max to 20 after Transaction-mode pooler switch

Follow-up to d5e397d: the max:10 reduction was a band-aid for the
Session-mode pg-boss startup race. With the pooler now running in
Transaction mode (DATABASE_URL port 6543), the per-session cap is
gone and restoring max:20 gives the app better headroom under load.
```

### Rollback plan

If Step 5 causes issues:

1. Immediately revert `DATABASE_URL` back to the 5432 port via
   `railway variables set`.
2. Railway auto-redeploys on env var change; the app returns to
   Session mode + port 5432.
3. Switch the Supabase dashboard back to Session mode on the
   production project.
4. Diagnose failures from the preserved Railway logs and fix
   code before retrying.

The Supabase branch from Step 2 is still around and can be
deleted later via MCP.

## Why the two-step approach (max:10 now, Transaction mode later)

- **max:10** is a pure code change, reversible via `git revert`,
  zero infra risk. Fixes the immediate user-visible issue (pg-boss
  startup race on every deploy) without committing to a larger
  architectural change.
- **Transaction mode** is the proper fix but requires a multi-step
  validation dance (branch, test suite, env var, watch logs). Not
  appropriate to rush in a post-merge sanity check.
- Doing both lets the immediate fix land today while the proper
  fix gets the careful rollout it deserves.

## Success criteria

- Next Railway deploy's startup logs show `pg-boss started` without
  the `MaxClientsInSessionMode` error, confirming max:10 fix works.
- (Eventually) pooler mode switched to Transaction, db-pg max
  restored to 20, pgboss.job shows active processing across
  container restarts without gaps.
- Supabase project dashboard's "multiple resources exhausting"
  banner clears (or at least doesn't call out connection pressure).

## Related

- Commit `d5e397d` — the max:10 band-aid
- Session notes 2026-04-11 — the original diagnosis
- `backend/CLAUDE.md` — DB pool + connection architecture docs
- Supabase Free tier plan — 60 max connections is the hard cap,
  ultimately the right answer is upgrading to Pro ($25/mo) for
  200+ connections
