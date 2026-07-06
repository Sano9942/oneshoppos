# SanoPOS vs Modern Practice — Scorecard & Gap Report

> Compiled 2026-07-06. Sources: `modern-pos-playbook.md` (how Square/Toast/Shopify do it)
> and `sanopos-platform-audit.md` (how SanoPOS does it, code-verified this session).
> Verdicts are judged **at your scale** — solo developer, ~300-tenant ceiling on current
> infra. A pattern absent from SanoPOS only counts as a GAP if it matters at that scale.
> Tone: brutally honest, as requested.
>
> Verdict key: ✅ ALIGNED · 🟡 PARTIAL · 🔴 GAP · ⚪ N/A at your scale

---

## The headline, up front

Your instincts independently reinvented more of the modern playbook than you think:
schema-per-tenant with an ALS proxy, preset→mode→flag fan-out, tax/price snapshots on sale
lines, adapter patterns for every integration, `FOR UPDATE` on money paths, a real
subscription state machine. Structurally you are much closer to Shopify's modular monolith
than to a hobby project.

Where you are genuinely behind modern practice is not architecture — it's **transactional
discipline and shipping discipline**: no idempotency keys anywhere, last-write-wins edits,
an offline queue that can double-fire, unverified inbound webhooks, and a deploy pipeline
with no merge gate over a test suite that is already red. Those are the things that
separate "works in the demo" from "survives a flaky Karachi network on a Saturday rush" —
and they're all fixable at solo-dev effort levels.

Score: **4 aligned, 5 partial, 3 gap** across the 12 categories.

---

## Category verdicts

### 1. Code organization — 🟡 PARTIAL

**They:** domain-grouped code with boundaries *enforced by a tool* (Shopify's Packwerk
fails CI on cross-package reaches; Square's OWNERS files gate review).
**You:** domain-grouped route/service files, the `deps` injection pattern, and a
CLAUDE.md tree as the boundary documentation.

The shape is right — this IS the modular-monolith layout. What's missing is enforcement:
nothing stops `routes/sales.js` from reaching into any table or requiring any service.
Your boundaries hold only as long as you (and your AI sessions) remember them, and your
own memory files record boundary violations recurring ("POS-fixed-storefront-broken",
shared-concern bugs needing all-call-path audits). At one developer this is survivable;
it's the first thing that breaks when a second contributor (human or parallel agent
sessions) touches the code. **Verdict: right structure, zero enforcement.**

### 2. Data model — 🟡 PARTIAL (contains your single worst gap)

**They:** one canonical object per concept + five iron rules: idempotency keys, optimistic
versioning, snapshots, state machines, server-authoritative math.
**You, rule by rule:**

| Iron rule | SanoPOS status |
|---|---|
| One shared spine, verticals extend | ✅ Genuinely aligned — every vertical lands in `sales`; restaurant/rental/clinic tables extend, never fork |
| Snapshot at transaction time | ✅ Per-line tax snapshot (v83), price on sale lines, applied-promotion freeze (`sale_promotion_applications`) |
| Server-authoritative math | ✅ `/api/sales` recomputes through the unified pricing path |
| State machines | 🟡 Status columns exist everywhere, but transitions are enforced per-route by hand — no shared transition guard; the tier4 PO vs transfer status vocabularies don't even agree (capitalized vs lowercase) |
| Optimistic versioning | 🔴 Absent. Every shared mutable object (products, prices, settings) is last-write-wins — two dashboard tabs, or dashboard + import, silently clobber each other |
| **Idempotency keys** | 🔴 **Absent everywhere.** No write path — not `/api/sales`, not returns, not adjustments — accepts a client key and dedupes. A timeout + retry, or an offline-queue replay after an ambiguous failure, creates a second sale and decrements stock twice |

The idempotency gap is the single most important finding in this document. All three
modern platforms treat it as non-negotiable on money paths, precisely because POS networks
are flaky — and your market's networks are flakier than theirs.

### 3. Multi-tenancy — ✅ ALIGNED (at your scale)

**They:** shared tables + tenant column + horizontal sharding (needed for millions of sellers).
**You:** schema-per-tenant + ALS proxy + transaction pooler.

At 300 tenants, schema-per-tenant is a *defensible and arguably better* choice: hard
isolation, per-tenant backup/restore, no `WHERE tenant_id` bugs possible. The proxy trick
(route code never sees tenancy) is exactly the right indirection. Known costs you're
already managing: O(tenants) migrations per deploy, orphan schemas, one shared 20-conn
pool. This only becomes wrong at ~thousands of tenants — a problem you'd be lucky to have,
and a migration you'd fund with the revenue that caused it.

### 4. Verticals & feature gating — 🟡 PARTIAL

