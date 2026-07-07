# Super-Admin Roadmap — everything beyond the admin-refresh branch

Created: 2026-07-08 · Predecessor: `docs/fable5/admin-refresh/PLAN.md` (scopes a–d, BUILT on `feat/admin-refresh`)
Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

This is the self-paced backlog that brings /admin to industry standard. Batches are
ordered by value-at-current-scale (29 tenants, solo operator). Each batch is designed to
be one branch + one review. Items inside a batch are ordered by dependency.

## Operating rules (apply to every batch)

- Branch off `main` per batch (`feat/admin-b<letter>`), push the branch only — never main.
- Conventions: `adminFetch()` not api.js; self-contained `--ui-*` tokens (no ui/primitives);
  `requireAllowedIp` + `requireSuperAdmin` + `logAdminAction` on every mutation;
  schema-qualified queries with slug re-validation; per-tenant try/catch on fanout.
- Expensive cross-tenant introspection goes through `public.infra_cache` written by a
  worker — never live per-request fanout.
- Tests: `backend/tests/integration/pg-admin-*.test.js`, run with
  `npx vitest run --no-file-parallelism` from `backend/` (parallel tenant provisioning
  exhausts local PG lock memory). Migrate local test DB first if stale.
- **New worker rule**: any new pg-boss worker needs its Railway `*_WORKER_ENABLED=1` var at
  deploy time. The worker-status panel now flags forgotten ones (`ENV VAR MISSING`) —
  check it after every deploy that adds a worker.
- Verify against local admin (`admin@local.test` / `LocalAdmin123`, golv fleet) before push.

---

## Batch 0 — decisions & env vars (no code, 15 minutes)

- [ ] **0.1** Decide `SHIFT_AUTO_CLOSE_WORKER_ENABLED=1` on Railway (worker has never run
      in prod; panel currently flags it). Set it or consciously leave it off.
- [ ] **0.2** Decide `ADMIN_ALLOWED_IPS` posture. If your IP is dynamic, leave unset and
      rely on Batch B (2FA) as the compensating control — but write that decision down here.
- [ ] **0.3** Decide `ANTHROPIC_API_KEY` on Railway (AI insights currently dead in prod).
- [ ] **0.4** Run `/check-services` (overdue since 2026-07-01) and make it a weekly habit.
- [ ] **0.5** Merge `feat/admin-refresh` into main and deploy — every later batch builds on it.

---

## Batch A — §4 ride-alongs (small, high value, already scoped)

### A1 `[ ]` logAdminAction gap closure (S)
Every admin mutation must write `admin_activity_log`.
1. Grep every `app.(post|put|delete)` in `backend/routes/admin/*.js`; list routes missing
   `logAdminAction` (known: tax-rates CRUD + tax-rate-suggestions PUT in `compliance.js`;
   email-queue retry/send-now/delete/purge in `messaging.js`; announcements POST/PUT/DELETE;
   backup `verify` in `system.js`). Verify the list against current code — don't trust this note.
2. Add `logAdminAction(req.admin.email, "<action>", ...)` to each, matching existing naming
   (`snake_case` verbs: `tax_rate_created`, `email_queue_retried`, `announcement_updated`, …).
3. Test: one integration file asserting an `admin_activity_log` row lands for each
   previously-uncovered mutation.

### A2 `[ ]` Targeted announcements (per plan / per industry) (M)
1. Migration (public schema, new `MIGRATIONS` entry in `migrate-pg.js`): add
   `audience_plan TEXT NULL` and `audience_industry TEXT NULL` to `announcements`
   (NULL = everyone; comma-separated lists are fine at this scale).
2. **Verify first** how `GET /api/announcements/active` is called by
   `ui/AnnouncementBanner.jsx` — it's public and mounted before tenant middleware, so the
   filter needs the caller's slug (`?tenant=`). Resolve plan from the registry row and
   industry from `tenant_<slug>.company_profile.industry_type` (one cached lookup; add a
   60s in-memory cache keyed by slug).
3. Admin create/update UI: two selects on the Dashboard announcements card — Plan
   (all/free/pro) and Industry (all + the 23 presets from `industryLabels.js`).
