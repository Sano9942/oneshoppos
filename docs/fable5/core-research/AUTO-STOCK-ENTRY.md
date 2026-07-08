# Auto Stock Entry — from data-entry operator to zero

**The goal.** Every retail shop pays someone to key in products, prices, and stock — from supplier
invoices, delivery challans, price lists, and physical counts. This document maps the path from where
SanoPOS is today to a moonshot where a shopkeeper photographs a supplier invoice and the catalog +
stock update themselves, with a human touching only the low-confidence rows.

Written 2026-07-08 against main @ v126. Every "exists / calls / stubbed" claim points to a file:line
verified this session. **Findings + roadmap only — no code was changed.**

---

## 1. What the operator does today, and which surfaces they use

The data-entry role in a SanoPOS shop touches five surfaces:

| Task | Surface today | File |
|---|---|---|
| Bulk-load a catalog (migration / price list) | `/import` page → `POST /api/import/{products,customers,suppliers}` with `?preview=1` | `backend/routes/import.js:74` |
| Migrate from a competitor | Same import with `?source=shopify\|square` mapper | `backend/services/import/mappers/index.js` |
| Create one product | Product form → `POST /api/products` | `backend/routes/products.js` |
| Receive a delivery against a PO | GRN → `POST /api/grn/:id/scan-receive` (barcode) | `backend/routes/grn.js:85` |
| Categorize / price / tax | Manual dropdowns on the product form; category tree | `backend/category-tree.js` |
| Physical count | Stock counts / cycle count sessions | `StockCountRedesign` |

**What each already does well (verified):**

- **Bulk import is genuinely capable.** `import.js` parses CSV/XLSX (`XLSX` lib, `:1`), previews with
  per-row `_errors`, resolves category/brand/tax by name to FK (`:97-160`), detects in-file and
  in-DB SKU collisions (`:129-142`), and bulk-inserts in one transaction with `outlet_stock` upsert
  (`:187-216`). This is the strongest existing lever.
- **Embedded-barcode decode is real.** `GET /api/products/scan/:barcode` authoritatively decodes
  weight/price-embedded EAN-13 (deli-scale labels) via `services/embedded-barcode.js`
  (`products.js:378,383`). Grocery/butcher already get scale-label parsing for free.
- **GRN scan-receive exists** (`grn.js:85`) — receiving increments `qty_received` per barcode.
- **Competitor mappers exist but are thin** — only Shopify + Square, only products + customers
  (`mappers/index.js:14`). No supplier-catalog or generic-invoice mapper.

**Where the operator's time actually goes (the gaps automation must close):**

1. **Typing the invoice.** A supplier delivers a paper challan / PDF invoice; the operator keys each
   line into either a spreadsheet-for-import or the product form. There is **no invoice ingestion
   path** — no OCR, no PDF parse, no photo capture into the catalog.
2. **Matching to existing SKUs.** The import matches SKU exactly (`:129`) but has **no fuzzy
   name-match** — "Nestle Milk 1L" vs "Nestlé Milk 1 Litre" are two products. GRN matches only by
   barcode; a supplier line with no barcode can't auto-match.
3. **Categorizing + pricing.** Category/brand/tax must pre-exist and match by name (`:146-160`) — an
   unknown category is an error row, not an auto-create. Retail price is hand-set (no
   cost→margin→price rule).
4. **Barcode-not-found dead-ends.** POS scan of an unknown barcode returns not-found with no
   "create it now from this scan" path — the operator leaves POS, opens the product form, retypes.

---

## 2. Infrastructure that already exists (so we build less)

The moonshot is closer than it looks because three of the four hard pieces are already wired:

- **Anthropic SDK is a live dependency.** `@anthropic-ai/sdk` is imported and calling
  `client.messages.create({ model: "claude-sonnet-4-20250514" })` in `routes/insights-ai.js:90-93`.
  The same client supports vision (image blocks) with no new dependency — only an `ANTHROPIC_API_KEY`
  and a new route. **Caveat (verified):** `ANTHROPIC_API_KEY` is gated (`insights-ai.js:22`) and per
  project memory is **absent on Railway today** — the AI features silently no-op in prod until it's
  set. Any AI stock-entry feature inherits that dependency.
- **R2 binary storage is wired.** `utils/r2.js:44` `uploadToR2(buffer, key, contentType)` +
  product-image multer factories already store images at `products/{id}.webp`. An invoice photo has a
  home immediately.
- **Import preview→confirm UX is built.** `ImportRedesign.jsx` already renders a per-row editable
  preview with `_errors` — the exact human-in-the-loop review surface an AI parse needs. AI output
  can feed the *same* preview component instead of a new UI.
