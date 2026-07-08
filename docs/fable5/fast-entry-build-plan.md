# Fast Data-Entry Build Plan (Catalog / Stock in a Snap)

> Goal: let a shopkeeper add/receive products **fast** — by photo, PDF, CSV, or a few taps —
> instead of typing every field. Written 2026-07-09.

## Core principle (read this first)

Data entry = **input method** + **shared pipeline**. The pipeline already exists and is
battle-tested; we only add new *input methods* that feed it.

The single funnel is in `backend/routes/import.js`:

```
upload → parseFile() → resolveMappedRows() → normaliseRow() → preview (rows[] + _errors) → save
```

Every new entry method must output rows in the **11 canonical product fields**
(`services/import/mappers/index.js: CANONICAL_FIELDS.products`):

```
name, sku, barcode, selling_price, cost_price, category, brand, tax, unit, stock_quantity, status
```

If a new method produces those fields, **tax / price / code handling is automatic** — see below.

---

## The three "how is X handled" questions — already solved

These are NOT new problems. They are properties of the existing schema + pipeline and apply
identically no matter how data is entered.

### Codes / no original barcode
- `products` has `barcode`, `sku`, AND `plu_code`. Scan endpoint matches **all three**.
- `sku` is free TEXT → supplier codes or shopkeeper's own codes, **numeric or alphanumeric**, both fine.
- Both `barcode` and `sku` have partial-unique indexes (live rows only).
- **Enhancement:** auto-generate a `sku` when none supplied (e.g. `SKU-00001` or `<CAT>-000123`)
  so the shopkeeper never has to invent one. Small helper, no AI.

### Sale price
- `products.cost_price` + `categories.default_margin_percent` already exist.
- WS4 Phase 1 added the **cost→price margin rule** (`import.js`): `price = cost × (1 + margin%)`.
- Fast entry supplies **cost**; system suggests **price** from category margin; shopkeeper confirms/overrides.

### Sales tax
- `company_profile.tax_mode` (inclusive / exclusive / none) is the shop default.
- Category/product `hs_code` → rate via `tax_rate_reference`; category-level inheritance via
  `category-tree.js: resolveInheritedField()`.
- Rate is **snapshotted per line at sale time** (`tax_rate_at_sale`, `hs_code_at_sale`).
- Non-GST shops (most small merchants) → `tax_mode` leaves tax at 0 / inclusive; they never think about it.
- GST shops → assign category, tax follows automatically.

**Money-critical rule:** AI/extraction must NEVER silently set tax or price. It fills a **draft
preview**; the shopkeeper **confirms** before save. The `?preview=1` flow already does exactly this.

---

## Sequenced build — cheapest / lowest-risk first

### Phase 0 — DONE (WS4 Phase 1, already shipped)
- CSV / XLSX import (`POST /api/import/products`)
- Supplier column-mapper (`buildColumnMapper`, `suggestColumnMap`) — arbitrary supplier headers
- Fuzzy name-match near-duplicate hints (`pg_trgm`) on import + GRN
- Cost→price margin rule per category

### Phase 1 — NO API KEY NEEDED (do this next)
Small, safe wins that make entry faster without any AI cost.

1. **Auto-SKU generation** for rows missing a code (sequential or category-prefixed).
   - Touch: `import.js` normalise step + a `nextSku()` helper.
2. **Digital-PDF table extraction** (invoices/price lists that are real text PDFs, not scans).
   - A PDF that contains selectable text can be parsed with a table/text library (no AI).
   - New route `POST /api/import/products/from-pdf?preview=1` → extract rows → **same preview**.
   - Lib candidates: `pdf-parse` (text) or a table extractor; evaluate on real supplier PDFs.
   - Fallback: if the PDF is a scanned image (no text layer), route it to Phase 2 (AI vision).
3. **Preview UX polish** in `ImportRedesign.jsx`: show margin-derived price + category-derived
   tax as editable defaults, so confirming is one tap per row.

**Decision needed:** bump upload limit? Currently `fileSize: 5MB` (memoryStorage). Photos/large
PDFs may exceed this → raise to 10MB and/or stream large files to R2 first.

### Phase 2 — NEEDS FUNDED `ANTHROPIC_API_KEY`
The "magic" layer. Reuses the exact same preview + pipeline.

1. **Photo / scanned-invoice → line items** (the headline feature).
   - New route: upload image → (store to R2) → `client.messages.create` with the image block +
     a strict JSON-schema prompt → returns `[{name, qty, cost, unit, barcode?}]`.
   - Feed extracted rows into the **existing import preview** → shopkeeper confirms → save.
   - **Model choice:** use a stronger model for VISION here (e.g. Sonnet), NOT Haiku — messy /
     handwritten / Urdu challans need accuracy, volume is low (per-invoice), so cost is fine.
     (Keep Haiku for the high-volume text chat; pick per-task.)
   - Risk: parse accuracy on messy/handwritten Pakistani challans → mitigated by the confirm step.
2. **Product description + tag generator** (the cheapest AI "Shopify Magic" clone).
   - New route: product name/category (+ optional photo) → generated description + tags.
   - No customer data involved → zero PII risk. Great first AI win independent of invoices.
   - Model: Haiku is fine for text descriptions.

### Phase 3 — LATER (bigger, optional)
- **Proactive reorder / dead-stock alerts.** The *analytics* is non-AI (you already have
  `inventory-intelligence.js`: ABC class, velocity, reorder qty). AI only phrases the nudge.
  Surface as dashboard cards / notifications.
- **Agentic actions** (Square "Managerbot" / Shopify "Sidekick" style: propose → approve →
  execute). Real project: tool/function-calling + action guards + PII handling. Defer until
  Phases 1–2 prove demand.

---

## Reuse map (what already exists → don't rebuild)

| Need | Existing piece |
|------|----------------|
| Upload + parse CSV/XLSX | `import.js: parseFile()` |
| Map weird supplier columns | `mappers/index.js: buildColumnMapper`, `suggestColumnMap` |
| Preview with per-row errors | `import.js` `?preview=1` → `rows[]._errors` (frontend `ImportRedesign.jsx`) |
| Cost→price margin | `categories.default_margin_percent` + `import.js` margin rule |
| Tax from HS code | `category-tree.js: resolveInheritedField`, `tax_rate_reference` |
| Custom codes / scanning | `products.sku|barcode|plu_code` (all matched at scan) |
| Fuzzy duplicate detection | `pg_trgm` name-match (import + GRN) |
| LLM SDK | `@anthropic-ai/sdk` (installed) — needs funded key for Phase 2 |
| Tenant isolation | `deps.db` proxy (automatic) |
| Image storage | `utils/r2.js`, `tenant-multer.js` |

## Prerequisites / open decisions
- [ ] `ANTHROPIC_API_KEY` funded + set on Railway (Phase 2 only; Phase 1 needs nothing)
- [ ] Upload size limit 5MB → 10MB? (photos/large PDFs)
- [ ] PDF library choice for Phase 1 digital-PDF path
- [ ] Vision model for Phase 2 (recommend Sonnet for accuracy on messy challans)
- [ ] Store uploaded invoices in R2 for audit, or discard after parse?