4. Tests: active endpoint returns/filters correctly for a matching and a non-matching tenant.

### A3 `[ ]` Impersonation session list + revoke (S)
Backend mostly exists (`impersonation_sessions`, `POST /api/admin/impersonate/:sessionId/end`).
1. New `GET /api/admin/impersonation-sessions?active=1` — masterDb query joined to tenants;
   active = `ended_at IS NULL AND revoked_at IS NULL AND started_at > NOW() - interval '1 hour'`
   (tokens are 1h). Return jti presence, admin id, tenant, started_at.
2. UI: "Impersonation" card on `/admin/activity` — active sessions with a Revoke button
   (calls the existing `/end` route), plus last-20 history.
3. Test: start impersonation via API, list shows it, revoke ends it, token's jti lands in
   the tenant's `revoked_tokens`.

### A4 `[ ]` Feature-adoption matrix (M)
Which tenants use which modes/flags — drives roadmap decisions.
1. Worker: extend the hourly orphan-scan pattern — new pg-boss worker
   `adoption-snapshot-worker-boss.js` (env `ADOPTION_SNAPSHOT_WORKER_ENABLED`) that fans out
   per active tenant: enabled flags count + list, enabled modes, and the vertical-usage
   counts (reuse `VERTICAL_USAGE_SOURCES` — export it from `routes/admin/tenants.js` or move
   to a shared module). Write one `infra_cache` row, key `feature_adoption`.
