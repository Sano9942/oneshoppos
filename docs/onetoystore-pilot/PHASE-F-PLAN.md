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

## Fixes, in order

Each fix follows the same path: write a test that **fails on today's code** → fix → full related tests pass → try it on screen locally → owner OK → deploy (push `main`, Vercel + Railway) → check live → first real use in the shop. Recorded in `PROGRESS.md` under its D number.

Order reason: F1–F4 affect **every night's** reconciliation and the family WhatsApp report; F5 blocks stock work (R4, R5); the rest are clean-up.

### F1: Discount on a return / exchange (D48) 🔴

- **Problem:** in Return/Exchange, when the customer owes a balance, the whole balance must be paid (`POSReturnExchangeModal.jsx:350-358`); there's no way to waive part of it. Day 1: Rs 40 recorded as Card that was never taken.
- **Build:** a "Discount" amount (and %) on the exchange's balance, needing the same permission as a till discount (`pos_discount`); the new bill shows it as a discount; the payment is only the rest (can be 0).
- **Also look at:** the exchange stores the returned value in `sales.discount_amount` (line 374), so discount totals in reports include return credit (day 1: 3,450 instead of 2,500). Check which reports read it before changing anything; at least keep the real discount apart.
- **Test:** exchange 950 back / 990 out / discount 40 → bill total 0 due, no Card line, stock both ways, shift card total unchanged.
- **Day 1's Rs 40 (INV-00004):** leave as is with a note (Q4).

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
- ~~**Q2 (F2)**~~ ✅ answered 2026-09-29: **one "Online" button**; pressing it shows **ready-made choices to click** (no typing), e.g. EasyPaisa / JazzCash / Bank app. The exact list is to be confirmed with the owner.
- **Q3 (R1):** is 7 clean trading days in a row the right bar?
- **Q4 (F1):** leave day 1's Rs 40 on INV-00004 as recorded (with a note), or correct it once the fix exists?
- **Q5 (F3):** the expense categories the register uses (e.g. tea, transport, staff advance…).
- **Q6:** does iPOS hold anything else the shop relies on (customer credit / udhaar, supplier balances, staff salaries)? If so it must move before R9.