- **Bulk insert transaction + FK resolution + SKU dedup** all exist in `import.js` — AI parsing only
  needs to produce the row shape `import.js` already consumes.

What's genuinely missing: OCR/vision parse, fuzzy product matching, category/price auto-derivation,
and a supplier-catalog memory (so the same supplier's lines match faster over time).

---

## 3. Phased roadmap: now → next → moonshot

### PHASE 1 — NOW (weeks, uses only existing infra)

| Build | Effort | How | Risk |
|---|---|---|---|
| **Scan-to-create at POS** | S | On barcode-not-found, open a quick-create drawer pre-filled with the scanned barcode; POST `/api/products`. Removes the POS→form→retype loop. | Low — pure UX |
| **Supplier-catalog import mapper** | S | Add a `supplier` entity + generic column-mapping UI (map "their header" → our field) to `import.js`/mappers. Reuses preview→confirm. | Low |
| **Fuzzy name-match on import** | M | Add trigram/`pg_trgm` similarity suggestion in the preview: "row 4 looks like existing SKU X — merge?" Postgres `similarity()` needs the `pg_trgm` extension. | Med — false matches; keep human-confirm |
| **Cost→price rule** | S | Optional margin % per category → auto-fill retail price from cost on import/GRN. | Low |
| **GRN name-match (not just barcode)** | M | Extend `grn.js` scan-receive to also match by fuzzy name when no barcode. | Med |

Phase 1 alone removes most re-typing for shops that already get a digital price list.

### PHASE 2 — NEXT (1–2 months, adds AI parse of a clean document)

| Build | Effort | How | Risk |
|---|---|---|---|
| **PDF / photo invoice → line items** | L | New route: upload invoice → R2 → `messages.create` with the image + a JSON-schema prompt → returns `[{name, qty, cost, unit, barcode?}]` → feed the existing import preview. | Med — parse accuracy on messy Urdu/handwritten challans |
| **Supplier memory** | M | Store `(supplier_id, their_line_text) → product_id` mappings so the 2nd invoice from the same supplier auto-matches lines the operator confirmed on the 1st. | Low |
| **Confidence scoring + human-in-loop** | M | Each parsed line gets a confidence; high-confidence auto-fills, low-confidence flags for review in the same preview grid. | Med |
| **Auto-categorize** | M | Prompt the model to also suggest category (from the tenant's existing tree) + auto-create leaf if missing (behind confirm). | Med |

Accuracy risk is the gating factor — Pakistani supplier challans are often handwritten Urdu/English
mix. Mitigate by always routing through the human-review preview (never straight-to-insert) and by
letting supplier memory carry most of the load after the first invoice.

### PHASE 3 — MOONSHOT (photograph → stock-in, human only on low confidence)

The end state: shopkeeper photographs the delivery challan on the PWA (offline-capable, R2-backed),
the system parses lines → matches-or-creates products → auto-categorizes + auto-prices from
cost+margin → stages a GRN receive → and only surfaces the rows below a confidence threshold. On
confirm, stock is in and the catalog is updated. Supplier memory means the 10th invoice from the same
distributor is nearly one-tap.

Dependencies for the moonshot, in order: (1) `ANTHROPIC_API_KEY` set on Railway (currently absent);
(2) the Phase-2 parse + supplier-memory + confidence loop; (3) a mobile capture flow reusing the
field-rep PWA offline-queue pattern (`utils/offlineQueue.js`); (4) tie the confirmed parse to the
existing GRN receive transaction so stock + payables move atomically.

---

## 4. How competitors do it (reality check)

- **Square / Shopify**: bulk CSV import + a product library; Square has item-photo → suggested-name
  but **no invoice OCR**. Shopify relies on supplier apps / channel sync, not document parse.
- **Loyverse**: CSV import + barcode scan-to-create (which SanoPOS should match in Phase 1). No
  invoice AI.
- **Vend/Lightspeed**: supplier catalogs + PO-based receiving; some paid OCR add-ons via third
  parties, not native.
- **The white space**: native, AI-first *invoice-photo → stock-in* tuned for messy
  emerging-market challans is not something the incumbents ship. For the Pakistan wholesale/retail
  wedge this is a genuine differentiator, and SanoPOS already has the SDK, storage, and preview UX to
  build it without a platform change — the missing pieces are the parse route, matching, and the
  Railway API key.

**Bottom line:** Phase 1 is low-risk and mostly UX plumbing on top of a capable import engine; the
AI moonshot is unusually reachable because the Anthropic SDK, R2, and the review-preview UI are
already in the codebase. The single biggest non-code blocker is that `ANTHROPIC_API_KEY` is not set
in production, which also silently disables today's AI insights.
