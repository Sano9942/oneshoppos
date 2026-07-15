# AI Platform Strategy — Plan — 2026-07-15

Synthesis of three inputs: the NVIDIA infrastructure research
([`../../nvidia ai/nvidia-ai-research-conversation.md`](../../nvidia%20ai/nvidia-ai-research-conversation.md)),
a second external product review, and a global-framing reframe. Filtered against source.

- **What exists / doesn't:** [`VERIFIED-STATE.md`](VERIFIED-STATE.md) — read first
- **How it's built:** [`AI-GATEWAY.md`](AI-GATEWAY.md)
- **Global coupling inventory:** [`../public-surface-audit/GLOBAL-READINESS.md`](../public-surface-audit/GLOBAL-READINESS.md)

---

## 1. Decisions taken — 2026-07-15

| # | Decision | Consequence |
|---|---|---|
| D1 | **Global pivot = direction-of-travel, not committed.** Keep shipping PK-first. | AI/product work leads. Global coupling is recorded as debt behind one trigger (§6), not scheduled now. Resolves the question `GLOBAL-READINESS.md` asked on 2026-07-15 and never got answered. |
| D2 | **All three AI front doors — phased, in this order: in-app assistant → BYOK → MCP connector.** Order confirmed by owner. | The Gateway is designed for all three from day one so none needs re-architecting. "All of the above" is the destination; §5 is the order and the rationale. |
| D3 | **Drop `ADMIN_ALLOWED_IPS`.** | It currently fails open silently (`index.js:308` says so every boot). Remove it rather than keep false confidence. |
| D4 | **TOTP alone for `/admin` — no SSO.** | Solo operator; TOTP already enrolled. SSO adds an identity-provider dependency and a new failure mode for no gain at one admin. Revisit on the first admin hire. Closes D3's follow-on question. |
| D5 | **In-app assistant = bundled, capped per plan.** | Reuses `requirePlanLimit(resource)` — the cap machinery already exists (`middleware/plan-limits.js`). Free/Pro get N AI actions/month; upsell is a plan upgrade, not a new SKU. Bounds the token bill without building a new billing surface. |

### Why D1 is coherent

Worth stating plainly, because it looks like deferring bugs: **every piece of Pakistan coupling in
`GLOBAL-READINESS.md` is correct behaviour for a Pakistan-only product.** `targetCountry: "PK"` is
right. The 3 AM PKT night-audit cron is right. `|| "PKR"` is right. English-only UI is workable in
Pakistani business.

None of it is a bug *today*. That makes the global work **one blocking epic gated on a single
event** (§6), not a scattered set of fixes to sprinkle in. That's a better shape than the hybrid
option — you don't pay for global before you sell global.

---

## 2. What we are NOT doing

Recorded so it isn't re-proposed in six months.

| Not doing | Why |
|---|---|
| **Cameras, loss prevention, shelf vision, queue analytics, Jetson, DeepStream, Fleet Command, Omniverse** | A different company. Needs hardware per store, product-image datasets, calibration, false-positive tuning, privacy review, a vision team. The NVIDIA doc admits this ("not a quick software-only feature") and then spends six sections on it anyway. Revisit only if SanoPOS decides to become a retail computer-vision platform. |
| **Buying GPUs** (DGX Spark, RTX PRO 6000, Legion 9i, workstation) | No workload needs a local model. Self-hosting pays off at enormous volume, hard residency limits, or latency floors — none true at ~6 real tenants. That thread is about a personal workstation, not the software; it stays archived in the NVIDIA transcript. |
| **NVIDIA cuOpt** | You have **zero** routing code (`VERIFIED-STATE.md` §3). OR-Tools is free, CPU, open-source, and sufficient at your volumes. cuOpt wins only on problems far larger than any tenant you have. |
| **Migrating off Anthropic to NIM** | NIM becomes *one adapter* behind the gateway (`openai-compat.js`), not a migration. Benchmark after the gateway exists, not before. |
| **Rebuilding shipped verticals** | Review 2's roadmap for rentals / rooms / restaurant / wholesale / clinic describes V03–V10, already done. See `VERIFIED-STATE.md` §1. |
| **Cross-tenant benchmarks** | 23 of 29 tenants are demo tenants; real count ≈ 6. Needs ~20 per (country × vertical × size band). Design the consent flag and event schema when convenient — do not build the feature. |
| **i18n / TZ→UTC / courier roster** | Deferred under D1. See §6. |

---

## 3. The strategic frame

Two things neither review understood.

