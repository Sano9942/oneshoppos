# Hand-off 2026-10-19 (evening)

## Done this tab (all LOCAL on `onetoystore-golive`, nothing pushed or deployed)
Prod is unchanged: origin/main `f6a290d6`, migration **v156**. Local DB `sanopos_dev` is at **v159**.

| Commit | What |
|---|---|
| `29edd1ed` | **D64** bill numbers `INV-yymmdd-001`, **every shop** (owner). Date = shop date the bill was rung (`sales.timestamp`, so offline bills keep their day). `services/invoice-number.js`, table `invoice_day_sequences`, migration **v158**. Till + foodpanda/aggregator share it; customer invoices (`INV-000001`) untouched. Old bills keep `INV-2026-00001..00138`. |
| `22bc7df6` | **entry_date fix**, migration **v159**: `supplier_account_entries.entry_date` lost its `DEFAULT CURRENT_DATE` (UTC day). Both writers already pass the shop date; live had 0 rows. Fixes the `tz-date-boundary-guard` unit failure. |
| `6b71f2a4` + `86b538e3` | **D59** transfer overpaid, change from the drawer (owner: "on the bill"). Online amount box takes what was sent; backend keeps the transfer whole and books the change as a **Cash minus line**; receipt/reprint show it as Change. No migration. Shown locally: 2,650 bill, JazzCash 2,780 → Change Due 130 → saved JazzCash 2,780 + Cash −130 → reprint "Change 130". |
| `6c326f25` | **G2 saved end-of-day stock value**, migration **v160**: saved at every Close Shift + nightly 23:59 backup (needs `STOCK_VALUE_NIGHTLY_WORKER_ENABLED=1`), totals only, "Stock at close" on the day slip, Reports → Stock Value → Saved by day. See PROGRESS top. |
| (next commit) | **G3** dashboard card "Sales by Supplier (30d)": top 10 + Others + No supplier, item price less returns, % of all sales. No migration. See PROGRESS top. |
| `d5f48f63` | **G1 Stock Value** (owner: one table + "Group by"). `GET /api/reports/stock-value-summary?group_by=supplier\|category\|subcategory\|brand`; Reports → Inventory → **Stock Value**. Category = top level, Sub-category = toy's own (parent shown). Shown locally. |

Details, tests and live-data checks: PROGRESS top "▶ 2026-10-19 afternoon" paragraph and defect rows **D59**, **D64**.

## Deploy notes (when the owner says)
- Migration order: **v157 = held clock-in photo**, v158 = D64, v159 = entry_date, v160 = G2. The runner only applies versions **above** the current one. If D64/v159 go live **without** clock-in, first renumber the clock-in migration **above the highest deployed** (as was done for F9), or it will never run.
- D64 changes the numbers on every new bill → deploy on a morning **before opening** (agreed). Health 10/10 before calling it live.
- D59 changes the till screen; check a real Online bill after deploy.
- G2: the nightly backup only runs with `STOCK_VALUE_NIGHTLY_WORKER_ENABLED=1` on Railway — ask the owner before setting it. After the first real Close Shift, check one `stock_value_days` row against Stock Value → Now.

## State of the shop (unchanged from the afternoon)
SanoPOS not used at the counter since 2 Oct; dual-run not restarted; live shift 5 (opened 15 Oct) was **closed 19 Oct 14:33 PKT** (seen in the live DB this evening). Bill photo reading OFF.

## Local setup used
`.claude/launch.json` → `backend-5002` + `frontend-5175`; local shop `otsacc_mujsufsd` (sign-in in PROGRESS, search "Owner given a local-only password"; Owner's local kiosk PIN is in PROGRESS too). Local backend often dies once on a DB connection timeout at start → start it again. Backend `node index.js` does **not** reload: restart it after backend edits. The in-app browser pane must be shown for clicks to work. Local old shift #7 is still open on purpose; local sale #30 INV-261019-001 is a demo bill.

## Known, not fixed
- Backend unit tests: 3 old failures (`routes-admin-worker-status` ×2, `services.test` payment-gateway) — same without today's changes.
- The Stock Value tab only uses the branch filter; the page's category/brand/supplier filters don't apply to it.

## Next, in owner's order (ask one question at a time)
1. ~~**G2**~~ built locally (see above).
2. ~~**G3**~~ built locally. **G4** dashboard: gross margin % today + month, month sale and month purchase, top 50 items (30 days). **G5** dashboard: daily sale vs purchase (server already computes a 7-day series, "Query 13", no screen shows it). Also list the toys sold under "Needs a Category".
3. **F6–F8** (see PHASE-F-PLAN).
4. Still waiting on the owner: restart dual-run (iPOS export → catch-up, close shift 5), F9 (e) real-photo trial (AI key), clock-in photo (device + PINs).
