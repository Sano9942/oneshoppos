# AI Gateway — Architecture — 2026-07-15

The spine every AI feature hangs off. One layer, one tool surface, **three front doors**
(§6), swappable model providers underneath.

Origin: proposed in the second external review; endorsed here because it is the only part of either
review that survived verification against source. Everything else they proposed either already
ships or doesn't exist at all — see [`VERIFIED-STATE.md`](VERIFIED-STATE.md).

**Nothing here is built yet.** `services/ai.js` is 176 lines that construct `new Anthropic(...)`
directly.

---

## 1. Shape

```
  In-app assistant   │   BYOK tenant   │   Claude / ChatGPT / Gemini (MCP)
─────────────────────┴─────────────────┴──────────────────────────────────
                        AI GATEWAY
     tenant isolation • permissions • outlet scope • audit • rate limits
                     • provider routing • region routing
──────────────────────────────────────────────────────────────────────────
   Anthropic  │  OpenAI  │  Gemini  │  NIM / Groq / self-hosted open models
──────────────────────────────────────────────────────────────────────────
                     APPROVED TOOLS (read-only first)
              deterministic SQL + existing services only
```

The model never receives a database handle, a connection string, a raw SQL string to execute, or an
API key. It asks the gateway to run a **named, permitted tool**; the gateway resolves tenant, outlet
and effective permissions, runs the tool, and returns only what that principal may see.

---

## 2. The invariant: SQL computes, the model explains

**Deterministic code calculates every number. The model may only explain, prioritize, rank, and
draft. It never does arithmetic that reaches a user.**

This is not a stylistic preference — it is the one empirically proven finding in the whole NVIDIA
research thread. From [`../../nvidia ai/nvidia-ai-research-conversation.md`](../../nvidia%20ai/nvidia-ai-research-conversation.md) §9:
Nemotron Ultra 550B, asked for net-sales growth, **compared today's net sales against baseline gross
sales** and reported 6.4% instead of 8.5%. Omni 30B scored 9/10; Ultra 550B scored 7.5/10. A
1,833%-larger model was *more* confidently wrong.

Scaling the model does not fix arithmetic. Removing the arithmetic does.

Corollaries:

- Every tool returns numbers computed by existing services or SQL. The model receives them as facts.
- Every user-visible insight carries its source (which tool, which rows) and an action button —
  never a bare assertion.
- **Writes never bypass the deterministic writers.** `services/stock-ledger.js` is the ONE on-hand
  stock writer; `services/tax-snapshot.js` is the ONE per-line tax cascade. A gateway tool that
  moves stock calls `stock-ledger`, inside the caller's transaction, or it is a bug.
- Drafts are drafts. A `draft_purchase_order` tool writes a PO in draft state for human approval; it
  does not submit. Nothing financial, tax-related, or inventory-moving executes without a person.

---

## 3. Tool surface — read-only first

Start read-only. An LLM with write access to POS routes means a prompt-injected message can issue a
refund. Read-only tools have a fraction of the blast radius and can be shipped without a
confirmation UX.

**Phase 1 (read):**

| Tool | Backed by |
|---|---|
| `get_sales_summary` | `routes/reports/dashboard.js` |
| `find_stockout_risks` | `routes/inventory-intelligence.js` |
| `search_products` | `routes/products.js` |
| `get_customer_balance` | `services/credit.js`, AR aging |
| `get_purchase_order_status` | `routes/purchase-orders.js` |
| `explain_margin_change` | `routes/reports/*` |
| `summarize_support_tickets` | `routes/support.js` |
| `get_fbr_queue_failures` | `routes/fbr.js` |

**Phase 2 (draft-only writes, human approval required):** `draft_purchase_order`,
`draft_stock_transfer`, `draft_product_content`.

**Never a tool:** raw SQL execution, credential access, permission changes, payment capture, refund,
FBR submission, employee record mutation.

---

## 4. Permission model — reuse, and mind the traps

**Do not invent an authorization model.** Every tool resolves through the existing chain.

- Capability: `requirePerm` / `requireAnyPerm` (`middleware/permissions.js`)
- Outlet scope: `middleware/outlet-context.js` — the single interpreter of `x-outlet-id`
- Effective role (v137): `resolveEffectiveRole`. **The invariant holds inside the gateway too —
  outlet *reach* keys on `req.baseEmployeePerms`, *capability* keys on `req.employeePerms`.** An
  override grants capability at an outlet, never widens which outlets a principal reaches. See
  [`../business-modules/`](../business-modules/) and memory `business_modules_d2_effective_roles`.

### ⚠️ The `PERMISSION_RULES` trap — read before adding any gateway route

`PERMISSION_RULES` in `middleware/permissions.js` is **live blanket middleware keyed on path
prefixes, and it runs BEFORE the per-route guard.** Mounting a new `/api/ai/*` or `/api/mcp/*`
prefix silently inherits — or fails to inherit — whatever those rules say.

This has bitten twice already:

- The blanket rule on the `/api/business-modules` prefix admits `manage_outlet_modules` *before* the
  per-route guard runs, so the narrower delegation reaches more than the route intends.
- Tightening a path-regex perm caught a self-scoped sub-endpoint (`my-status`) and broke the POS
  shift gate. Memory: `feedback_blanket_rule_self_endpoint`.

**Required before merging any gateway prefix:** grep `PERMISSION_RULES` for prefix collisions and
write the intended rule explicitly. Do not assume the per-route guard is the only gate.

