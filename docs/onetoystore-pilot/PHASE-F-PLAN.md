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

## Deploying while the shop is open (added 2026-10-01, after the F3b part 1 deploy)

**What happened (2026-10-01 14:08–14:15):** after the deploy (Railway `1239ca6e`, SUCCESS in about a minute), Railway's network edge was slow for about 5 minutes: `/api/health` took **1 to 26 s** end to end while the server itself answered in 1–3 ms (the logs show the requests *arriving* late). The new code was not the cause; it adds nothing that runs in the background. The screen hung on **"Loading session…"** twice (D53: page start has no time limit, so one hung request leaves the till on that screen). It settled by itself; 12 of 12 checks were under 1 s at 14:15. The same happened after the 30 Sep deploy (flaky about 2 min) and with the 30 Sep 12:35 outage.

**What to do from now on:**
1. **When to deploy:** prefer before opening (before ~12:30) or after Close Shift. If a fix can't wait, deploy in a quiet moment, check SQL first (no bill being rung, last bill time), and **tell the counter first**: "the till may freeze for up to 5 minutes; nothing is lost."
2. **Before saying "live":** run 10–12 health checks in a row; only call it done when all are under ~2 s. Then load the live screen.
3. **At the counter, if the till freezes or shows "Loading session…":** wait a minute, then refresh once (Ctrl+Shift+R). **Before ringing a bill again, look in Sales History** to see if it already went through: never ring the same bill twice. Paid out / Paid in have no offline queue yet: if one fails, write it in the register and enter it after.
4. **Fix in code (D53, with F4):** put a time limit on the page-start requests (`AuthProvider.jsx` boot) so a hung request falls back to the saved session instead of hanging forever; then a slow network can't freeze the till.
5. If it lasts **more than 10 minutes**: check `railway status` / Railway's status page; the counter keeps selling in iPOS and SanoPOS bills are entered after (as during the 30 Sep outage).

## Rules for "ready to drop iPOS"

All must be true. Claude checks each one and records it; the owner decides.

| # | Rule | How it's checked |
|---|---|---|
| R1 | **30 trading days in a row** (owner 2026-10-02: was 7; extended so supplier bills, stock counts and rarer cases are seen for real) where SanoPOS cash, card, online and total equal iPOS, or the difference is written down and explained (e.g. a known defect) | Nightly check, a table per day in `PROGRESS.md` |
| R2 | The 🔴 fixes are **deployed and used for real in the shop**: F1 exchange discount, F2 online transfer, F3 till paid-out, F4 day slip, F5 item search by code | Each fix: test, deploy, then a real use seen in the database |
| R3 | **After R1, the drawer balances** in SanoPOS on its own: the close-shift difference is within Rs 100 with till expenses entered in SanoPOS (not the register) | `cash_shifts.variance` for the last 3 days |
| R4 | **Stock is right:** after a week, the owner counts 20 random items on the shelf and they match SanoPOS (differences explained). No unexplained negative stock | Stock count page, or SQL on 20 SKUs |
| R5 | **Stock arriving is received in SanoPOS** at least once for real (supplier bill / receive goods, new items, price changes, labels) | Real receiving seen in History + labels list |
| R6 | **The counter works with the internet unplugged** (Phase E leftover): 2 bills offline, plug back in, both arrive with the right time and shift | Owner in the shop, Claude on SQL |
| R7 | **A copy of the shop's data exists every day that we can restore from.** Prod is on Supabase **Free: no backups**. **Q1 answered 2026-09-29: no Supabase Pro; use Backup & Restore → Download Backup nightly.** ✅ Proven once 2026-09-29 (below). Still needed for the rule: the nightly habit kept for the 30 days, files stored off the shop PC | Backup log (`tenant_onetoystore.backup_log`) shows one row per night; one more test restore before iPOS is dropped |
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

