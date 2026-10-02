We are continuing the One Toy Store go-live on PRODUCTION (sanopos.com, shop slug `onetoystore`, tenant id 134, schema `tenant_onetoystore`, Supabase project tpjewvfoqtskscmwjtjj). Branch `onetoystore-golive` (local). **origin/main = 54d43a45** (D60–D63 deployed 2 Oct 22:38; prod on migration **v152**). Local branch also holds the clock-in photo work (`f3761bfb` + `ccb76127`, migration **v153**, NOT live, held on purpose: camera/kiosk device not chosen, no staff PINs). Do not push unless I ask. `onetoystore` is the only live shop on prod.

FIRST: confirm the Playwright MCP tools are connected (ToolSearch "playwright"; search again if slow; if missing, reconnect `plugin:playwright:playwright` with the ccd_connectors reconnect tool and end your turn). If "Browser is already in use", tell me. Saved prod login = admin `hassan`. If it lands on Sign in, ask me. Never type my credentials. Claude may not create accounts or enter PINs on prod.

Then read:
- `docs/onetoystore-pilot/HANDOFF-2026-10-01-night.md` → "Test and run notes", "Method for every fix", "Deploying" (still the method).
- `docs/onetoystore-pilot/PHASE-F-PLAN.md` → **the whole F9 section** (every ✅ line is an owner decision; build exactly that) and F5 (shares the item search box).
- `docs/onetoystore-pilot/supplier-bills/README.md` (15 real sample bills, git-ignored; which supplier each is from).
- `docs/onetoystore-pilot/PROGRESS.md` → the top "▶ DAY 4, 22:38" and "▶ DAY 4 NIGHT" paragraphs, defect rows **D59–D65**.

## Done in the 2 Oct night tab (~20:45–22:55)

- **Salaries / expenses (owner entered, Claude checked in SQL):** shift 4 has 8 Paid outs = **97,580** = register EXP: Salaries page **Naeem Shah** cut 7,800 → 42,600 (account → **15,000**, loan carries), **Basharat Ali paid in FULL** cut 5,000 → 40,270 (account → 0); Owner/home 1,000 coffee; Pay supplier JAHANGIR BOOKS LAHORE 10,000 cash; Shop cost 2,700 staff food, 200 Jumma, 510 water; **Owner/home 300 Aslam food** (home staff → Owner/home, owner agreed).
- **Exchange question:** INV-00122 Card 7,500 → exchange INV-00123 (4,180 credit + Cash 1,000) all saved right; dashboard "Revenue Today" counts the credit → **D65 raised** (Day report right).
- **Day 4 closed, all matches:** Day report = iPOS = Total **136,680**, Cash 64,240, Card 72,440 (14) = **Alfalah 14 / 72,440**; drawer expected **20,390**, counted 20,390, **variance 0**; shift 4 closed 22:28; backup_log #4 success, in Drive. **R1: 4 of 30.**
- **D60–D63 DEPLOYED 22:38** (`54d43a45`; Railway `9024ccaa` SUCCESS, no migration; 12/12 health; Vercel READY; live search `2516` → POP TUBES first; scan bar only; cursor in bar). Deploy tree `ots-deploy-d60` removed (junctions first). **Counter: Ctrl+Shift+R before the first sale 3 Oct.**
- Checked: nothing else built is waiting to deploy except the photo work above.

Salaries still to pay over the coming days (recheck balances first, one at a time with my OK): Ishtiaq 0/36,500 · Mubashir 0/43,800 · Tahir 15,440/20,140 · Atiq 15,000/24,080 · Kelash 0/40,800 · Fahad 0/23,770 · Ramzan 22,750/9,330 · Usman 5,000/6,000 · Aslam 30,000/12,000 (Owner / home). (cut / cash)

## NOW: build F9 (receive a supplier bill without a PO), LOCAL ONLY

Method: grep every place first and tell me in plain English → failing test → build → related tests → local Playwright demo with the real sample bills (backend-5004 / frontend-5177 via preview_start, LOCAL DB banner, local shop `otsacc_mujsufsd`) → local commits. Not deployed until I say. One question at a time with your suggestion, only where PHASE-F-PLAN F9 doesn't already decide it.

Build order:
- **(a) data, migration v154** (F9 deploys before the photo work → when F9 deploys, renumber the photo migration ABOVE F9's last, as done for v152→v153 in `ccb76127`; the runner applies only versions above the current one): supplier codes per supplier per toy; extra barcodes per toy (one toy, one stock; till scan, search, offline copy, bill matching); supplier bill + lines (bill's own S.No, page/file, billed vs received qty, line discount, split-into-N, negative lines = return) + files (fingerprint, refuse same file); GRN `supplier_id` + receive without PO; supplier account kinds **Not received** (−) and **supplier Discount** (−); "Received, waiting for supplier's bill" list; drafts; permission **"Receive supplier bills"** in `config/permissions-catalog.js` (drift test).
- (b) PDF word-position readers for the 3 layouts (Baby Land "Sales Estimate"; Toys and Toys INV-226xx; Hafiz Nawaz "Bill No 01 / M100"; qty × rate = amount checked) + layout memory per supplier.
- (c) check screen with the shared item search box (D60 order; reusable for F5).
- (d) price rules (owner's margin sheets, rule order in F9) + new codes from 31000 (beware leading-zero duplicates) + split packs (÷N, round to 10) + labels list.
- (e) photo reader: extend `/api/ai/invoice-extract` (Sonnet 5.5; supplier code, line discount, header, total, crossed-out lines; PDF too).
- (f) drafts / same bill warning / undo same day while unsold / corrections after.
Then D64, D59, D65, F5, G1–G5, F6–F8, then Shopify step 1.

Starting points found (2 Oct 22:55, not yet read): `backend/migrate-pg.js` (latest v153 at ~line 10302), `routes/grn.js` (GET /api/grn, by-po, :id, POST :id/scan-receive, more at 304–562), `routes/purchase-orders.js` (receive → GRN → `supplier_invoices`, `OVER_RECEIPT`), `routes/suppliers.js`, `routes/supplier-returns.js`, supplier payments `PaySupplierModal.jsx`, till Paid out → Pay supplier (`routes/till-payouts*`), cost history trigger `price_changes` (v143, `services/product-history.js`), stock via `services/stock-ledger.js` only, `routes/ai.js` + `services/ai.js` extractInvoiceLineItems, R2 helpers `utils/r2.js`.

Still open, not fixed: D59; D64; D65; Sales History payment filter / Cash Audit only see the header method; Paid out / Paid in have no offline queue; a void doesn't take back loyalty points; "Last Receipt" doesn't show an exchange slip; resumed cart drops the staff choice; exchange on a staff bill not special-cased; lint baseline POSReturnExchangeModal 27 vs 25; batch3's 10 old sales/gift-card failures; receipt window keeps the cursor off the scan bar (ask owner).

Rules: plain English for me, one question at a time with your suggestion, my OK before any prod write or push, record in PROGRESS.md / PHASE-F-PLAN.md and commit locally as we go.