**They:** four separate systems — entitlement (billing) ∧ mode (business type) ∧ setting
(merchant toggle) ∧ rollout flag (temporary, deleted) — each with its own lifecycle.
**You:** preset → modes → flags is architecturally the same fan-out Square's "modes" do,
and your 23 presets are *richer* than Square's 7 modes. Genuinely good.

The gap: **one `feature_flags` table plays all four roles at once.** The same key namespace
holds permanent entitlement-ish switches, merchant settings, mode-derived unlocks, and
rollout gates — distinguishable only by code comments. Consequences already visible in your
own memory: a three-stage seed lifecycle you have to document to remember, reconcile
scripts (`reconcile-mode-flags.js`) to repair drift, and flags that are "ON but decorative."
Plan gating meanwhile checks `plan === 'free'` by name in middleware — the exact pattern
Square's capability-profile indirection exists to avoid (they repackaged 18 subscriptions
into 3 plans without touching feature code; you couldn't restructure plans without editing
middleware). At two plans this is cheap; it gets expensive the day you add a third.

### 5. Permissions & staff identity — ✅ ALIGNED

**They:** permission sets as data, per-surface gating, device auth ≠ person attribution,
inline manager elevation.
**You:** roles + `role_permissions` as data (editable per tenant), ~40 grained permission
strings, four shipped role templates, PIN-based person attribution on a logged-in device,
inline manager-PIN elevation for void/comp/price (with the nice touch of refusing
impersonating super-admins), separate kiosk token scope, five isolated JWT universes.

That's the modern pattern, roughly complete. Minor deltas not worth chasing at your scale:
no per-surface declaration on roles (POS vs dashboard access is implicit), no
read/write/settings split per domain, no delegated-admin permission. Your own feedback
memory ("audit all endpoints when adding a narrow role") shows the real risk is coverage
consistency, not model design.

### 6. Time & labor — 🟡 PARTIAL

**They:** ScheduledShift vs Timecard as separate objects, wage snapshot on the timecard,
approval-gated edits, geofenced clock-in.
**You:** schedules and attendance sessions ARE separate records ✅; geofenced GPS+selfie
check-in for field reps is genuinely ahead of baseline ✅; kiosk PIN clock-in ✅.

Gaps: no wage snapshot on attendance rows (payroll reads current wage — a raise silently
rewrites history), no edit-request/approval workflow (whoever has the permission edits the
record directly, no reconciliation trail), and the known local-time storage trap that has
already produced the midnight–5AM checkout bug. Labor is where "history never rewrites"
discipline is weakest.

### 7. POS client — ✅ ALIGNED (different idiom, same substance)

**They:** composable state machines (Workflow) / RN over local DB.
**You:** one context composing ~8 domain hooks, pure extracted cart math, preset-driven
layout, keyboard-first, server recompute at checkout.

You don't need Workflow — that solves a hundreds-of-engineers-in-one-app problem. What
matters at your scale is: is POS state centralized and testable (yes — `POSContext` +
pure `cartMath.js`), and is money math server-authoritative (yes). The restaurant overlay
riding the same context instead of forking it is the correct instinct. Aligned.

### 8. Offline — 🔴 GAP

**They:** bounded visible sessions, merchant-set exposure caps, versioned local catalog
replica, UUID+idempotency-keyed replay, honest "pending" sync state, deliberately tiny
offline surface.
**You:** a best-effort IndexedDB fallback queue (sale/return/check_in/field_order), no
local catalog, no bounded session, no visible sync state, and — because of the Category 2
gap — **replay with no server-side dedup**. An ambiguous failure (request reached the
server, response lost) queued and replayed is a double sale.

To be fair to yourself: cash-first Pakistan means offline *card capture* is rightly out of
scope, and the field-rep PWA is the one place offline is treated seriously. But what
exists today is the dangerous middle: enough offline to replay writes, not enough
discipline to make replay safe. Either shrink it (queue nothing but check-ins until
idempotency lands) or finish it (idempotency keys + pending-state UI). The current state
is the worst of both.

### 9. Billing & subscription lifecycle — ✅ ALIGNED

**They:** plan → capability profile, quotas, self-service trial/switch, entitlement
changes as data.
**You:** free/pro with a real trial→grace→expired state machine, worker-driven
transitions + lifecycle emails, gateway adapter with HMAC-verified webhook and manual
fallback, enforcement middleware, global UI banner.

For a two-plan platform this is complete and honest. The plan-name-check smell is filed
under Category 4; quotas (your plan *limits* on outlets/employees/products) exist and are
enforced on POST. Nothing here needs to change until the pricing model does.

### 10. Integrations — 🟡 PARTIAL