**Agreed order (owner, 2026-09-30):** F1 → **D54 hourly times** → F2 → F3 → **F3b staff account** → F4 → F5 → **F9 receive supplier bill** (added 2026-10-02: **D60 till search order**, **D61 till top bar**, **D62 instant top-box add**, owner asked; small, next deploy) → G1–G5 (report gaps, below) → F6 → F7 → F8.

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
- **Design agreed with the owner 2026-09-30 (Q5, 10 register pages read; answers Q5.1–Q5.12 below).** Everything written in the register's EXP column leaves the drawer, but it is five different kinds. **Every kind comes off Close Shift's expected cash; only "Shop cost" and "Discount after sale" lower profit.**

  | Kind on the Paid out button | Pick | Counts in profit? | Also does |
  |---|---|---|---|
  | **Shop cost** | Staff food · Tea / coffee · Water bottles · Staff flat (gas, water, bills) · Cleaning · Staff medicine · Petrol / car · Courier / sending goods · Repairs · Tax & government · Charity · Other (note) | yes (expense) | — |
  | **Pay supplier** | the supplier | no (stock was the cost) | lowers what the shop owes that supplier (Supplier Payables) |
  | **Owner / home** | note (DHA home, school fees, credit card, loan to brother…) | **no** (owner's drawing, own total per month) | — |
  | **Staff advance** | the staff member | no (a loan) | saved per person; the full staff account comes right after F3 |
  | **Discount after sale** | bill number | yes (as a discount on that day) | linked to the bill, no stock moves |

- **Current code found (grep 2026-09-30):** Close Shift (`routes/shifts.js:125-150`, by outlet + time window) and the dashboard cash position (`routes/reports/dashboard.js:520-575`, by `shift_id`; its comment claims paid-outs are subtracted, the code doesn't) both ignore expenses. Cash Audit / Shift Summary (`routes/reports/shifts.js:70-85`) list only cash sales + cash returns. Expenses page edit **wipes `shift_id`** (`ExpensesRedesign.jsx:161` never sends it; `barcode-expenses.js:347` writes NULL) — fix in F3. Dashboard today profit (`dashboard.js:191`), finance report, accounting P&L subtract **every** expense row (so owner/home must not be an expense row, or must be excluded). `supplier_payments` has `payment_method` (default 'Cash') but no shift link. `expenses` POST/PUT need `manage_inventory` via PERMISSION_RULES. HR payroll has only a single `deductions` number: no advances ledger, no staff purchases.
- **Who can pay out:** the owner login now; later staff with their own till login, with who-did-it recorded (a permission that can be given to a staff role).
- **Before F3 goes live (owner inputs):** (1) **list of what the shop owes every supplier** → opening balances entered on prod with the owner's OK (Q5.6: "enter all balances now"); (2) **names of the 10 staff + cleaner** → added as employees with no till login (Q5.11).

**Owner's lists, 2026-09-30 ~17:40 (photos; my reading, to confirm before any prod write):**

Supplier balances ("Register payment" as of 30/9/2026) → matched to prod `suppliers`:

| # | Paper | Owed | Prod supplier (id) |
|---|---|---|---|
| 1 | Toys and Toys | 3,857,786 ✅ owner | TOYS AND TOYS LAHORE (22) |
| 2 | Smart Toys | nil | SMART TOYS (20) |
| 3 | Al Hassan Traders | 324,445 | AL HASSAN TRADERS (4) |
| 4 | J.B.D | 71,558 | JAHANGIR BOOKS LAHORE (12) ✅ owner |
| 5 | AtoZ | 133,040 | A TO Z CONSUMERS (1) |
| 6 | Tooba stuff | 256,335 | TOOBA STUFF TOYS LAHORE (21) |
| 7 | Rabia books | 38,461 | RABIA BOOKS LAHORE (16) |
| 8 | Nawaz sb | nil | HAFIZ NAWAZ (10) ✅ owner |
| 9 | Baby Land | 1,126,110 | BABY LAND LAHORE (9) |
| 10 | Hafiz Brothers | 387,170 | **new supplier to add** (owner: not Hafiz Nawaz) |
| 11 | Arif Khan | 1,334,084 | ARIF KHAN KARACHI (7) |
| 12 | Rehmat Toys | nil | REHMAT TOYS RWP (18) |
| 13 | Akbar stationers, Rawalpindi | nil | AKBAR & CO STATIONERS (3) |

Total owed on paper: **7,528,989**. Prod suppliers not on the list: Adeel Toys Karachi, Amir Stationer, Aqeel Stuff Toys, Azmat Stationery RWP, Hong Kong, KK Sports, Local Items Shah Alam, One Shop Gulberg, Rehman Stuff Toys, Saad Stationer. (A third column "Cost in computer" is empty.)

Staff (monthly salary, leave days allowed per month): Ishtiaq Shah 36,500 / 6 · Mubashir Shah 36,500 / 6 · Naeem Shah 42,000 / 6 · Basharat Ali 48,500 / 5 · Tahir Mushtaq 30,500 / 5 · Atiq Ali 33,500 / 5 · Kelash Kumar 34,000 / 6 · Ubaid Awan 32,000 / 6 · Fahad Iqbal 23,000 / 5 · Ramzan 27,500 / 5 · Usman (sweeper) 10,000 / 4. Monthly total 354,000. **Leave rule (owner, confirmed):** each unused allowed day is paid extra at salary ÷ 30; each day taken beyond the allowance is cut at salary ÷ 30. So pay = salary + (allowed − taken) × salary ÷ 30 (negative when over), minus advances / staff purchases being cut that month (F3b).

### F3b: Staff account (after F3, owner 2026-09-30)

- Per staff member: advances (from Paid out) + **toys taken at cost price**; settled by cash paid back into the till (a "Paid in") or **cut from salary**, sometimes carried to the next month's salary on request. Salaries are paid in cash from the drawer at month end (Q5.4). The owner wants SanoPOS to track all of it.
- **Deadline (owner, 2026-10-01):** September salaries are paid from the drawer **within 4–5 days** (by ~5–6 Oct), so F3b goes **before F4**.
- **Current code found (grep + read-only prod SQL, 2026-10-01):**
  - Paid out kinds (`services/till-payouts.js:19-25`) are Shop cost / Pay supplier / Owner-home / Staff advance / Discount after sale: **no Salary kind**, and none of the 12 shop-cost categories is salary. Paying salaries today would have no right slot.
  - Paid in already has **Staff pays back** (`till_payins.staff_employee_id`); Paid out Staff advance saves `till_payouts.staff_employee_id`. Prod: 1 advance, **Tahir Mushtaq 15,000** (payout 11, shift 2), 0 pay-backs.
  - `employees` has `salary_type`, `monthly_salary`, `monthly_leave_allowance`. Prod: the 11 staff have the right salaries (total 354,000), but **every allowance is 2** (column default), not the owner's 4/5/6.
  - The existing HR payroll (`routes/tier4/hr.js:206-370`, `POST /api/hr/payroll/periods/:id/generate`, needs `advanced_hr`) **does not fit this shop**: it cuts a day's pay for every day without a kiosk clock-in, only cuts excess leave (never pays unused days extra), ignores advances and staff purchases, and pays nothing from the till. **Prod proof:** someone ran it on 2026-09-30 22:41 (period 1 "sep", 28–30 Sep, finalized): **all 11 staff net pay 0** ("Absent: 30d"). Nothing was paid; the rows are harmless but wrong.
  - Leave: `leave_requests` exists (0 rows on prod); staff don't clock in (owner: kiosk too soon), so attendance can't count leave.
  - Staff toys at cost: no way today (a sale is at price; On Account needs a customer).
- **Owner answers (2026-10-01), one at a time:**
  - **Q3b.1 Leave taken:** the shop keeps a **paper attendance register**, marked for the whole month. → On the Salaries page the owner **types each person's days off from the register** (no kiosk, no leave requests).
  - **Register for September 2026 (3 photos, 2026-10-01), my reading:** 11 rows, P = present, circled A = absent, bottom row = staff present that day (counts the 10 sales staff, not Usman). Remarks column = **allowed − A days**, and matches every allowance on the owner's list:

    | # | Register name | Prod employee | A days | Allowed | Remark |
    |---|---|---|---|---|---|
    | 1 | Syed Ishtiaq | Ishtiaq Shah (2) | 1–6 = 6 | 6 | ok (0) |
    | 2 | Mubashir Shah | (3) | 0 | 6 | +6 |
    | 3 | Naeem Shah | (4) | 0 | 6 | +6 |
    | 4 | Basharat Chohan | Basharat Ali (5) | 1–7 = 7 (+ Urdu marks 28, 29) | 5 | −2 |
    | 5 | Attiq ur Rehman | Atiq Ali (7) | 0 (correction 25–26) | 5 | +5 |
    | 6 | Tahir Mushtaq | (6) | 0 | 5 | +5 |
    | 7 | Kelash Kumar | (8) | 0 | 6 | +6 |
    | 8 | Fahad Ali | Fahad Iqbal (10) | 1–4 = 4 | 5 | +1 |
    | 9 | Ubaid Awan | (9) | 0 (Urdu marks 15, 16) | 6 | +6 |
    | 10 | Ramzan Ali | Ramzan (11) | 0 (Urdu marks 19, 21) | 5 | +5 |
    | 11 | Usman Safaiwala | Usman (12) | 26 = 1 | 4 | +3 |

    Days with an Urdu mark are **not** counted as leave in the remarks (to confirm with the owner). At salary ÷ 30: e.g. Mubashir 36,500 + 6 × 1,216.67 = 43,800; Basharat 48,500 − 2 × 1,616.67 = 45,266.67 (rounding to ask).
  - **Q3b.2 Digital register (owner asked):** yes, build an on-screen **attendance register**: month grid, one row per staff member, a box per day; click to mark P / A (and the other marks); per-day "present" count at the bottom and per-person **A days / allowed / ±** at the right, which feeds the Salaries page. Replaces typing days off.
  - **Q3b.3 Advances:** Tahir's 15,000 (30 Sep) is **not** the only one; the owner gave advances all month and will send the list (~1 hour).
  - **Q3b.5 Urdu marks = sick** (owner): Ubaid 15–16, Ramzan 19 + 21, Basharat 28–29 were sick and didn't come; not counted against the allowance today.
  - **Q3b.6 Owner wants clock-in to fill the register**, not clicks ("anyone can click a box"). Code check: kiosk `POST /api/attendance/pin-checkin` / `pin-checkout` + `attendance_sessions` already record in / break / back / out per person (bcrypt PIN). `PUT /api/attendance/:id` (edit) needs `manage_employees` but **records no history** of who changed what. **Blocker before staff get PINs:** `/api/auth/login` accepts name + PIN for an employee with no password, and a no-permission user still reaches "all authenticated" POS routes (found 30 Sep) → a staff PIN must work **only** at the kiosk. Prod staff PINs today are random and unknown (set 30 Sep).
  - **Claude's suggestion (to confirm):** (1) close the login hole first; (2) give each staff member their own PIN, kiosk on the counter PC, clock in / break / back / out; (3) the register page **fills itself from clock-ins** (P with times on hover; no clock-in by closing = A), boxes **not clickable by staff**; (4) only the owner can change a box (forgot to clock in, sick), must pick a reason, and the change is **kept with who + when**; (5) mark **S = sick** as its own letter, shown in its own total, not taken from the monthly allowance (as the owner does now); (6) **September (and any days before clock-in starts) entered once from the paper register** by the owner, with reason "from paper register"; salaries this week use that.
  - **Q3b.7 Owner agreed (2026-10-01)** to the whole suggestion above.
  - **Q3b.8 Owner wants photo AND fingerprint at clock-in** (against PIN sharing).
    - **Photo:** reuse the field-rep selfie (`routes/field.js:165-240` takes `selfie_base64` → R2; `FieldCheckInRedesign.jsx` + `utils/imageCompress.js` use the camera). Needs a webcam on the counter PC. Photo shown beside each clock-in on the register page. Fits F3b.
    - **Fingerprint:** a web page **cannot read a plain USB fingerprint reader**. Options: (a) a **stand-alone biometric attendance machine** (ZKTeco-type, the usual choice in Pakistani shops/offices) that keeps its own log; SanoPOS takes its log, first by importing its file, later live over the network (its "push" protocol); (b) one **fingerprint security key per staff member** (WebAuthn), costly per person and losable; (c) Windows Hello fingerprint on the counter PC: **no**, it knows only the PC's Windows user, not which staff member. Claude recommends (a), as a separate step after F3b (salaries can't wait for hardware).
  - **Q3b.9 No fingerprint machine in the shop.** Owner offered a spare **Samsung Galaxy S5 / S6 edge / S7 edge**. Answer given: its fingerprint reader **can't tell staff apart** (Android and web pages only learn "a finger saved on this phone matched", never whose, and it holds ~5 fingers), so it can't stop PIN sharing. It **can** be a clock-in station by the door (PIN + front-camera photo) if its browser is new enough for SanoPOS (these models stop at Android 5–8; Chrome no longer updates on them) → test on the phone before relying on it.
  - **Q3b.10 Clock-in station:** counter PC has **no webcam** → use the **spare phone** for now; build so a **webcam on any PC works the same** (same browser camera code), as the fallback if the phone doesn't work well.
  - **Q3b.11 Rounding:** salary to pay is rounded to the **nearest Rs 10** (Basharat 45,266.67 → 45,270).
  - **Q3b.12 Staff purchase at the till (owner OK):** scan → **Staff** button → pick the person → price becomes **cost**, bill marked "Staff purchase" (not a discount, not a normal sale) → **Cash now** (into the drawer) or **Cut from salary** (onto their account, no money) → stock goes down either way. **Cashier may see the cost price for now**; revisit later.
  - **Q3b.13 Staff toys in iPOS today:** pays now (cash, JazzCash, any) → an **ordinary iPOS bill**, stock down; pays at month end → iPOS **"stock credit"** (quantity down, **no bill**) + amount written in the register, cut from salary. → SanoPOS staff purchase payment choices = **Cash / Online / Cut from salary**. For the nightly R1 compare: "Cut from salary" bills have **no iPOS bill**, so they're left out of the comparison and listed separately.
  - **Q3b.14 Price (owner OK, Claude's suggestion):** staff purchase = **normal price + a "Staff" discount down to cost**, the same way in iPOS during the dual-run (so totals and discount totals match). SanoPOS keeps the Staff discount **separate** from customer discounts in reports and shows "staff discounts given" per month.
  - **Q3b.15 Linked to the person:** each staff member gets an **account page** (from Employees and from Salaries): every staff purchase (date, bill, item, qty, normal price, staff discount, paid Cash / Online / Cut from salary), advances, pay-backs, salary cuts, carry-overs, and the running balance; filter by month.
  - **Q3b.16 September advances (owner's sheet "سٹاف ایڈوانس", confirmed by the owner 2026-10-01; the sheet drops the last zero):** Ramzan 12/9 5,000 + 18/9 2,000 + 28/9 13,000 = **20,000** · Ubaid 13/9 4,000 + 20/9 4,000 = **8,000** · Atiq 18/9 **15,000** · Basharat 20/9 **5,000** · Usman (sweeper) 22/9 **5,000** · Tahir 30/9 **15,000** · total **68,000** ✅. Tahir's 15,000 is already on his account as the till paid-out (payout 11, shift 2): **don't add it again**. The other five (**53,000**) go in as "Advance (paper register)" with their dates (owner OK first; prod write).
  - **Where F3b meets the sidebar (owner asked 2026-10-01; money/stock/drawer touch-points done in this build, view-only pages later):**

    | Page | Change |
    |---|---|
    | Sell → POS | **Staff** button (staff purchase at cost); Paid out gets **Salary**; Paid in "Staff pays back" feeds the staff account |
    | Sell → Kiosk | photo at clock-in; staff PIN works **only** here |
    | People → Attendance | register view (month grid, P / A / S, owner corrections with reason + history) as a tab |
    | People → Employees | leave allowance (fix the 2s) + staff account balance |
    | People → HR | its payroll (all net 0 on prod) replaced by the new **Salaries** page for this shop; HR stays "switch off" |
    | Finance → Cash Management, Dashboard cash in drawer, Close Shift, Cash Audit | salary paid-outs + staff cash purchases counted (same code path as paid-out / paid-in) |
    | Finance → Expenses, profit (Dashboard / Reports) | salaries = shop cost; advances not (loan); staff purchases = sale at cost, 0 margin |
    | Sell → Sales History, Insights → Reports (payment summary, item-wise) | staff purchases labelled; "Cut from salary" its own method, never cash/card |

    Not touched: hidden/switched-off groups, Catalog, Procurement, Customers.
  - **Retail practice on sick days (told to owner, not legal advice):** big retailers keep sick leave **separate** from casual/annual leave, often ask for a doctor's note after 2–3 days in a row, and cap it per year (beyond the cap = unpaid). Pakistan's shops law (West Pakistan / Punjab Shops and Establishments Ordinance 1969) gives roughly 10 days casual leave on full pay, 16 days sick leave on **half** pay a year, and 14 days annual leave after a year's service; the owner's current rule (sick days not cut) is more generous. Confirm with an accountant before writing a policy.
  - **Part 2 (Staff button at the till) — grep + read-only prod SQL, 2026-10-01 14:35:**
    - **Costs on prod:** 10,044 products, **1 with no cost**, 0 with cost above price, 0 variants; tax_mode `none`, 0 taxed products, 0 promotions; ringers: `hassan` (Administrator) only, 11 staff on role "Staff". → a staff bill can always be computed as Σ cost × qty; a line with no cost is refused ("no cost price"), never sold at 0.
    - **Cost is hidden from cashier-type logins** (`routes/products.js:183-207` strips `cost_price` unless all_access / manage_inventory / view_*_reports). → the till never needs cost in the product list: a new server quote `POST /api/staff-pay/staff-quote` returns each line's cost and the staff discount, and **POST /api/sales recomputes it** (never trusts the till).
    - **Sale total** (`routes/sales.js:1437-1511`): subtotal − discount − autoDiscount (price books/loyalty, only with a customer) − points + exclusive tax. → a staff purchase takes **no customer, no points, no manual discount**; server sets `discount_amount` = subtotal − Σ cost, `discount_type` = **'staff'** (free text, no CHECK), new **`sales.staff_employee_id`** (migration v150).
    - **Payment methods** are free text (`schemas/sales.js:42`); drawer counts only exact `'Cash'` (`routes/shifts.js:134,145`, `reports/dashboard.js:538,545`). → new method **"Cut from salary"** is out of the drawer, Card and Online automatically; the server refuses it on a bill that isn't a staff purchase, and a staff purchase accepts only Cash / Online - … / Cut from salary.
    - **Staff account** (`services/staff-pay.js` ACCOUNT_SQL): add + "Cut from salary" payments of not-voided staff bills; − returns of those bills refunded as "Cut from salary" (`returns.refund_method` is free text, `schemas/returns.js:23`). A void drops it on its own (voided filter). The account page also lists **every** staff purchase (Cash / Online too: date, bill, item, qty, price, staff discount, how paid).
    - **Discount totals** that would mix staff and customer discounts: dashboard discount card (`reports/dashboard.js:113-114`), sales report discount value (`reports/sales.js:1355`) → staff discount shown on its own line; profit sees a staff bill at 0 margin automatically (revenue = cost).
    - **Till screens:** Staff button + picker (POS sidebar), cart banner "Staff purchase · name" + "Staff discount" line, manual discount / customer / points disabled while on; checkout shows only Cash / Online / Cut from salary; receipt prints "Staff purchase · name" + "Staff discount"; Sales History label + "Cut from salary" filter; Return / Exchange offers "Cut from salary" back on such a bill. Offline: Staff button off (needs the server for cost).
  - **Part 3a (a staff PIN works only at the kiosk) — grep + read-only prod SQL, 2026-10-01 ~17:10:**
    - Where a PIN is accepted: (1) `POST /api/auth/login` (`routes/auth.js:75-90`) and (2) `POST /api/auth/mt-login` (`auth.js:423-442`, the live sign-in) took **name + PIN** for anyone without a password and gave a full 24-hour login 🔴; (3) `POST /api/sales` (`routes/sales.js:617`) had **no permission check**, so a 0-permission login could ring sales 🔴; (4) `POST /api/employees/validate-pin` (`employees.js:64`) didn't skip deleted employees 🟡; (5) the till's "Session Expired" box (`POSSessionExpiredModal.jsx:33`) took **anyone's** PIN 🟡 (the lock screen already checked it's the same person); (6) manager PIN (`services/manager-pin.js`, `approval-policies.js:94`) checks the override permission → safe; (7) kiosk `pin-checkin` → intended; (8) change-password with PIN needs to be signed in as that person → closed by 1–2.
    - Prod: `hassan` has a password; the 11 staff (role "Staff", 0 permissions) only their random PINs; `onetoystore` is the only active shop. All 11 staff are assigned to Packages Mall (`employee_outlets`), so the kiosk will accept them.
    - **Owner chose (17:15): password for EVERYONE** (not only staff). Known gap left out on purpose (owner OK, Claude's recommendation): a shop created by the super-admin (provisioner + setup wizard, `tenant-provisioner-pg.js:129`, `setup.js:467`) or a super-admin "reset PIN" (`admin/tenants.js:944`) leaves the first admin with only a PIN → can't sign in until a password is set. Self-signup sets a password. To fix when such a shop is next created: the setup wizard asks for a password.
    - **Built (part 3a):** shared check `services/login-credentials.js` used by both sign-in routes (no password → "No password set for this person. Use the kiosk to clock in…"; PIN never signs in); `POST /api/sales` needs one of view_sales_reports / pos_discount / pos_park / manage_orders / execute_field_sales (admins via all_access); validate-pin skips deleted employees; Session Expired box accepts only the signed-in person's PIN.
  - **Part 3b (photo at clock-in), 2026-10-01 ~20:00:** grep found the register **already** fills from clock-ins (P + first in / last out) and owner box changes **already** keep who / when / why (prod: 330 marks + 330 log rows = September from paper). Missing: the photo. **Q3b.17 (owner): a photo on EVERY press** (clock in, break, back, clock out). **Q3b.18 (owner): camera fails → the press still goes through, saved "no photo", red on the register.** Spare phone is dead for now (owner trying, tomorrow) → PC webcam path first. Built locally `f3761bfb` (migration **v152** `attendance_presses`; photos to R2 `attendance/<tenant>/<employee>/`, signed links; kiosk uses the browser camera API so phone and PC webcam work the same; register: Clock-ins list with photos, red box + No photo count). NOT deployed.
  - **Q3b.4 Toys at cost:** sometimes the staff member **pays cash** at the time; other times it's **written in the daily register and cut from salary** at month end. → both ways needed.

### F3c: Cash paid into the till ("Paid in") (owner, 2026-09-30) ✅ DEPLOYED 2026-09-30 ~23:25 with D57 + D58 (`4432ece8`, v148)

- **Problem:** the owner tops up the drawer from the bank (30 Sep: Rs 220,000 from Bank Alfalah) or other sources; the register adds it to the note count. SanoPOS has no way to record it, so Close Shift shows it as "over" (and trips the Rs 500 variance-PIN rule).
- **Build:** a **Paid in** button beside Paid out: **From bank** (pick account, same list as the Online button), **From owner / home**, **Staff pays back** (links to F3b). Close Shift expected = float + cash sales − cash refunds − paid-outs **+ paid-ins**; same in the dashboard cash position, Cash Audit and the F4 slip. Not a sale, not profit. Removable while the shift is open.
- **Test:** float 1,000 + cash sale 500 − paid-out 200 + paid-in 300 → expected 1,600.
- **30 Sep shift 2:** closed with the +220,000 explained in the variance reason (owner's choice); not re-opened.
- **Same deploy: D57 cursor jumps out of a box after each key** (owner, 30 Sep ~19:15, on Paid out; "maybe everywhere"). Cause: `ui/primitives.jsx` `Modal` focus effect depends on `[open, onClose]` (since `f437f688`, April); a parent passing a new `onClose` each render (POSPaidOutModal's `close`, any inline arrow) re-runs it on every keystroke → cleanup refocuses the element behind, then the first button in the box gets focus. Hits every primitive-`Modal` form (66 files, back office + Paid out); the sale screen, Return/Exchange and Close Shift use their own boxes (not hit). Fix: keep `onClose` in a ref, run the effect on `open` only; test: type "1000" into a Modal input whose parent re-renders → value 1000, focus stays. Workaround tonight: paste the whole number.
- **Same deploy: D58** Close Shift denomination boxes keep a leading "0" the cashier can't delete (owner typed "0120"; parsed right, total right). Make empty = blank, not 0.
- **Offline:** Paid out has no offline queue; "Failed to fetch" = not saved (30 Sep: nothing lost, 9 saved). Consider queueing it like sales (offlineQueue) later.

### F4: End-of-day slip (D51) 🟡→ needed daily

- **Problem:** Close Shift shows Expected / Counted / Variance on screen only; the shop photographs the iPOS "Daily Sale Report" slip for the family WhatsApp group.
- **Build:** after Close Shift, **Print day report** on the thermal printer in the iPOS layout: per payment type (Cash / Card / Online) sub total, discount, net; bill count; returns; grand total; till paid-outs; float, expected, counted, difference. Also reprintable for any past shift. Uses the same mm-sized slip printing as the receipt (D45).
- **Test:** the slip's numbers equal the SQL for that shift; day 1 as the worked example (sub total 124,470, discount 2,540 in iPOS terms).

### F4b: Home staff (owner, 2026-10-01 night) 🟡 before the ~5–6 Oct salaries

- **Problem:** Aslam (home driver, sometimes helps in the shop) takes advances and sometimes toys, and his salary is paid from the drawer. It's a **home** cost, not a shop cost, but today anyone with a salary counts as shop staff and the Salaries page always books the salary as a shop expense ("Salaries"). On 1 Oct his 30,000 went in as Shop cost (dashboard net profit −5,479); re-filed to Owner / home with owner OK.
- **Build:** a "Home staff" tick on the employee. Home staff: advances (Paid out → Staff advance) and Staff-button toys at cost go on their account as now; **salary on the Salaries page is booked as Owner / home** (till payout, no shop expense row, not in shop profit); not on the shop attendance register / present count, not in shop salary totals.
- **Until built:** Aslam's advances / salary = Paid out → Owner / home, note "Aslam …"; toys as in iPOS + register note, put on his account once built.
- **Owner / home money in general** (e.g. 20,000 "DHA home staff salary" for the maids, DHA home expenses every 1–3 days): Paid out → **Owner / home** is already right (comes off the drawer, never in shop profit). Keep the note starting "DHA …" so it can be totalled. Possible extra with this build: a few owner/home labels (DHA home, maids, …) and a monthly "taken for home" total. Ask the owner.

### F5: Find an item by code or barcode in Adjustments / Transfers / Promotions (D44) 🔴

- **Problem:** the product box is a plain list of all 10,044 items (`StockAdjustmentsRedesign.jsx:235`, `TransfersRedesign.jsx:216`, Promotions); scanning or typing a code does nothing.
- **Build:** the same search box the till uses (name, code, barcode, scanner), and a free-text note on adjustments.
- **Test:** scan `027084120134` → MATTLE HW DINKEY selected; type `2703` → FLYING DISC BALL.

### F9: Receive a supplier bill without a purchase order (owner, 2026-09-30) 🔴 for R5

- **Problem (checked in code 2026-09-30):** receiving only works through Purchase Orders (`routes/purchase-orders.js` receive → GRN → `supplier_invoices`). Fewer than ordered: OK (rest stays outstanding). **More than ordered: refused** (`OVER_RECEIPT`). **An item not on the order can't be added while receiving.** A later bill correction only via Supplier Return (lowers the balance); no "+/− adjustment". **No place to keep the bill file:** `supplier_invoices` holds numbers only; the Import page's invoice-photo reader (`/api/ai/invoice-extract`) takes images only (no PDF) and stores the photo in R2 unlinked to any supplier or bill. The shop gets goods **with the supplier's bill, no PO**; bills arrive as PDF or handwritten.
- **Build:** Receive supplier bill: supplier, bill number, date → items by scan / code / name search (same box as F5), quantity + cost, new toys added on the spot → stock up, bill amount onto the supplier's balance. **Attach the PDF / phone photo** to the bill (listed on the supplier's page). **Bill correction:** +/− line with note (e.g. "3 cars not billed, added 1,350") → balance, and stock when items were short/extra.
- **Order:** right after F5 (owner, 2026-09-30).
- **2026-10-02 eve (owner):** goal = upload the supplier's bill (PDF / photo / any file) and everything is filled in (cost, sale, quantity, name, SKU, barcode, supplier code) on a **check screen before saving**. **No AI** (reason: cost only). Some bills are handwritten. Real sample bills go in `docs/onetoystore-pilot/supplier-bills/` (git-ignored). Checked: **SanoPOS has no "supplier's code" for an item anywhere** (prod `products` / `product_variants` / supplier tables; only `products.supplier_id` = one supplier, and `vendor` = free text); the iPOS export carried none either (its supplier code = supplier number). An old plan named a `product_supplier_codes` table (docs/plans/phase-2g-longtail-inventory.md:52), never built.
- **Owner later (same evening): AI is fine if the cost is justified** (use AI wherever it pays). **Sample bills studied (15 files):** 10 computer-made PDFs, 3 layouts: (a) "Bill No 01 / M100" (Item No · Description · Qty · Rate · Amount; **no supplier name printed**), (b) Baby Land "Sales Estimate" (Product ID · Qty · Unit Price · Amount; also prints Prev Bal / Total Bal / Due Date), (c) INV-226xx (Code · Name · PKG · CTN · PCS · T QTY · Price; **no supplier name printed**). Plain text extraction scrambles the rows, but **reading by word position rebuilds every row exactly** (qty × rate = amount on every row checked) → no AI needed for these. Photos: A2Z Consumers printed invoice (2 pages, item **barcode + supplier code** per line, 5 % line discount, 48 lines, net 138,396) and **3 handwritten cash memos** (qty · particulars · rate · amount; codes in brackets sometimes) → AI or typing. Prod check: our SKU often IS the barcode (iPOS), and many names end in the supplier code ("HSB JENGA GAME-53557", "MAGIC SAND BUCKET KMS-100-1+1M"); a supplier code can clash with one of our SKUs (Hassaan-style bill `1083` = Music Luggage, our SKU `1083` = Archery set) → supplier codes must be looked up **within that supplier only**. AI cost per bill photo (Anthropic list prices 2026-09): Haiku 4.5 ≈ $0.02, Sonnet 5.5 ≈ $0.04, Opus 5.5 ≈ $0.07.
- ✅ **Decided (owner, 2026-10-02 eve): supplier codes per supplier per toy** (several suppliers per toy; a supplier's code looked up only within the bill's supplier; barcodes global; learned on the check screen; seeded from item names that end in a code, owner confirms). Owner raised: one bill line / one code / 10 pieces with **different barcodes per colour or character**. Prod: **0 items use variants, one barcode slot per item, no extra-barcodes table**; 3,124 SKUs are barcodes; 38 names say "asst/assorted". Scenario list given to owner (check screen must cover): line → several toys (colours / assortments); several lines → one toy; box vs piece (PKG/CTN/PCS, "12 box (144 pcs)"); free / bonus pieces; line discount % + bill discount + freight; bill total ≠ lines; supplier's printed previous balance vs ours; paid in cash on the spot vs credit; short / extra / damaged delivery; lines crossed out or circled on the paper (A2Z photo); multi-page bill; same bill uploaded twice; half-done bill saved as draft; mistake after saving (undo while stock unsold); old bills dated in the past; cost up → sale price / labels; new toys → Shopify.
- ✅ **Decided (owner): several barcodes per toy = ONE toy, one stock count, any of its barcodes scans it** (needs an extra-barcodes list per toy: till scan, search, offline copy, bill matching). Separate items per colour only for the few toys where the owner wants it (ordinary separate products).
- ✅ **Owner: always sold by the piece, never by box/carton.** Supplier bills already show the piece count ordered (cartons are opened and counted). **Packs that are split:** one billed item can hold 3 / 6 / 10 pieces (e.g. a rattle pack of 6): they open it, divide the selling price per piece **to the nearest figure**, give it a code or reuse a code, and sell pieces. → check screen: "split into N pieces" on a line (qty × N, cost ÷ N, sale price ÷ N rounded), remembered per supplier code. **Rounding: nearest 10** (owner; e.g. 1,000 ÷ 6 = 166.67 → 170).
- ✅ **Cost = the latest bill's price (replace, not average)** (owner). Checked: every cost change is already written to the item's History by a database trigger (`price_changes`, v143, `services/product-history.js`); the bill must tag its changes so History shows the supplier and bill number.
- ✅ **Cost = actual cost after discounts** (owner, same as iPOS): a line discount lowers that line's cost; a whole-bill discount is spread over the lines in proportion to their value (A2Z: 12 × 160 less 5 % → 152 a piece). **Freight / carriage = a separate shop expense, never in toy cost** (owner).
- **Owner (same evening):** some suppliers give **3–5 % discount on 6 or 12 months of purchases**; the supplier subtracts it on their ledger as "discount" and the shop subtracts it on its own ledger under the heading "Discount" → SanoPOS needs a **supplier discount** entry on the supplier account (lowers the balance, no item cost change; today the account only has opening / bills / payments / returns). **No free pieces.** Mistakes happen both ways: **extra pieces** sent, or a toy **on the bill but not in the carton** → check screen: billed qty vs received qty per line.
- ✅ **Short delivery (owner):** the **full bill** goes on the supplier's account, then a separate **minus entry headed "Not received"** for the missing pieces' value; stock goes up only by what arrived. **Extra pieces:** if it's a fast-selling toy, **keep it and add it to the bill** (plus entry, stock up); otherwise **send it back** (no stock in). → ~~extra added (+)~~ **corrected by owner:** for extra pieces kept, the **supplier sends a new bill** for them (entered like any bill, so the ledgers match). **Returns:** the supplier sends a **bill with the returned items in negative** and the new ledger balance → the upload must accept **negative lines** = a supplier return (stock out, balance down). Supplier account entry kinds: bill (lines may be negative), not received (−), discount (−), payment, return.
- ✅ **Freight (owner): (B)** paid separately in cash (or the supplier sends goods free of freight) → till **Paid out → Shop cost** (exists since F3); never on the supplier's bill.
- ✅ **Extra pieces kept = received now, billed later** (owner chose option 1, = today's practice): stock up at once at the bill's rate and onto a **"Received, waiting for supplier's bill"** list; when that supplier's next bill is uploaded, SanoPOS offers to **match** those lines (money onto the account, **stock NOT added twice**). The list also shows anything never billed (chase it, or mark it free).
- **New toy selling price = the shop's margin sheets** (owner photos 2026-10-02 eve; the clean printed sheets are the NEW, higher margins; %, added on cost: cost 1,000 + 150 % = 2,500). Owner sometimes adds more if a toy is worth it. Read as (to confirm with owner):
  - **Non-brand items, by cost:** 100–499 → 185 % · 500–999 → 175 % · 1,000–1,499 → 165 % · 1,500–1,999 → 155 % · 2,000–2,999 → 145 % · 3,000+ → 135 %.
  - **Brand items, by cost:** 100–499 → 130 % · 500–999 → 120 % · 1,000–1,999 → 110 % · 2,000–2,999 → 100 % · 3,000–4,999 → 95 % · 5,000+ → 85 %.
  - **Baby Land big items & T&T (only scooty):** cost 0–9,999 → 80 % · 10,000+ → 65 %. Items: tori car, tricycle, bicycle, stroller, slide, walker (open / box / branded), branded slide, trampoline, riding horse, swing (normal / electric), study table, high chair, bouncer (branded / non-branded), branded tori car, scooters, jumpoline.
  - **Non-brand B.B Land & T&T:** skate board, skate shoes, air animals, jumping air ball, net ball → 110 %.
  - **Stuff & stationery, by supplier:** Zaki 140 % · Amir Stationers 140 % · Saad 140 % · Amir Birthday 110 % · Tooba Stuff 110 / 130 % · Rehman Stuff 160 %.
  - Prod: only **811 of 10,044 items have a brand** (22 brands); suppliers "Zaki" and "Amir Birthday" are not in the supplier list. Today's prices are about cost × 2.2–2.75 (median per supplier).

### F6: Voided sales visible in Sales History (D47) 🟡

- `GET /api/sales` always hides voided sales (`routes/sales.js:168`); make it follow the page's All / Voided tabs.

### F7: Card payments on prod stop hitting the sandbox gateway (D46) 🟡

- Prod has `PAYMENT_GATEWAY=sandbox`, so each Card line gets a fake `sandbox_inline_…` reference. Check what else reads that variable (subscription billing checkout), then change the Railway variable with the owner's OK. No code change expected.

### F8: Email receipt header (D45 leftover) 🟡

- The header lines run together and header/footer text isn't escaped in the email version. Match the printed slip.

### Reports the owner uses (from Q6, 2026-09-30)

Owner checks regularly: sale by payment type; **hourly sale** (day / month / months); **stock at cost and sale price by supplier, category, brand, sub-category**; **total stock at cost at end of day** (read when closing iPOS). Checked against code + live dashboard 2026-09-30:

- ✅ Sale by payment type: dashboard "Payment Methods", Reports → Payment Summary.
- 🔴 **D54** hourly sales in UTC (dashboard + Sales Heatmap). **Owner agreed 2026-09-30: fix right after F1** (uses it daily).
- **G1** stock-value **summary table** by supplier / category / brand / sub-category (cost + sale price + units), like iPOS PSP "Supplier / Category / Brand / Sub-Cat Summary". Today: Reports → On Hand gives totals for **one** filter at a time.
- **G2** **saved end-of-day stock value**: store units / cost / retail at every Close Shift; print on the day slip (F4); list by date. Today: dashboard shows the live figure only.
- **G3** dashboard: sales contribution **by supplier** (Reports → Merchandising has it; not on the dashboard).
- **G4** dashboard: **gross margin %** today and month (shows month GM amount only), **month sale and month purchase** totals, **top 50 items (30 days)** (shows top 5).
- **G5** dashboard: **daily sale vs purchase** (server computes a 7-day series, Query 13, no screen shows it).
- Seen: "Needs a Category" = 23% of 30-day sales (Rs 15,770): sold items imported without a category. List them for the owner.

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
- ~~**Q3 (R1)**~~ ✅ answered 2026-09-29: **7 days is fine**; more if needed. **Changed 2026-10-02 by the owner: 30 days** (no supplier entries yet; more edge cases need to happen for real).
- ~~**Q4 (F1)**~~ ✅ answered 2026-09-30: **leave INV-00004's Rs 40 as recorded**, with a note (never correct it).
- **Q5 (F3):** ▶ partly answered 2026-09-30 from the register page for 29 Sep (Urdu, total 10,470 checks): staff food (10) 3,000; gas cylinder refill for the staff flat 1,000; medicine / Ishtiaq 170; home expenses DHA 5,000; coffee 1,000; Aslam food 300. **Draft categories:** Staff food · Staff flat (gas refill etc.) · Tea / coffee · Staff medicine / advance · **Owner / home (owner's drawing, kept out of profit)** · Shop supplies · Transport / delivery · Other (with note). Owner will send 4–5 more days of register pages to finish the list.
  - ✅ **Answered 2026-09-30 ~17:00** after reading 10 more register pages (zip `WhatsApp Unknown 2026-09-30 at 4.46.41 PM`). One question at a time:
    - **Q5.1** Home / family money (DHA home, school fees 87,500 / 87,000, Bank Alfalah credit card 54,000 / 111,000, "Hassan sahib"): **kept separate from shop cost** (owner's drawing, not in profit).
    - **Q5.2** Cash paid to suppliers (Rehmat Sports 59,000, Arif Khan 50,000, AtoZ Slime 10,000 ×2, Peshawar C.C 6,100, JBD Books 9,000, Rabie Books 500): **goes against the supplier's balance.**
    - **Q5.3** Staff advances (5,000; 13,000): almost always cut from salary; sometimes, at the staff member's request, from the month after.
    - **Q5.4** Salaries paid in cash from the drawer at month end; advances tracked in the register today; **owner wants SanoPOS to track everything**, including toys staff take at cost (paid in cash, or cut at salary time).
    - **Q5.5** Staff account = new work: **F3 first, staff account (F3b) right after.**
    - **Q5.6** Supplier opening balances: **enter all now** (owner to send the list).
    - **Q5.7** "Danish MCB 50,000" = money sent to the owner's brother's family, to be paid back into the owner's **personal** account → Owner / home.
    - **Q5.8 / Q5.10** "Cash customer 500" = a discount agreed after the bill was charged in full, handed back in cash from the till (nothing done in iPOS) → Paid out **"Discount after sale"** with the bill number.
    - **Q5.9** Shop cost list accepted as proposed (table under F3).
    - **Q5.11** Add all 11 staff as employees (no login).
    - **Q5.12** Paid out: the owner now, and staff with their own login later.
  - Shop facts given with it: open **11:00–21:00 daily**; **10 staff + 1 cleaner**; the owner rents a **flat near Packages Mall** for staff (most are from outside Lahore) and pays its gas refills. (SanoPOS has 1 employee today.)
- ~~**Q6**~~ ✅ answered 2026-09-30: **iPOS holds no customer credit, supplier balances or salaries** (its dashboard shows Cash in Hand, Bank, Supplier Payable, Customer Receivable, Expense all 0.00). Nothing to move before R9 except the final export. What the owner uses in iPOS is **reports + dashboard** (12 screenshots in `C:/Users/HP/OneDrive/Pictures/whatsapp`, 27 Feb 2026 + today): Daily Sale Report (by MOP), Periodic Sale, Itemwise Sale, Category Wise, **Supplier Wise Sale**, Brand Wise, Total/Itemwise Purchases, Present Stock Position / List of Item File, dashboard (today's sale, avg bill, month sale/purchase, gross margin %, top 50 items 30 days, sales contribution **by supplier**, daily sale vs purchase, voids, discounts, MOP split).
  - SanoPOS tabs with matching names (**names only, none checked against iPOS numbers yet**): Payment Summary / Session Z-Report / Shift Summary; Item Wise; Category / Sub-Category Wise; Brand Wise; Total / Itemwise Purchases; On Hand / Inventory Dump / Sales & Stock; Refunds & Voids; Dashboard / Overview / Product Performance. **Open: sales by supplier** (SanoPOS "Supplier Wise" sits under Procurement, may be purchases only): check; add to the fix list if missing. Each report the owner uses gets checked against iPOS for the same day during the dual-run.