**Your differentiator is the spine, not the features.** Ten modes and twenty-three presets on one
schema, with Business Modules v2 letting a tenant switch verticals from a settings page, is rare.
Square doesn't run rentals + clinics + hotels + wholesale on one spine. Odoo does, but heavy. Both
reviews proposed *adding features*; globally you would lose that race against Square, Toast,
Lightspeed and Loyverse. The wedge is: **one spine, any vertical, new-mandate countries,
self-onboardable in an hour.**

**FBR is not a Pakistan moat — it's the first tax-authority adapter.** E-invoicing mandates are
spreading (India GST, Brazil NF-e, Italy SdI, Saudi ZATCA, Mexico CFDI, Poland KSeF, Turkey, EU
ViDA). India's GST is structurally near-identical to what you already built: IRN + QR + queue +
retry. You've run the adapter pattern three times (couriers, marketplaces, payments). The AI
application generalizes with it — *"classify this product into this country's tax schema from a name
in any language"* is the most manual part of onboarding in every jurisdiction, and it's exactly what
a language model is good at. This is `GLOBAL-READINESS.md`'s call, not a new idea here.

---

## 4. Phases

### Phase 0 — AI Gateway (the spine)

Everything hangs off this. See [`AI-GATEWAY.md`](AI-GATEWAY.md).

Provider-neutral layer, read-only tool surface, permissions via existing middleware, audit to
`action_history`, per-tenant provider/region/kill-switch columns. Current Anthropic usage becomes
the first adapter.

**Gate:** `PERMISSION_RULES` prefix-collision audit clean (AI-GATEWAY §4 — this has bitten twice);
no tool can reach another tenant's data; every returned number traceable to a named tool call.

### Phase 1 — Decision Center (first consumer)

The flagship. Turn `routes/insights.js` from descriptive to prescriptive: *"refund rate is 4× normal
at Outlet A"* with a **Review returns** button; *"three SKUs stock out in 4 days"* with **Create
draft PO**.

Feeds from what already exists: anomaly worker, ABC worker, expiry alerts, FBR queue, AR aging,
fulfillment, `insights/auto`. SQL computes; the model ranks, explains, drafts the next action.

**Gate:** every card cites its source and offers an action. No card asserts a number the model
computed.

### Phase 2 — Onboarding by photo and voice

**The highest-leverage AI work you have, and neither review mentioned it.** A shopkeeper with 3,000
SKUs will not type them. Catalog entry — not features — is what loses deals.

Extends what exists: auto-SKU, AI descriptions, `extractInvoiceLineItems`. Target: supplier invoice
photo → catalog; shelf photo → products; voice entry (Whisper or Gemini handle Urdu and Roman Urdu;
**NVIDIA Riva does not** — the NVIDIA doc is right about that and it's the one place to ignore its
vendor). Then deepen extraction from line-items into a **three-way match**: PO vs GRN vs invoice,
flagging quantity shorts, price drift, tax miscalculation, duplicate invoice numbers.