**They:** contract-first adapters, verified webhooks, event-driven sync.
**You:** the adapter pattern is applied with unusual consistency (couriers ×13,
marketplaces ×4, payments, SMS — all base-class + factory), credentials properly
encrypted (AES-256-GCM), FBR queue with real exponential backoff. That's textbook.

Two honest deductions: **inbound webhook verification is incomplete** — only xPay and
Shopify are signature-verified; Meta/WhatsApp/Daraz POST handlers accept unauthenticated
payloads (rate-limited is not verified). And parts of the sync layer are **decorative** —
the marketplace-sync worker's handlers are stubs that log intent without calling the
clients, and Google Merchant swallows per-item failures while reporting success. A
merchant looking at "synced ✓" is being lied to in those paths. Modern practice's real
rule here isn't the adapter pattern (you have it) — it's *report outcomes truthfully*.

### 11. Platform operations — ✅ ALIGNED (genuinely strong for one person)

**They:** internal admin tooling, observability, audited operator actions.
**You:** a super-admin panel most small SaaS companies would envy — impersonation with
jti revocation + audit + banner, worker heartbeats, orphan-schema detection, dead-letter
queue, infra monitor, announcements, per-tenant flag editor, backups to R2, Sentry +
structured logs + request IDs + alerting + uptime.

Deductions that keep it honest but don't change the verdict: admin action logging has
known holes (tax mutations, email retry, announcement edits skip `logAdminAction`), and
alerting counters are in-memory (reset on every deploy). At your scale: aligned, and
honestly over-built in a good way.

### 12. Shipping it — 🔴 GAP

**They:** nothing lands without green CI; incremental, sharded tests; merge-gated main;
backward-compatible contracts enabling independent deploys.
**You:** a large real test suite (integration + unit + Playwright + smoke) — and **none of
it gates anything.** Push to main → Railway + Vercel deploy, tests optional and run by
hand. Main carries ~57 pre-existing failing backend tests, so red doesn't mean broken —
which means green doesn't mean safe. The production E2E suite logs into a tenant that was
deleted and only *warns*, so a "passing" run proves nothing. Your own memory records the
consequence: a consolidation once silently dropped a fix from main and production
regressed with no alarm ringing.

This is the purest hobby-grade remnant in the platform, and the cheapest to fix relative
to its risk: one GitHub Actions workflow gating merge on a *curated* green subset (quarantine
the known-red files explicitly), plus failing the E2E run when global-setup login fails.
You don't need Kochiku. You need a red light that means something.

---

## Ranked gap list (what "not doing it right" concretely means)

1. **No idempotency keys on any money/stock write.** (Cat 2/8) Retries and offline replay
   can double-create sales and double-decrement stock. Modern platforms treat this as
   non-negotiable. Fix shape: client UUID per cart submit, unique-indexed column on
   `sales`, return the existing row on conflict. Small effort, eliminates a whole failure class.
2. **No CI merge gate + red main baseline + lying E2E.** (Cat 12) You cannot currently
   distinguish "safe to deploy" from "hope." Fix shape: quarantine known-red tests, gate
   main on the green subset in GitHub Actions, make E2E global-setup failure fatal.
3. **Offline queue replays without dedup or visible sync state.** (Cat 8) Consequence of
   #1; also needs a "pending" indicator so cashiers know what hasn't landed.
4. **Unverified inbound webhooks (Meta/WhatsApp/Daraz) + decorative sync workers.** (Cat 10)
   Forged-payload surface and false "synced" states. Verify signatures where the platform
   offers them; make stub workers say so or do the work.
5. **Last-write-wins on shared mutable objects.** (Cat 2) A `version` column +
   compare-on-write on products/settings stops silent clobbers between tabs/import/API.
6. **One flags table doing four jobs.** (Cat 4) Not urgent at two plans, but every new
   vertical makes the seed/reconcile choreography more brittle. Fix shape when it hurts:
   split entitlement resolution into a `can(feature)` capability profile; keep flags for rollout.
7. **No wage snapshots / labor edit approvals.** (Cat 6) History rewrites on raises;
   timecard edits are unaudited. Matters as soon as any tenant runs real payroll off it.
8. **Boundaries unenforced.** (Cat 1) Lowest urgency at one developer, but your recurring
   "fixed POS, broke storefront" class of bug is exactly what enforcement kills. Even a
   lint rule ("routes may not import other routes; money math only via services/") helps.

Everything else — microservices, service mesh, Workflow, LAN mesh offline, Bazel-scale
CI, shared-table sharding — is ⚪ **N/A at your scale**: adopting them now would be
cosplay, not engineering. The list above is the actual difference between you and
"modern," and none of it requires a team.
