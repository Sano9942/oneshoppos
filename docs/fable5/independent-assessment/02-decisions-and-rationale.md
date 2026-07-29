# Decisions and Rationale

**Date:** 2026-07-29 · **Participants:** owner (Hassan Siddiqui) + independent assessment
**Purpose:** so that a future session — human or AI — knows what was decided, why, and what was deliberately rejected.

Read this before changing direction. Several of these decisions look wrong out of context and are correct in it.

---

## The framing facts everything rests on

Established by live production query, 2026-07-29. These are measurements, not opinions.

| Fact | Value |
|---|---|
| Real revenue ever collected | **PKR 0** — all 6 payment records and 7 payment intents are `gateway='sandbox'` |
| External merchants, current | **0** — 33 of 36 tenants are owner-created fixtures; the 2 plausibly-external ones were deleted months ago |
| Lifetime sales | 59, across 5 tenants, all owner walkthroughs |
| Sales trend | Apr 11 → May 36 → Jun 10 → **Jul 2** (declining) |
| Verticals with zero production rows, ever | **8 of 10** |
| Verticals with any data | Retail POS, wholesale, restaurant/KDS |
| Owner capacity | Part-time, evenings and weekends (~10–20 hrs/week) |
| Times the product has been seriously offered to a merchant | **0** — "waiting until it's ready" |

---

## D1 — Sell now, fix in parallel. **(The core decision.)**

**Decided:** Get a first merchant within ~2 weeks. Do not wait for the defect list to be cleared.

**Why.** Three constraints were in tension:

| Constraint | Owner's position |
|---|---|
| **Scope** | Fix everything, keep everything |
| **Sequencing** | Waiting until it's ready before selling |
| **Capacity** | 10–20 hrs/week |

**Any two are survivable. All three together is 16–25 months to first customer** — roughly 1,000–1,600 hours of remaining work at ~15 hrs/week, assuming no regressions, no new features and no new findings, while this audit only sampled.

Critically: *"fix everything"* and *"sell now"* are **not** in conflict. They collide only when *"fix everything **first**"* is added — and that third constraint was never explicitly chosen. It emerged from "waiting until it's ready."

Relaxing **sequencing** is the cheapest of the three. It costs no code and no money. It preserves the full fix-everything scope and every line of the codebase. It only costs the discomfort of shipping something imperfect.

**Rejected alternatives:**
- *Cut/mothball the 8 unused verticals* — recommended by the assessment, **declined by the owner.** Owner's call, recorded, not re-litigated. Cost is stated in D2.
- *Fix everything first, then sell* — this is the status quo that produced 1,923 commits and zero customers.
- *Go full-time* — not available.

**Do not reverse this without new evidence.** The evidence for it is the production database, which recorded 59 sales, none from a customer, over a year of waiting to be ready.

---

## D2 — Keep all code and all ten verticals

**Decided:** Nothing is deleted or disabled. The full fix scope stands.

**Owner decision, made after the assessment recommended narrowing.** Recorded as final.

**Stated cost, once, for the record:** the eight verticals with no production data continue to accrue maintenance — schema, migrations, tests, docs, and a share of every cross-cutting fix. The full remediation list at ~15 hrs/week is the 16–25 month figure in D1. This is the price of the choice and it is the owner's to pay.

**Important:** D1 makes D2 affordable. Keeping everything is only expensive if everything must be perfect *before* revenue. It isn't.

---

## D3 — First merchant: retail or a small café. Wholesale second.

**Decided:** Prove the loop on the simplest vertical; go at wholesale as customer 2–3.

**Why.** The owner has built most heavily in retail, wholesale and café/restaurant — and those are the only three areas with production rows. Effort and usage agree, independently. That is the slice to sell.

Within it:
- **Retail/café** — lowest onboarding cost, fewest moving parts, most candidates, and the POS core is the best-tested path in the codebase (`cartMath` is unit-tested three ways; the sale write path has the most gates).
- **Wholesale** — the actual moat. Credit/AR, field sales, MOQ, manufacturer portal. Nobody else in Pakistan combines these. Test data shows **~PKR 43,800 average transaction value against retail's ~2,300** — wholesale merchants have more to lose and more to pay with.

Start retail/café because onboarding a distributor part-time while also learning how to support a live merchant is two hard things at once.

---

## D4 — Dual-run the pilot for two weeks

**Decided:** The pilot merchant keeps their existing system (paper or otherwise) running alongside SanoPOS for the first two weeks.

**Why this is not just caution.** It removes catastrophic downside — if something breaks, their business doesn't stop and the relationship survives. But the real value is that **a daily reconciliation of their books against the `sales` table is the closest thing to an end-to-end money-path test this codebase has ever had.** With eight competing stock writers, a price-authority gate that fails open, and no integration tests running in CI, a real merchant's independent ledger is a better oracle than anything currently in the repo. It is free and it runs itself.

---

## D5 — Pilot scoping keeps the open P0s out of reach

