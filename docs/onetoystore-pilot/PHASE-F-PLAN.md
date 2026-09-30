# Phase F: dual-run with iPOS, then drop iPOS

**Written:** 2026-09-29, after day 1 of the dual-run was closed and reconciled.
**Shop:** One Toy Store, Packages Mall (prod `onetoystore`, tenant 134).
**Status:** plan written; nothing below is built yet. Every write to production waits for the owner's OK.

## What Phase F is

Every sale goes into both iPOS and SanoPOS. Each night we compare the two. When the rules below are all met, the owner stops using iPOS. Until then, **iPOS is the official record** and SanoPOS is being proven.

Day 1 (2026-09-29) result: 34 bills, cash 25,990 exact, card +40 (D48), card vs bank explained by one online transfer (D52). The drawer was Rs 130 or Rs 420 over after the register's Rs 10,470 expenses (count timing not certain). Details in `PROGRESS.md` → "Counter PC (step 8)".

## Daily routine while dual-running (until the fixes land)

1. **Morning:** clock in at the kiosk, count the float by note, open the shift.
2. **Every sale:** ring it in iPOS and SanoPOS the same way.
   - **Online transfer** (EasyPaisa, JazzCash, bank app): ring as **Card** in both and write it in the register (until F2). Never use SanoPOS's **Wallet** button: that is the customer's store credit.
   - **Exchange where you waive a small amount:** SanoPOS can't yet (until F1). Write the bill number and amount in the register; we'll note it at night.
   - **Cash paid out of the till:** write it in the register as now (until F3).
3. **Night, in this order:** iPOS day report slip → iPOS End of Day → last customer served → **count the drawer last** → SanoPOS **Close Shift** (notes by denomination; reason = till expenses from the register) → **Backup & Restore → Download Backup, file to Google Drive** → kiosk clock-out.
4. **Send Claude:** a photo of the iPOS slip, the bank settlement total, the register's expense total and any online transfers or waived amounts. Claude checks SanoPOS read-only and records the day in `PROGRESS.md`.

A cash sale after counting: add those notes to the count (or recount) before pressing Close Shift. SanoPOS's expected cash includes every sale up to the moment you close.

## Rules for "ready to drop iPOS"

All must be true. Claude checks each one and records it; the owner decides.