**Gate:** ≥98% accuracy on financial totals after deterministic validation (the NVIDIA doc's own
number, and it's right — below ~95% line-item accuracy saves no operator time). Measure
time-to-first-sale for a new tenant before and after.

**Also Phase 1: the cap (D5).** Add an AI-action resource to `requirePlanLimit`
(`middleware/plan-limits.js`) and a per-plan quota in `plan_pricing`. Ship the cap *with* the first
assistant, not after — an uncapped assistant is an unbounded bill, and retrofitting a limit onto a
feature tenants already use is a downgrade they will notice.

### Phase 3 — BYOK

Cheap once Phase 0 exists. `services/crypto.js`, per-tenant, write-only, revocable. Enterprise only.
Under D5, a BYOK tenant bypasses the plan cap — they're paying for their own inference.

### Phase 4 — MCP connector + OAuth server

The big one. ~2 days of tools, ~1–2 weeks of OAuth 2.1 authorization server. Read-only tools at
launch. See AI-GATEWAY §6c.

**Gate:** flow passes both Claude and ChatGPT connector validation; a revoked token loses access
immediately; no tool reaches beyond the authenticated principal's outlet scope.

### Phase 5 — FBR → tax-authority adapter

Strategic, not urgent. Refactor `services/fbr.js` + `workers/fbr-worker-boss.js` behind an adapter
interface so India GST is the second implementation, not a fork. Shapes every later compliance
integration. Pairs with an AI tax-classification tool (§3).

### Standalone — Technician dispatch + OR-Tools

The one real gap review 2 found. `service-tickets.js` has `assigned_to` and nothing else; there is
no routing code anywhere. One OR-Tools service fills both this and courier/van/field-rep routing.
Not AI. Not gated on Phase 0.

### Standalone — D3: remove `ADMIN_ALLOWED_IPS`

Small. Decided. Delete the fail-open check, confirm TOTP enforcement, scope SSO separately.

---

## 5. Order

```
Phase 0  AI Gateway  ─┬─► Phase 1  Decision Center      (in-app door)
                      ├─► Phase 3  BYOK                 (tenant-key door)
                      └─► Phase 4  MCP + OAuth          (subscription door)

Phase 2  Onboarding   — parallel, only loosely needs Phase 0
Phase 5  FBR adapter  — after Phase 0; shapes later compliance work

Standalone: OR-Tools + technician dispatch · remove ADMIN_ALLOWED_IPS
Epic G:     global unwind — gated, see §6
```

### Why this order (D2)

**The decisive argument is audience, not effort.** MCP only pays off for a tenant who *already* has
a Claude Pro or ChatGPT Plus subscription. Under D1 (PK-first), essentially none of your real
tenants do — a corner shop in Lahore is not paying $20/month for an AI subscription. **MCP is
quietly coupled to the global pivot and to enterprise customers, both of which D1 defers.**

So: the in-app assistant is the only door that reaches the market you actually serve today. It also
validates the tool surface while you control the UX. BYOK is nearly free once the Gateway exists and
serves the rare enterprise ask. MCP is last — the OAuth server is the single largest chunk of work
in this document, and it's worth building against a tool surface already proven by Phases 1–2, at a
point where the audience exists.

**The corollary is uncomfortable and worth stating:** the token bill is unavoidable for the PK
market. There is no door that shifts inference cost onto a tenant who has no AI subscription and no
API account. That's what makes D5 (bundled + capped) load-bearing rather than housekeeping — the cap
*is* the cost control.

---

## 6. Epic G — the global unwind (gated, not scheduled)

Under D1 this is **debt with a trigger**, not work.

**Trigger: the first non-Pakistan tenant signs.** At that point Epic G becomes blocking, in this
order (from `GLOBAL-READINESS.md` §6):

1. **i18n layer** — the true blocker. No library, 2 files using `Intl`, one `dir="rtl"` on an Urdu
   textbox. An English-only POS is unsellable to a cashier in São Paulo or Riyadh at any price.
   *This is also a legitimate AI application* — extracting hardcoded strings and translating them is
   tedious for humans, cheap for models.
2. Night-audit cron — one singleton at 3 AM PKT; a Mexico City hotel audits mid-afternoon
3. Google Merchant + Meta hardcodes — wrong data leaving the system to third parties
4. Twelve `|| "PKR"` currency fallbacks, concentrated on public/no-auth surfaces
5. `TZ=Asia/Karachi` → UTC — load-bearing; the tz-guard suite pins current behaviour
6. Courier roster — 11 of 13 are PK-only; add Stripe (payments are xPay-only today)

**The canary, worth doing before the trigger fires:** one test tenant in a **negative-UTC-offset**
timezone on USD (e.g. `America/Los_Angeles`). `GLOBAL-READINESS.md` calls this the highest-leverage
single move and it's right — it converts an invisible bug class into visible failures and makes Epic
G estimable *before* a paying customer discovers it. Cheap now, and the negative offset matters:
that's where date-boundary bugs invert.

**Do not find-replace "Pakistan" out of the docs.** The docs aren't wrong — the code really is
PK-coupled. Stripping the references would make the docs lie and the next session would ship a US
tenant into Google Merchant PK. Change only genuine strategy lines; keep every descriptive fact as a
worklist. Full reasoning: `GLOBAL-READINESS.md` §5.

---

## 7. Where NVIDIA actually fits

After all of the above: **one adapter** (`openai-compat.js`) behind the gateway, benchmarked against
Anthropic and Gemini on real tool traces. That's it, for now.

The research wasn't wasted — it produced the §2 invariant in `AI-GATEWAY.md` empirically, and the
NVIDIA doc is right about three things worth keeping: start with hosted APIs, put a review screen in
front of every extraction, and let a solver compute while the model explains. But the document is
organized by NVIDIA product rather than by customer problem, which is why ~40% of it is about
hardware not to buy.

Revisit NIM self-hosting only on evidence of sustained inference load, a residency requirement, or
an enterprise customer paying for it.

---

## 8. Still open

- **`routes/ai.js`** — grep found no route registrations, contradicting `CLAUDE.md`. Resolve before
  Phase 0 touches it (`VERIFIED-STATE.md` §5).
- **The per-plan AI quota numbers** for D5. The *mechanism* is decided (`requirePlanLimit` +
  `plan_pricing`); the actual N per tier needs one Phase-1 cost measurement before it's picked.
  Don't guess it into the schema.

Resolved 2026-07-15 and recorded in §1 — do not re-open without new information: the global pivot
(D1), front-door order (D2), `ADMIN_ALLOWED_IPS` (D3), SSO (D4), AI pricing model (D5).