**Decided:** For the pilot — **storefront disabled** (that is P0-1's entire blast radius), **invoice manually** (bypasses P0-2's billing webhook), **CSV import only, never XLSX** (P0-4's `xlsx` exposure path is user-uploaded files).

This is what makes "sell before fixing everything" defensible rather than reckless. The four P0s are real, but three of them are cheap to fix and the fourth is bounded by configuration.

---

## D6 — ADR-002 stays **Accepted**. Do not demote it.

**Question raised:** should ADR-002 be reverted to Proposed like the other eleven, since an Accepted ADR "might change the direction of AI"?

**Decided: no.** Reasoning:

1. **It is a product-scope decision, not an implementation instruction.** ADR-002 says *what to launch and what to freeze* — Pakistan-first, Commerce + Food Service, other verticals Experimental. It does not tell anyone to build anything. Contrast ADR-004 (repository/stack), ADR-005 (tenant placement) or ADR-007 (edge sync) — those are implementation-directing and are correctly **Proposed**. The distinction is the safeguard, not the status field.
2. **It is the only vNext document corroborated by production data.** ADR-002 was ratified 2026-07-17 naming Commerce + Food Service. The 2026-07-29 database query found rows in exactly retail, wholesale and restaurant. The ADR was right, independently.
3. **It carries the freeze clause** — *"New vertical development freezes until launch foundations are Production."* Demoting it removes the only written brake on the vertical sprawl that is the single largest cost driver in this codebase. Under D1/D2 that brake matters more, not less.
4. **The AI-direction concern is already handled elsewhere.** `CLAUDE.md` instructs that the vNext package is Proposed-target-only and must never be implemented from or cited as current behaviour. That guard is the right place for this concern. Weakening a correct decision to compensate for a documentation-hygiene worry trades a real asset for an imagined risk.

**Verified while answering this:** all other eleven ADRs are `Status: Proposed`, including ADR-007 (an earlier grep matched the word "accepted" in its body text, not its status). `CLAUDE.md`'s claim that only ADR-002 is Accepted is **correct**.

**If the concern persists**, the right fix is a one-line clarification in the ADR README distinguishing *scope decisions* (safe to accept) from *architecture decisions* (implement only after explicit instruction) — not demoting the one decision that reality has confirmed.

---

## D7 — International expansion has two hard gates

Owner's goal is Pakistan → UAE → US/UK. Both of these are from the assessment and neither is negotiable by wishing:

- **UAE means Arabic means RTL.** ~4,960 string-extraction sites, ~845 physical margin/padding utilities against **exactly one** logical utility in the entire codebase, `lang="en"` hardcoded. A 6–10 week project that grows with every page added — which is an independent argument for the ADR-002 freeze.
- **UK/EU means the field-rep feature becomes a liability.** Mandatory GPS plus facial imagery, no consent capture, no retention limit, no deletion path, no subject access, asymmetric access against the worker. Engages GDPR Art. 5(1)(c)/(e), 13, 15, 17 and 35 simultaneously. **Do not sell into the UK or EU until that capture flow is rebuilt.**

Pakistan → UAE → UK/US is the correct order regardless, and this is why.

---

## D8 — On the "sellable asset" goal

Both goals (operating business + sellable asset) point the same way: **one paying merchant raises the price more than any amount of additional code.** Zero-revenue codebases sell on an asset basis, a fraction of a revenue multiple. A diligence process would surface exactly what this assessment did — four P0s, zero human code review, production credentials in the repo, Dependabot disabled.

Against that, the IP is real: working schema-per-tenant isolation at 29 tenants, FBR integration, and unusual drift-guard discipline.

**Also write the infra-access and credential-recovery document.** It exists nowhere, an acquirer will demand it, and it is the only mitigation for bus-factor-1.

---

## What we learned about method (worth keeping)

**A source-reading audit cannot find code that has never run.** The incoming `platform-architecture-claude-report` is a genuinely good document — graded evidence, live verification, honest limits, and it corrected three project-doc claims. It still missed all four P0s, because every one of them is code that has *never once worked*: a query against a table that doesn't exist, 42 audit writes to phantom columns, a webhook that can't be atomic, a monitor watching the wrong host. Reading tells you what code means to do. Only running it tells you what it does.

The recursion is the lesson: the reason nobody caught them is the reason they exist — no executing test suite.

**Documentation written ahead of code became a specification for a bug.** A planning doc stated that storefront checkout creates `storefront_cart_reservations`. The webhook was written against that sentence. The table was never built. Docs that describe a system confidently enough get coded against instead of the schema.

**The single pathology behind every finding:** *the control was built, and never closed against reality.* 42 audit hooks that never wrote a row. 334 test files, 36 unloadable, nothing reporting it. Eight drift guards pointed at code style, none at whether money moves correctly. `@axe-core` installed, imported nowhere. A monitor returning 200 during a total database outage. A focus trap documented in two files and absent from the code. It takes real effort to build those things — this is not carelessness. It is treating the existence of a mechanism as proof of its function.

That pattern operates at company scale too: building and documenting both feel like progress and neither requires contact with a customer.