| # | Rule | How it's checked |
|---|---|---|
| R1 | **7 trading days in a row** where SanoPOS cash, card, online and total equal iPOS, or the difference is written down and explained (e.g. a known defect) | Nightly check, a table per day in `PROGRESS.md` |
| R2 | The 🔴 fixes are **deployed and used for real in the shop**: F1 exchange discount, F2 online transfer, F3 till paid-out, F4 day slip, F5 item search by code | Each fix: test, deploy, then a real use seen in the database |
| R3 | **After R1, the drawer balances** in SanoPOS on its own: the close-shift difference is within Rs 100 with till expenses entered in SanoPOS (not the register) | `cash_shifts.variance` for the last 3 days |
| R4 | **Stock is right:** after a week, the owner counts 20 random items on the shelf and they match SanoPOS (differences explained). No unexplained negative stock | Stock count page, or SQL on 20 SKUs |
| R5 | **Stock arriving is received in SanoPOS** at least once for real (supplier bill / receive goods, new items, price changes, labels) | Real receiving seen in History + labels list |
| R6 | **The counter works with the internet unplugged** (Phase E leftover): 2 bills offline, plug back in, both arrive with the right time and shift | Owner in the shop, Claude on SQL |
| R7 | **A copy of the shop's data exists every day that we can restore from.** Prod is on Supabase **Free: no backups**. **Q1 answered 2026-09-29: no Supabase Pro; use Backup & Restore → Download Backup nightly.** ✅ Proven once 2026-09-29 (below). Still needed for the rule: the nightly habit kept for the 7 days, files stored off the shop PC | Backup log (`tenant_onetoystore.backup_log`) shows one row per night; one more test restore before iPOS is dropped |
| R8 | **The owner (or staff) runs a whole day without Claude**: open, sell, return/exchange, paid-out, close, day slip to WhatsApp | One day, reviewed next morning |
| R9 | **A last full iPOS export** (stock + the dual-run days' sales) saved before iPOS is switched off | File kept in `D:\newprojects\` + owner's copy |

### R7 proof, 2026-09-29 23:08 (first use of the feature, ever)

- Claude pressed **Download Backup** on `sanopos.com/backup-restore` (owner's OK, Playwright): **12 s**, file `backup-2026-09-29.pgdump`, **1.95 MB** (pg_dump 17.11 custom format, gzip, 3,304 entries, 326 tables of `tenant_onetoystore`). Saved at `.playwright-mcp/ots-backup-2026-09-29.pgdump` (git-ignored). Server logged it in `tenant_onetoystore.backup_log` (success, 10.9 s). No shop data changed.
- Restored into a **local scratch DB** `ots_restore_test` (never prod): needs `CREATE EXTENSION btree_gist` first (the appointments overlap constraint uses it; extensions aren't in a schema dump), then `pg_restore --exit-on-error` → **0 errors, 8 s**.
- **17 of 17 checks identical to live prod**: 326 tables, 10,049 products (10,044 live), 21,680 units, stock at sale price 32,252,510, 35 sales, 121,970 not-voided total, 63 sale lines, payments 127,812.50, 1 return, shift 1 48,520 / −10,340, 1 customer, 45 categories, 22 suppliers, 1 employee, 4,551 stock movements, 1 receipt template.
- **How a real restore would go:** by Claude with `pg_restore` (extension first), with the owner watching, never the page's Restore button (it replaces the live shop with no undo; it's switched off for the shop via `tenant_data_restore`, default off).
- The page's Backup Log went 0 → **1 entry** after Refresh Log.
- Side check while comparing: live units 21,680 = import 21,648 − 70 sold + 1 void + 1 return − 1 (2703) **+ 100 (`0050` BALL-WHISTLE-ERASER-BUBLE-MIX ITEMS, adjustment 15:40)** + 1 (`2106` ACTIVITY WALKER, adjustment 17:06), both done at the counter with reason "Other". Ledger balances. Owner confirmed 2026-09-29: the +100 on `0050` was deliberate.

**Nightly habit (added to the routine):** after Close Shift, open **Backup & Restore → Download Backup**, then move the file into a Google Drive folder (e.g. "SanoPOS backups"). Later: make it automatic (a server job that writes the file somewhere safe every night), so it doesn't depend on someone remembering.

## Testing the whole app: sidebar check + page list (2026-09-29, owner question)

Owner: "a lot of moving parts… how will we test each and every part? First I want to be sure everything we built is actually showing on screen."

**Check 1: code vs sidebar (Playwright, admin login `hassan`, prod, 2026-09-29 23:20).** `frontend/src/ui/nav-config.js` defines **122** sidebar entries in 21 groups. The shop sees **75** in 13 groups: **every entry it's allowed to see is there.** The **47 hidden** are all explained by switches that are off for a toy shop: Field Sales (4), Restaurant (12), Appointments (5), Service Operations (3), Rentals (3), Rooms (5), Clinical (6) groups; Subscriptions, Production (`kit_bom_engine`), Expiring Soon (`batch_expiry_tracking`), Backorders (`wholesale_backorders`), Commissions (mode off), FBR Invoices (`fbr_integration`), Customer Notifications, Manufacturer Partners, Forms. Nothing the shop should have is missing.

**Check 2: routes with no sidebar link.** `routes/appRoutes.jsx` has 159 routes; 42 have no sidebar entry. All reachable from inside another page (product edit/History `/products/:id`, Shopify/WooCommerce settings from Integrations, the 20 `/reports/*` from Reports, `/profile` from the account menu, price book from Customer Groups, etc.) **except 4 empty placeholders** (`/lookup`, `/custom-fields`, `/partners`, `/shopcast`: "coming soon", nothing built). The pilot's own work is all reachable: labels to reprint (Barcode Templates), Update prices (Import), product History tab (Products → item), Pay supplier (Suppliers / Supplier Payables), backup (Backup & Restore).

**Check 3: every one of the 75 pages opened** (view only, 25 s each max): **75/75 load**, **0 failed server calls (no 4xx/5xx)**, no error screens. Four flags were false alarms (item codes containing "404"; Integrations cards say "automatic background sync coming soon" for Woo/Instagram/WhatsApp/Google). Side effects of just opening pages: `POST /api/pos-devices/register` (POS page records this browser's "last seen" in `pos_device_registry`, row 9) and `POST /api/attendance/pin-outlets` (read-only list). No sales/stock/shift data touched. Seen on the way: Promotions renders all 10,044 items into its page (237k characters of text), the D44 pattern.

**How the whole app gets tested (answer to the owner):**

1. **Switch off what the shop doesn't use** (Setup → Business Modules, one module at a time, using its impact preview, owner OK each: prod write). Fewer pages = less to break, less to confuse staff.
2. **Every page the shop does use gets a real task done once in the shop with Claude watching** (like day 1: sale, exchange, adjustment, close shift, backup), plus the automated tests that already cover the retail core (shop-day 112, `ots-retail-core` 47, `ots-supplier-account` 23, `ots-label-reprints` 19, `ots-shopify-stock` 18, `ots-offline` 14).
3. **The nightly dual-run check** catches money and stock mistakes on every page that touches them, every day.
4. A page switched on later is tested when it's switched on.

**Claude's suggested split of the 75 (owner to confirm or change):**

| Group | Use: must work | Not now: switch off / leave alone |
|---|---|---|
| Overview | Dashboard, Notifications | |
| Sell | POS, Kiosk (clock-in), Returns, Parked Sales, Sales History | Orders (web orders: after Shopify goes live), Quotations, Holds & Layaway, Return Policies |
| Customers | Customers | Customer Groups, CRM, Loyalty Tiers, Gift Cards, Customer Invoices, Inbox, Campaigns, Review Moderation |
| Catalog | Products, Categories, Brands, Promotions | Attribute Sets, Price Lists, Smart Collections, Scheduled Changes |
| Inventory | Inventory Audit (stock count), Stock Adjustments, Reorder Alerts | Transfers (one location only), Intelligence |
| Procurement | Suppliers, Purchase Orders, Supplier Returns, Supplier Payables | |
| Fulfillment | | Fulfillment, Courier Settings, COD Settlements |
| Finance | Cash Management, Expenses | Approvals, Accounting, Chart of Accounts, Journal Entries, Credit/Debit Notes, Post-Dated Cheques |
| Insights | Reports | Report Builder, Retail Risk (page only: its variance-PIN rule stays on) |
| People | Employees, Attendance | Scheduling, HR |
| Compliance | | Taxes, FBR Settings, Tax Lookup (not GST registered) |
| Setup | Company Profile, Receipt Templates, Barcode Templates, Printer Settings, Import Data, Backup & Restore, Business Modules, Integrations (Shopify, later) | View Storefront, Outlets, Outlet Tax Profiles, POS Layouts, Import from Shopify/Square |
| Account | Billing, My Tickets, Administrator, Action History | |

About **41 to prove, about 34 to switch off**. Some "not now" pages have no module switch; those are just left unused. Loyalty points are earned at the till today (day 1 test customer got 48): decide whether to keep them.

## Fixes, in order

Each fix follows the same path: write a test that **fails on today's code** → fix → full related tests pass → try it on screen locally → owner OK → deploy (push `main`, Vercel + Railway) → check live → first real use in the shop. Recorded in `PROGRESS.md` under its D number.

Order reason: F1–F4 affect **every night's** reconciliation and the family WhatsApp report; F5 blocks stock work (R4, R5); the rest are clean-up.

### F1: Discount on a return / exchange (D48) 🔴

- **Problem:** in Return/Exchange, when the customer owes a balance, the whole balance must be paid (`POSReturnExchangeModal.jsx:350-358`); there's no way to waive part of it. Day 1: Rs 40 recorded as Card that was never taken.
- **Build:** a "Discount" amount (and %) on the exchange's balance, needing the same permission as a till discount (`pos_discount`); the new bill shows it as a discount; the payment is only the rest (can be 0).
- **Also look at:** the exchange stores the returned value in `sales.discount_amount` (line 374), so discount totals in reports include return credit (day 1: 3,450 instead of 2,500). Check which reports read it before changing anything; at least keep the real discount apart.
- **Test:** exchange 950 back / 990 out / discount 40 → bill total 0 due, no Card line, stock both ways, shift card total unchanged.
- **Day 1's Rs 40 (INV-00004):** leave as is with a note (Q4 answered 2026-09-30: leave it).

### F2: "Online transfer" payment type (D52) 🔴

- **Problem:** the till offers only Cash, Card, Wallet (store credit) and optional Gift Card / On Account; transfers are rung as Card, so card ≠ bank settlement.
- **Build:** a till button **Online** (name per Q2) with an optional reference box; saved as its own `sale_payments.payment_method` (the server already accepts any method name, `schemas/sales.js:42`). Kept out of the drawer and out of Card. Shown on the receipt, Sales History, the day slip (F4) and the payment reports. Refunds on such a bill offered back as Online.
- **Check first:** every report and screen that groups by payment method (so the new name isn't dropped or lumped into "Other").
- **Test:** sale paid Online → close shift expected cash unchanged; card total unchanged; reports show an Online line.

### F3: Cash paid out of the till (D50) 🔴

- **Problem:** till expenses aren't known to the shift; every close shows them as a shortage.
- **Build:** a **Paid out** button on the till (amount, category, note), saved as an expense linked to the open shift and marked "paid from till cash". Close Shift's expected cash = float + cash sales − cash refunds − **till paid-outs** (`routes/shifts.js:126-150`). The Expenses page gets a "Paid from: Till cash / Bank / Other" field. `expenses` already has `shift_id`; needs one new column for where it was paid from (migration).
- **Setup:** expense categories for the shop (the owner lists them; prod has none).
- **Test:** float 1,000 + cash sale 500 − paid-out 200 → expected 1,300; a bank-paid expense doesn't change it.

### F4: End-of-day slip (D51) 🟡→ needed daily

- **Problem:** Close Shift shows Expected / Counted / Variance on screen only; the shop photographs the iPOS "Daily Sale Report" slip for the family WhatsApp group.
- **Build:** after Close Shift, **Print day report** on the thermal printer in the iPOS layout: per payment type (Cash / Card / Online) sub total, discount, net; bill count; returns; grand total; till paid-outs; float, expected, counted, difference. Also reprintable for any past shift. Uses the same mm-sized slip printing as the receipt (D45).
- **Test:** the slip's numbers equal the SQL for that shift; day 1 as the worked example (sub total 124,470, discount 2,540 in iPOS terms).

### F5: Find an item by code or barcode in Adjustments / Transfers / Promotions (D44) 🔴

- **Problem:** the product box is a plain list of all 10,044 items (`StockAdjustmentsRedesign.jsx:235`, `TransfersRedesign.jsx:216`, Promotions); scanning or typing a code does nothing.
- **Build:** the same search box the till uses (name, code, barcode, scanner), and a free-text note on adjustments.
- **Test:** scan `027084120134` → MATTLE HW DINKEY selected; type `2703` → FLYING DISC BALL.

### F6: Voided sales visible in Sales History (D47) 🟡

- `GET /api/sales` always hides voided sales (`routes/sales.js:168`); make it follow the page's All / Voided tabs.

### F7: Card payments on prod stop hitting the sandbox gateway (D46) 🟡

- Prod has `PAYMENT_GATEWAY=sandbox`, so each Card line gets a fake `sandbox_inline_…` reference. Check what else reads that variable (subscription billing checkout), then change the Railway variable with the owner's OK. No code change expected.

### F8: Email receipt header (D45 leftover) 🟡

- The header lines run together and header/footer text isn't escaped in the email version. Match the printed slip.

### Smaller, when passing

- A void doesn't take back the customer's loyalty points (day 1 test customer kept 48).
- D42 (sign-up takes ~21 s with no progress message) and D43 (stale login for a deleted shop): not for this shop; leave.

## After iPOS is dropped (not Phase F)

- **Shopify live store** stock sync (Phase C proved it on the test store; the live store needs a Dev Dashboard app with Custom distribution, webhooks to `api.sanopos.com`, and the Mappings tab).
- **Card settlement tracking:** each day's settlement minus the bank's fee (~2%, per bank) into a running "money in bank" figure (idea).
- Supplier opening balances from the registers (D13 screens are ready).

## Questions for the owner (one at a time)

- ~~**Q1 (R7):** backups~~ ✅ answered 2026-09-29: **no Supabase Pro**; nightly **Download Backup** from the Backup & Restore page (proven, see R7 proof).
- ~~**Q2 (F2)**~~ ✅ answered 2026-09-29: **one "Online" button**; pressing it shows **ready-made choices to click** (no typing), in this order: **EasyPaisa, JazzCash** (most used), then the shop's bank accounts **Allied, Meezan, MCB, HBL, Alfalah** (for bank transfers). Saved/shown as e.g. "Online – JazzCash". Keep the list editable later (banks change).
- ~~**Q3 (R1)**~~ ✅ answered 2026-09-29: **7 days is fine**; more if needed.
- ~~**Q4 (F1)**~~ ✅ answered 2026-09-30: **leave INV-00004's Rs 40 as recorded**, with a note (never correct it).
- **Q5 (F3):** ▶ partly answered 2026-09-30 from the register page for 29 Sep (Urdu, total 10,470 checks): staff food (10) 3,000; gas cylinder refill for the staff flat 1,000; medicine / Ishtiaq 170; home expenses DHA 5,000; coffee 1,000; Aslam food 300. **Draft categories:** Staff food · Staff flat (gas refill etc.) · Tea / coffee · Staff medicine / advance · **Owner / home (owner's drawing, kept out of profit)** · Shop supplies · Transport / delivery · Other (with note). Owner will send 4–5 more days of register pages to finish the list.
  - Shop facts given with it: open **11:00–21:00 daily**; **10 staff + 1 cleaner**; the owner rents a **flat near Packages Mall** for staff (most are from outside Lahore) and pays its gas refills. (SanoPOS has 1 employee today.)
- **Q6:** does iPOS hold anything else the shop relies on (customer credit / udhaar, supplier balances, staff salaries)? If so it must move before R9.