---

## 5. Provider adapters

Same pattern as `services/couriers/` (13 adapters), `services/marketplace/` (4 clients),
`services/payment-gateway.js`. Copy it; don't invent a fourth shape.

```
services/ai-gateway/
  index.js          — resolve tenant → provider → region → adapter; audit; rate limit
  providers/
    base.js
    anthropic.js    — wraps the current @anthropic-ai/sdk usage (already a dependency)
    openai.js
    gemini.js
    openai-compat.js — NIM / Groq / Together / vLLM / Ollama all speak this
  tools/            — one file per tool; each calls existing services, never raw SQL
```

`openai-compat.js` is deliberately one adapter, not five: NVIDIA NIM, Groq, Together, Fireworks,
vLLM and Ollama all expose an OpenAI-compatible surface. That single adapter is the entire
"open-source models" story and the entire "self-hosted for enterprise" story.

**Model selection is a gateway concern, not a caller concern.** The Nemotron benchmark suggests
smaller + restrained beats larger + confident for business analytics — but that decision belongs in
config, changeable without touching a tool.

---

## 6. The three front doors

Decision 2026-07-15 (D2, order confirmed by owner): **all three, phased — in-app → BYOK → MCP.** The
gateway is designed for all three from day one so none requires re-architecting when it lands.

### 6a. In-app assistant — first

Your UI, your provider choice, **you pay every token**. Easiest to secure, measure, and charge for.

**Ship the cap with it (D5).** Add an AI-action resource to `requirePlanLimit`
(`middleware/plan-limits.js`) + a per-plan quota in `plan_pricing`. The cap *is* the cost control —
an uncapped assistant is an unbounded bill, and adding a limit later to a feature tenants already
use is a downgrade they will notice. Quota numbers need one cost measurement first; don't guess them
into the schema.

Needs: gateway + tools + a chat surface + the plan-limit resource. No new auth.

### 6b. BYOK — second

Tenant supplies their own OpenAI / Anthropic / Gemini / compatible key. Their account pays for
inference; you charge for the platform. Enterprise-only — don't offer it to a corner shop.

Needs: encrypt via `services/crypto.js` (`enc:v1:{iv}:{tag}:{ciphertext}`, exactly as Shopify and
Daraz keys are stored today), per-tenant scope, write-only (never shown again), revocable. **All
gateway permission checks and audit records still apply** — BYOK changes who pays, not who may see
what.

**Never put a key in a prompt.** Prompts persist in session history.

### 6c. MCP connector — third, and the big one

Tenants attach SanoPOS inside their own Claude / ChatGPT / Gemini subscription. **Their subscription
pays for inference; you serve tool calls at near-zero marginal cost.** This is the opposite billing
model to 6a and the reason to build it despite the cost.

⚠️ **Why it's last, and it isn't effort:** MCP only pays off for a tenant who *already* has a Claude
Pro or ChatGPT Plus subscription. Under D1 (PK-first), essentially none of your real tenants do.
**MCP is coupled to the global pivot and to enterprise customers — both deferred.** Building it now
means shipping to an audience you don't have. See [`PLAN.md`](PLAN.md) §5.

⚠️ **The confusion worth killing:** a Claude Pro or ChatGPT Plus subscription does **not** pay when
*your server* calls the model API (that's 6a — you pay). It **does** pay when a subscriber chats in
their own client with your connector attached (6c — you pay nothing). Both statements are true;
they describe different paths. Review 2's opening bullet states only the first and reads as though
it applies to both.

**The work is not MCP.** The tools are thin wrappers over §3. The work is that connectors require
you to **be an OAuth 2.1 authorization server** — authorization code + PKCE, dynamic client
registration (RFC 7591), protected resource metadata (RFC 9728), consent screen, token endpoint,
scope handling. You have never been one; you are only an OAuth *client* (Daraz, Facebook, Google
Merchant). Budget ~1–2 weeks for that and ~2 days for the tools.

Precedent to copy: `middleware/customer-auth.js` and `middleware/manufacturer-auth.js` — a fourth
parallel scope, mounted before tenant middleware, tenant resolved via
`services/public-tenant-context.js:resolvePublicTenantDb()`. Note the two existing portal modules
have **drifted** on TTL defaults and status checks despite being near-identical; don't make it three
divergent copies — factor the shared shape.

---

## 7. Region and residency — build the dimension now, use it later

Provider and region selection must be a **per-tenant** dimension from the first commit, not a global
env var.

Not urgent under PK-first ([`PLAN.md`](PLAN.md) §6 — direction-of-travel), but retrofitting it under
legal pressure is far worse than carrying an unused column. Sending an EU tenant's customer data to
a US model endpoint is a GDPR transfer question; India, Brazil and Saudi Arabia are tightening
comparable rules. Current architecture is one Supabase Postgres in one region.

Minimum viable: per-tenant `ai_provider`, `ai_region`, and an `ai_enabled` kill switch. Review 2
framed residency as an enterprise upsell. It isn't — it's a schema decision.

---

## 8. Audit

Every gateway call records: tenant, employee, outlet, effective role, tool, arguments, provider,
model, prompt version, latency, token usage, and whether a draft was created. Route to
`action_history` (the existing tenant-scoped audit table).

This is not optional. It's how you answer "why did the assistant recommend that?" six months later,
and it's the evidence trail for any AI-proposed action that touched money.