2. Endpoint: `GET /api/admin/adoption` reads the cache (`?force=1` = live recompute).
3. UI: new `/admin/adoption` page — matrix table: rows = tenants (industry-labelled),
   columns = 10 modes (✓/count), plus a per-flag adoption summary ("wholesale_backorders:
   3/29 tenants"). CSV export.
4. Deploy note: set the Railway env var; worker-status panel gains its slot
   (follow the 5-step checklist in `backend/CLAUDE.md` "Workers — adding a new one").
5. Tests: worker `runSnapshot(db)` unit-ish test against seeded schemas; endpoint cache hit/miss.

---

## Batch B — admin account security (the biggest standards gap)

> Sequence 2FA as its own commit with its own tests; verify login manually before merging.
> Touches `routes/admin/auth.js` + `helpers.js` — the only high-regression-risk area in this roadmap.

### B1 `[ ]` Admin 2FA (TOTP) (M)
1. Dep: `otplib` (backend only).
2. Migration (public): `super_admins` + `totp_secret TEXT`, `totp_enabled_at TIMESTAMPTZ`,
   `recovery_codes JSONB` (array of bcrypt hashes).
3. Enrollment endpoints (both behind `requireSuperAdmin` — you must be logged in to enroll):
   `POST /api/admin/auth/totp/setup` → generates secret, returns `otpauth://` URI + secret
   (render QR client-side with a tiny QR lib, or display the secret for manual entry);
   `POST /api/admin/auth/totp/verify` → checks first code, sets `totp_enabled_at`, returns
   10 one-time recovery codes (store hashed, show once).
4. Login flow becomes two-step when enabled: `POST /api/admin/auth/login` with valid
   password returns `{ totp_required: true, pending_token }` (short-lived 5-min JWT,
   scope `admin_totp_pending`, unusable on any other route); `POST /api/admin/auth/totp`
   with `{ pending_token, code }` (accepts TOTP or a recovery code, burns recovery codes on
   use) returns the real admin token. Rate-limit the totp endpoint hard (5/15min).
5. `POST /api/admin/auth/totp/disable` (requires current code) + `logAdminAction` on
   enable/disable; `admin_security_log` events for totp_success/totp_failed.
6. Frontend: second step on `AdminLogin.jsx`; enrollment card (QR/secret + confirm code +
   recovery codes display) — put it on a tiny new `/admin/security` page (also hosts B2).
7. Tests: enrollment, wrong code, pending-token can't hit other routes, recovery code
   single-use, disable.
8. **Manual gate before merge**: enroll + log in end-to-end on local, and confirm you've
   saved recovery codes for the prod account before enabling there.

### B2 `[ ]` Session hardening (S/M)
1. Shorten admin access token to 1h (currently 24h) + add a refresh flow: `admin_sessions`
   table (public) with hashed refresh token + jti, `POST /api/admin/auth/refresh`, rotation
   on use. Mirror the tenant refresh pattern in `routes/auth.js` — don't invent a new one.
2. `adminFetch` gains silent refresh-on-401-TOKEN_EXPIRED (mirror tenant AuthProvider,
   but simpler — one retry). **Remember `AdminTaxRates.jsx` has its own local `adminFetch`
   duplicate — update both or consolidate them first.**
3. Active-sessions list + "revoke all other sessions" on `/admin/security`.
4. Tests: refresh rotation, revoked session rejected.

### B3 `[ ]` Login anomaly alerting (S)
1. On successful admin login, compare IP against the last 30 days of
   `admin_security_log` login_success IPs; unseen IP → `alertEmail` ("New admin login from
   <ip>") — fire-and-forget.
2. Test with a fake log history.

---

## Batch C — analytics foundation + flag ops

### C1 `[ ]` Tenant lifecycle event capture (M) — **build early; data can't be backfilled**
1. Migration (public): `tenant_lifecycle_events (id, tenant_id, event TEXT, metadata JSONB,
   created_at TIMESTAMPTZ DEFAULT NOW())` + index on (event, created_at).
2. Inline writers (cold paths only — never the POS hot path):
   - `signup` → `routes/auth.js` self-service signup + `routes/admin/tenants.js` create
   - `setup_completed` → `routes/setup.js` wizard completion
   - `trial_extended` / `expired` / `payment_recorded` / `plan_changed` →
     `routes/admin/billing.js` + subscription-grace worker transitions
   - `suspended` / `activated` / `deleted` → tenant lifecycle routes
   All writers: fire-and-forget try/catch — an event insert must never fail the action.
3. Derived events via nightly worker (`LIFECYCLE_DERIVE_WORKER_ENABLED`, or fold into the
   A4 adoption snapshot worker to avoid another env var): `first_sale`, `first_week_active`
   (≥3 active days in first 7), `dormant_30d` — computed from tenant schemas, inserted
   idempotently (`ON CONFLICT` on a (tenant_id, event) unique partial index for one-time events).
4. Emit nothing user-visible yet — this batch is pure data capture for Batch E.
5. Tests: each writer emits; derive job idempotent.

### C2 `[ ]` Global flag kill switch (S)
1. `POST /api/admin/feature-flags/global` — body `{ key, enabled, confirm }` where
   `confirm === key`. Validate key ∈ `DEFAULT_FEATURE_FLAGS` ∪ known DB flags. Fan out
   upsert per active tenant (per-tenant try/catch), `invalidateFeatureFlagCache()` (global),
   `logAdminAction` with per-tenant result counts. Return `{ updated, errors }`.
2. UI: "Flag operations" card on `/admin/adoption` (pairs naturally with the matrix):
   flag picker + on/off + type-the-flag-to-confirm. Show adoption count for the chosen flag
   before you pull the trigger.
3. Tests: fan-out updates every seeded tenant, confirm guard, unknown key 400.

---

## Batch D — tenant intelligence

### D1 `[ ]` Tenant 360 timeline (M)
1. `GET /api/admin/tenants/:id/timeline?limit=100` — merge + sort desc:
   `tenant_audit_log`, `payment_records`, `tenant_lifecycle_events` (C1),
   `impersonation_sessions`, `admin_activity_log WHERE target_type='tenant' AND target_id=:id`,
   and per-tenant `support_tickets` (try/catch). Normalize to
   `{ at, source, title, detail }`.
2. UI: "Timeline" card on TenantDetail (replaces/absorbs the small Audit Log card).
3. Test: seed one row per source, assert merged ordering.

### D2 `[ ]` Per-tenant error rates (Sentry) (M)
1. Env: `SENTRY_API_TOKEN` (org `sanopos`) on Railway + local.
2. Worker job (fold into the adoption snapshot worker): query Sentry API for issues/events
   in the last 24h grouped by `tenant` tag for both projects; write `infra_cache` key
   `tenant_errors`. Never call Sentry per admin request (rate limits).
3. `GET /api/admin/tenant-errors` reads cache. UI: errors column in the tenant list
   (red badge when >0) + card on TenantDetail linking to the Sentry search URL.
4. Test: cache read path with a seeded infra_cache row (mock the Sentry fetch in the worker test).

### D3 `[ ]` Tenant health score (M) — needs D2 + C1
1. Score 0–100 computed in the snapshot worker per active tenant:
   activity recency (last_login / last sale), sales volume trend (this week vs 4-week avg),
   errors 24h (D2), FBR failed count, open support tickets, plan-limit pressure.
   Weights in one exported constant — tune later, don't over-engineer.
2. Store in the `feature_adoption` / new `tenant_health` infra_cache payload.
3. UI: health column in tenant list (green/amber/red, replaces the current heuristic
   `healthDot` which only looks at last login) + breakdown tooltip on TenantDetail.
4. Test: scoring function is pure — unit test with fixture inputs.

---

## Batch E — platform analytics dashboard (after C1 has ≥4–6 weeks of data)

### E1 `[ ]` /admin/analytics page (L)
1. Backend `GET /api/admin/analytics` (masterDb + lifecycle events; cache 5 min in-memory
   like `/api/admin/infra`):
   - Signups/week (12 weeks), by industry (uses the industry enrichment)
   - Activation: `setup_completed / signup`, `first_sale / setup_completed` rates
   - Trial funnel: active trials, trial→paid conversion rate, avg days-to-convert
   - MRR/ARR: actuals from `payment_records` + committed from active pro × `plan_pricing`;
     keep the existing revenue-stats card as the summary, this page is the detail
   - Churn: deleted or expired-past-grace per month, by plan and industry
2. UI: stat tiles + simple tables/bars (Recharts is already a dep in the tenant app —
   check whether the admin bundle should import it or stay table-based; tables are fine).
3. Mark honestly on the page which metrics are derived from `created_at` history (OK today)
   vs. lifecycle events (accurate only after C1's deploy date).
4. Tests: analytics endpoint shapes against seeded registry rows + events.

---

## Batch F — compliance & data tooling

### F1 `[ ]` Per-tenant data export (S/M)
1. Existing: `pg_dump`-to-R2 backup covers full-fleet. Add
   `POST /api/admin/tenants/:id/export` — single-schema `pg_dump` to R2, returns a
   short-lived download link; `logAdminAction`. (Check `utils/backup-pg.js` — most pieces exist.)
2. UI: Export button on TenantDetail actions row.

### F2 `[ ]` Hard-delete verification + retention policy (S)
1. Extend tenant delete: optional `{ anonymize: true }` also nulls
   `owner_email`/`name` on the registry row and purges the tenant's rows from public-schema
   cross-tenant tables (`email_queue` legacy, `payment_intents`?, lifecycle events —
   enumerate and verify each against the schema first).
2. `GET /api/admin/tenants/:id/deletion-check` — verifies schema absent + lists any
   remaining public-schema references.
3. Write `docs/fable5/admin-roadmap/RETENTION.md`: what's kept after delete, for how long,
   and why (audit rows are kept intentionally).

---

## Backlog — standard elsewhere, deferred with explicit triggers

| Item | Build when |
|---|---|
| Admin RBAC (owner vs support-agent roles) | first non-you admin user |
| Admin SSO (SAML/OIDC), access reviews | first enterprise buyer asks |
| Public status page (status.sanopos.com) | first customer asks / >100 tenants |
| API usage & rate-limit dashboard | limiters get persistent storage for another reason |
| Billing ops: coupons, proration, dunning UI, revenue recognition | real payment gateway live (not sandbox) |
| Percentage/cohort flag rollouts | tenant count makes all-or-per-tenant too coarse (~100+) |
| In-app NPS / feedback capture | after health score proves insufficient signal |
| Global cross-tenant search (customer/order by phone) | first support case where you actually need it |
| Email deliverability stats (Resend API) | first deliverability incident |

---

## Suggested order of execution

```
0 (decisions) → A (ride-alongs) → C1 (events — start the data clock!) → B (security)
→ C2 → D1 → D2 → D3 → E1 (once events have matured) → F
```

C1 is deliberately early even though its payoff (E1) is late — every week without event
capture is funnel data lost forever. If you only have one short session, do 0 + C1.
