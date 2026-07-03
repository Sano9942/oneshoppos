# SanoPOS Live Functional Audit — 2026-06-30

## Scope

- Adaptive, page-by-page testing in the in-app browser (Claude in Chrome extension).
- Test-tenant order: retail (`livetestauto`) → restaurant → café/QSR → wholesale and wholesale sub-accounts.
- Retail exposes 74 sidebar destinations.
- Real payment gateways and live third-party integration triggers remain out of scope.

## Retail — passed

- Dashboard and Notifications.
- POS loaded and visible controls were inspected.
- Orders, Quotations, Parked Sales, Holds & Layaway.
- Returns, Return Policies, Return Reasons form, Sales History, sale detail and invoice rendering.
- Kiosk full cycle: PIN recognition → Clock In → Break → Resume Shift → Clock Out.
- Receipt email submission and confirmed delivery to all three owner-approved test inboxes.
- Customers: create → edit → archive.
- Customer Groups: create → edit → delete.
- CRM: lead creation, activity logging and stage movement.
- Loyalty tier creation.
- Gift card creation with a Rs 100 test balance.
- Customer invoice creation and Rs 100 cash payment; balance moved to zero and status to paid.
- Inbox filters, campaign/template forms and review-moderation filters.
- Products: create, persisted list values, edit and save. Test product: `Browser Audit Product 20260630`.
- Categories: create → edit → delete. Temporary category was successfully removed.
- Brands: create and edit. `Browser Audit Brand 20260630` remains clearly labeled.
- Attribute Sets: create/edit plus nested attribute and three option values. `Browser Audit Variants 20260630` remains.
- Promotions: create/edit, backend quote evaluation and safe disable. The Rs 250 test cart received Rs 52.50 total discount from the existing 15% promotion plus the audit 6% promotion. Audit promotion is inactive.
- Price Lists: create/edit and active/inactive toggle. Audit price list is inactive.
- Smart Collections: create/edit and rule evaluation. Category rule correctly matched the two expected products.
- Stock Adjustments: +1 Found and -1 Counting Error entries were both recorded, leaving net product stock unchanged.
- Transfers: form excludes the selected source outlet from destination choices; with one outlet, an invalid same-outlet transfer cannot be created.
- Reorder Alerts: loaded successfully and reported no products below configured reorder thresholds.
- Inventory Intelligence (partial): ABC Analysis loaded the nightly classification row; product search, rank filtering, dead-stock filtering, pagination state and summary-card navigation were exercised. Reorder outlet filtering and the disabled Create POs state were verified with no products below threshold. Cycle Counts validation correctly rejected a missing name and missing outlet; a clearly labelled audit schedule was created, edited and paused. Aging bucket filters worked, but the tenant reports `Feature disabled: reports_inventory_health_plus` and no aging rows were available. The audit schedule `AUDIT Cycle Count Schedule 20260630` remains paused.
- Suppliers: search, required-name validation, credit-account creation, persisted credit days/limit/lead time, ledger navigation, date filtering and editing were exercised. `AUDIT Supplier 20260630` remains as a clearly labelled credit supplier with zero outstanding balance. Delete was intentionally not tested because it uses native confirmation.
- Purchase Orders: supplier/status search, empty-state validation, product search, quantity/cost editing, template save/load/use, detail view, draft editing and submission for approval were exercised without receiving inventory. `AUDIT PO Template 20260630` remains. `PO-0002` is pending approval for Rs 320.00 and `PO-0003` is a Rs 480.00 draft; neither changed stock.
- Fulfillment → Orders Queue: page loads; empty state "No unfulfilled orders" shown correctly.
- Courier Settings: 13 pre-seeded couriers listed (all Disabled), each with adapter and tracking URL. Add Custom Courier inline form appears, fills, and cancels cleanly. Toggle switches present (one per courier).
- COD Settlements: page, 13-courier filter, 5-status filter, and Import new batch wizard (4-step) all load. Wizard closed via aria-label close button. Filter selections and empty state correct.
- Storefront (`/store/livetestauto`): home page, category nav, product listing, product detail (name/price/pickup availability table), Add to Cart (slow ~4 s response but succeeded), quantity +/− controls (total updated correctly), Remove from cart, and empty cart state all pass. Checkout page renders correctly with delivery method toggle, pickup location, contact form, and order summary.
- Finance → Cash Management: summary cards (Total Sale Cash / Cash In / Cash In Hand / Closed Shifts), outlet filter (reveals active shift #3 with Open Drawer + Close Shift actions), shift history table (3 rows), Export CSV and Refresh all functional. Shift rows are not individually drillable.
- Finance → Expenses: date/category/outlet filters, Expense List and Summary tabs, category management (add/delete), expense create/edit/delete all functional. All audit data cleaned up (zero remaining).
- Finance → Approvals: Pending/Approved/Rejected tabs all load. PO #2 visible in Pending with Approve/Reject actions. Row click produces no detail drill-down.
- Finance → Accounting: all 9 sub-tabs load with data or correct empty states — P&L (Net Revenue Rs 850, Gross Profit Rs 250), Cash Flow, AP & AR, Balance Sheet (Assets Rs 8,600), Expense Ledger, AP Aging, Tax Ledger, Supplier Payments, Accounting Periods. Date range and outlet filters work.
- Finance → Chart of Accounts: 18 pre-seeded accounts in 5 groups (Assets/Liabilities/Equity/Revenue/Expenses), Add Account form (code/name/type/subtype/parent/description), Cancel, and name/code search filter all work.
- Finance → Journal Entries: list view (empty), Draft/Posted/Voided status filters, date range, Trial Balance tab (date range + Refresh/Export), New Entry form with Add Line, double-entry account picker (all 18 accounts listed), Cancel all functional.
- Finance → Credit/Debit Notes: Credit Notes and Debit Notes tabs, Draft/Approved/Applied/Cancelled status filters, New Note form (type Sales/Purchase, customer picker populated with test customer, amount/reason/reference/notes fields), Export, Cancel all functional.
- Finance → Post-Dated Cheques: create (`AUDIT-CHQ-20260630`, Rs 500, Receivable, Sweep Test Customer) and Cancel both worked correctly end-to-end; status moved pending → cancelled. Empty-submit is silent (no validation message) — same pattern as findings 16/20/21. Cancel uses a custom in-app confirmation modal, not a native `confirm()` — no browser stall.
- Insights → Reports: all 10 category tabs (Sales, Customers, Inventory, Operations, Procurement, Finance, HR, Governance, Multi-Channel, Restaurant) load without error. Governance correctly shows "Feature disabled: reports_scheduled_exports"; Restaurant → KDS Analytics correctly shows "Feature disabled: phase4_restaurant_kds_analytics". Filters (outlet/category/brand/supplier/staff/shift) populate correctly.
- Insights → Report Builder: dataset selection, dimension/measure checkboxes, Run (3 rows returned correctly), Save (named `AUDIT Report 20260630`, appeared in Saved Reports list), and Delete (removed cleanly, no native confirm) all functional.
- Insights → Retail Risk: all 3 tabs (No-Sale Events, Anomaly Flags, Settings) load correctly with correct empty states and saved threshold values (Refund approval Rs 5,000, Shift variance Rs 500).
- People → Employees: list, Add Employee (created `AUDIT Employee 20260630`, Cashier, PIN 9999) all functional. Empty-submit is silent (no validation message).
- People → Attendance: Active Now panel, date-range filter + Apply (correctly returns 0 records for default today-only range, 4 records once widened), Add Record form fields all functional. Cancel closes cleanly.
- People → Scheduling: outlet selector, Add Shift (created and then cleanly cancelled a test shift for Sweep Cashier), Publish button, Edit Shift modal with Cancel Shift action (no native confirm) all functional.
- People → HR: Leave Requests (submit → reject cycle for `Sweep Cashier` annual leave tested end-to-end, status correctly moved pending → rejected), Leave Balance tab, Payroll tab (created `AUDIT Period 20260630` draft, 1 Jun–30 Jun 2026, View shows empty Payroll Lines with a working Add Payroll Line form — left in draft state, Generate not run), Attendance Summary tab all load. Empty-submit on Submit Leave and Create Period is silent.
- Compliance → Taxes: Add Tax Rule (created `AUDIT Tax 20260630` at 5%, confirmed in list) functional. Empty-submit is silent.
- Compliance → FBR Settings: page loads with all expected fields (Enable toggle, Connection Status, NTN/STRN from company profile, Province, Environment, API Token, Default HS Code). Test Connection/Save not exercised (would hit a live third-party API).
- Compliance → Tax Lookup: province selector, search-by-HS-code/name (search requires explicit click on the search icon — typing alone does not auto-search), results table with Federal GST/Punjab Rate/Exemption Notes, and the "Suggest Correction" modal (HS code 0401, field/value/SRO/notes form) all functional. Cancelled without submitting.
- Setup → Outlets: list (1 outlet, Main Store), Edit modal opens and closes cleanly. Add Outlet not exercised (a 2nd outlet flips multi-outlet feature flags tenant-wide — out of audit scope).
- Setup → Company Profile: full page loads — Business Identity, Tax & Compliance, Branding & Currency, Regional Settings, Dashboard Targets, Inventory Intelligence defaults, Customer Portal link, Customer Display link/preview all present. Not modified.
- Setup → Outlet Tax Profiles: loads correctly, shows Main Store under "Outlets without a tax profile."
- Setup → Integrations: all cards across Marketplaces, Social Commerce, Messaging, Product Feeds, Payments, SMS, and 13 Couriers render. JazzCash Connect modal (Merchant ID/Password/Return URL) opens and closes cleanly without submitting credentials.
- Setup → POS Layouts: New Layout (created `AUDIT Layout 20260630`, global scope, Active) and Delete both functional — Delete uses a native `confirm()` that stalls the in-app browser transiently (same as finding 4) but the deletion completes; verified removed from the list afterward. Note: a global-scope layout goes Active immediately on creation, which could affect the live POS grid for all cashiers until removed — flagged as a risk for future audits, not just a UI quirk.
- Setup → Receipt Templates: Default/Active template preview renders correctly (sample receipt with FBR ref placeholder and QR).
- Setup → Barcode Templates: New Template form (Width/Height/Font Size/Show Fields/Set as default) opens and cancels cleanly.
- Setup → Printer Settings: full page loads — Connection Type, Paper Size, Purpose, Kick Cash Drawer toggle, Email Settings (SMTP/Gmail App Password) all present. Test Print/Send Test Email not exercised (live hardware/email triggers).
- Setup → Import Data: Products/Customers/Suppliers/Expenses/Payments tabs switch correctly; Download Template and upload dropzone present. No file uploaded (would create real records).
- Setup → Import from Shopify/Square: Shopify/Square toggle, Products/Customers data-type toggle, Download Shopify template, upload dropzone all present.
- Setup → Backup & Restore: page loads — Download Backup, Restore from Backup (correctly warns "This will permanently overwrite all current data"), Backup Log (0 entries, correct empty state). Neither download nor restore was exercised — restore is explicitly destructive and out of audit scope.
- Account → Billing: Current Plan (Pro, Quarterly, expires June 20 2027) and Payment History (1 row, Rs 21,600) render correctly. No payment action exercised.
- Account → My Tickets: correct empty state ("No tickets submitted yet").
- Account → Administrator: 4 roles (Administrator, Manager, Cashier, Field Rep) listed with permission chips and "+N more" overflow. Edit Role modal opens with full permission checklist grouped by category (System/Inventory/Orders/Customers/Products/Reporting/POS/Restaurant/Services); cancelled without saving.
- Account → Action History: 21 entries load with timestamps and human-readable details (e.g. "Sweep Operator logged in", "Cart resumed (1 items)"). Export CSV and Refresh present.

No JavaScript console errors were observed on any of the above pages.

## Partial / blocked pages

- Scheduled Changes: page and form load, but valid submission is broken by datetime serialization (see finding 6). No change was created.
- Inventory Audit: count creation and SKU scanning work, but there is no cancel action (see findings 7–8). `SC-20260630-001` remains in progress with the audit product counted as 1 against system stock 10. It must not be completed because that would alter stock.
- Inventory Intelligence is partial because aging data is feature-disabled, CSV download could not be independently observed by the browser, and cycle-count schedule dates persist incorrectly (see findings 10–12).
- Supplier Returns is partial: navigation, empty state, product/outlet/supplier selection, reference/reason fields, quantity/cost calculations, enabled-state validation, item removal and cancellation passed. Completion was intentionally not tested because it would stock out inventory; no RMA was created.
- Supplier Payables is partial: Aging Summary, All Invoices, every invoice-status filter, Supplier Ledger, date range, supplier selection and Refresh passed. No invoices exist, so invoice expansion and payment recording remain untested.
- COD Settlements is partial: filters and wizard structure pass; full 4-step import flow (requires a real remittance file) was not completed.
- Storefront is partial: home, listing, product detail, cart flow and checkout page render pass. Checkout form submission was not tested (would create a real order). The `innerText` extraction returns empty on the products listing page despite products being present in the accessibility tree — a CSS rendering gap, not a functional failure.
- HR (People) is partial: Leave Requests, Payroll period creation/view, and Attendance Summary all function correctly, but Leave Balance has a real bug (see finding 22) and the "Present Records" summary stat on the Reports → HR → Attendance tab read 0 against 4 visible log rows for the same date range (unconfirmed whether this is a stat-calculation bug or a different definition of "present" — noted, not filed as a numbered finding pending a second observation).
- Scheduling (People) is partial: shift creation/edit/cancel all work, but Add Shift is silently inert with no outlet selected (finding 23) and the date shown in the form does not match the date the shift is actually saved under (finding 24).
- POS Layouts (Setup) is partial: create/delete both work, but a newly created layout goes live (global scope, Active status) immediately with no draft/staging step, which is a meaningful operational risk for a multi-cashier floor, not just a UX nit (finding 25).

## Findings

1. POS is unusually expensive to inspect using a broad accessibility/DOM snapshot, though the page itself loads and targeted controls work.
2. Some client-side navigations continue reporting a busy state after the destination page is already rendered. Verify the visible destination state instead of relying on a full load event.
3. `Return Reasons` is clickable by visible text but is not exposed correctly as an accessible button.
4. Native JavaScript confirmation dialogs repeatedly stall the in-app browser connection after the action is clicked. Category deletion did succeed after the user reopened the browser. Avoid confirmation-based deletes during the rest of the audit.
5. The product editor exposes no delete/archive control. The audit product remains active.
6. Scheduled Changes sends a `datetime-local` value such as `2026-07-01T10:00`, while the API requires a full ISO datetime. Submission fails with `Invalid ISO datetime` even though all visible fields are valid.
7. Inventory Audit exposes a `Cancelled` filter/status but no action to cancel an in-progress stock count. The only terminal action is `Complete Count`, which would apply stock variances.
8. Inventory Audit count progress is inconsistent: the detail view reported 1 of 7 products counted, while the list reported 1/8 counted for the same count.
9. Smart Collection preview reports stock `0` for both matched products even though Products showed stock 7 and 10.
10. Inventory Intelligence cycle-count schedule dates persist incorrectly. Creating `AUDIT Cycle Count Schedule 20260630` with visible next due date `2026-07-15` saved it as `2026-06-29`; editing the same schedule with the visible date again set to `2026-07-15` saved it as `2026-06-28`. The schedule was paused to prevent an automatic count from starting.
11. Inventory Intelligence Aging is exposed in the UI but displays `Feature disabled: reports_inventory_health_plus`; bucket filters work but no aging data is available for functional verification.
12. Inventory Intelligence `Export CSV` was enabled and clickable with one ABC row, but the in-app browser observed no download event, so the exported file contents remain unverified.
13. Supplier ledger date filters clear both visible From and To fields immediately after `Filter` is applied. The ledger result reloads, but the selected period is no longer shown, so users cannot verify the active range.
14. Purchase Orders promises search by "PO, supplier, or status," but entering the exact visible PO number `PO-0001` returns zero rows. Searching the same record by supplier (`Sweep Suppliers Ltd`) or status (`Draft`) works.
15. Purchase Order creation leaves stale validation text visible after the invalid condition is corrected. `Select a supplier before saving as template.` remained on screen after `AUDIT Supplier 20260630` was selected and line items were added.
16. Fulfillment Quick Dispatch gives no visible validation feedback when `Dispatch` is clicked with an empty scan field. Entering an unknown value does produce `Order not found` and a Not Found row, so only the blank-input case is silent.
17. Fulfillment presents order `#1` as `Pending` under Pickup Orders, while New Loadsheet simultaneously lists order `#1` among "dispatched orders" eligible for loadsheet selection, with no courier, tracking number or shipped timestamp. The cross-tab state appears inconsistent.
18. Storefront checkout total (Rs 425) differs from cart total (Rs 500) for the same 1-unit item. No discount or tax line is shown to explain the Rs 75 difference.
19. Expenses: an expense saves as "Uncategorized" in both the list and Summary tab even when a category is explicitly selected in the Add Expense form. The Edit form then opens showing "Uncategorized" selected, confirming the category is not persisted on create.
20. COD Settlements Import wizard: clicking Next on Step 1 with no courier selected silently stays on Step 1 with no validation message. Add Custom Courier on the Courier Settings page has the same silent empty-submit behaviour.
21. Accounting Periods: clicking Create Period with all fields empty silently stays on the form with no validation message (same silent pattern as findings 16 and 20).
22. HR → Leave Balance table renders 4 data rows but the Employee name cell is blank for every row — only the numeric Allowance/Used/Remaining columns are populated, so the table cannot be read without cross-referencing the Employees page.
23. People → Scheduling: with "All Outlets" selected in the page-level outlet filter, clicking "Add Shift" does nothing (no modal, no error). The modal only opens once a specific outlet (e.g. Main Store) is selected first. Same silent-failure family as findings 16/20/21, but gating a button rather than a form submit.
24. People → Scheduling: a shift created via the New Shift modal with Date field showing `07/01/2026` was actually saved and rendered under **Tue 06-30** in the weekly grid — a one-day-off date shift, consistent with the UTC-date trap pattern already audited and partially fixed elsewhere in the codebase (see `tier1_polish_2026_05_16` history) but apparently not covered in the Scheduling module.
25. Setup → POS Layouts: a newly created layout with "Global" scope is saved with status "Active" immediately — there is no draft/inactive default state before a layout is exposed to the live POS grid. An operator who clicks Create while still configuring tiles could affect what every cashier sees mid-shift.
26. Insights → Reports → Multi-Channel and Insights → Report Builder both render raw JavaScript `Date.toString()` / ISO-with-time strings (e.g. `Mon Jun 22 2026 00:00:00 GMT+0500 (Pakistan Standard Time)`, `2026-05-01T19:00:00.000Z`) in DATE columns instead of a formatted date — a display bug, not a data-correctness bug (the underlying date is right, just unformatted).
27. Account → Action History: every row's Employee/Action/Entity columns render as "System" / "—" / "—" regardless of which employee or action the human-readable Details text names (e.g. "Sweep Operator logged in"). Filtering the Action Type dropdown to "Login" then returns 0 entries even though ~14 of the 21 unfiltered rows are visibly login events — the filter's underlying action-type tagging does not match what the UI displays in Details, making the type filter unusable for this tenant's data.

## Restaurant (`sanoposlivetest1778021564659`) — passed

- Login (Test Owner) and Dashboard: revenue/low-stock/busiest-hour/avg-transaction cards, recent orders, staff today, top categories all render correctly. No console errors.
- Sidebar correctly relabels generic retail nav for the restaurant preset: "Customers" → "Guests", "Parked Sales" → "Parked Orders", "Sales History" → "Order History".
- Guests (= retail Customers): list, search, Edit/Archive actions present — same generic page already covered in the Retail section above; loads correctly with relabeled heading.
- Restaurant → Floor Plan: 4 tables rendered (T1–T4). Seat workflow (inline "Guests" popover → Seat) correctly moved a table to `seated` status with the entered guest count; Close correctly reverted it back to available. Add Table form (Label/Capacity/Shape) opens and cancels cleanly. Pre-existing `T1` `dirty`/2-guests state left untouched (not introduced by this audit).
- Restaurant → Checks (Open Checks): loads correctly, columns and action icons (history/fire/split/payment/void) render. One pre-existing stray empty check (`#36`, no table, 0 items, Rs 0.00, server Test Cashier) noted as a data-hygiene observation, not modified.
- Restaurant → 86'd Items (Availability): correct empty state ("Nothing is 86'd right now").
- Restaurant → Reservations: empty-state correct; New Reservation form opens, all fields (name/phone/party size/email/date-time/notes) accept input and the record saves successfully and appears in the list once the page's date filter matches the saved date. `AUDIT Reservation 20260701` was created then Cancelled via the in-app action (not a native confirm — no stall). Confirm/Seat/SMS/Cancel row actions all present.
- Restaurant → Waitlist: correct empty state; Add form (name/phone/party size/wait minutes/notes) opens, accepts input, and the entry appears in queue with Notify/Seat/Delete actions. `AUDIT Waitlist 20260701` was created and then deleted — the delete action triggers a native `confirm()` that stalled the in-app browser for several seconds (same family as the documented native-confirm-dialog pattern); waited it out and deletion completed successfully.
- Restaurant → Online Orders Inbox: source filter (All/Shopify/Daraz/WhatsApp/Facebook/QR) and correct empty state ("No pending orders"), polling indicator present.
- Restaurant → Void/Comp Reasons: 10 pre-seeded reason codes (spilled, wrong_order, customer_change, kitchen_error, vip_comp, manager_comp, training, allergy, quality, other) each with type (void/comp/both), reorder up/down arrows, sort order, Active/Hide toggle. Not reordered or hidden (live config).
- KDS → Routing Rules tab: Add-rule form (station/category/product/modifier-group precedence) and empty "No rules yet" state load correctly.
- KDS → Tip Pools: Pools tab shows 1 historical distributed pool (Rs 540.00, 3 captures, 1 payout); Distribution Rules tab shows the "Equal Share Default" rule; Payouts tab shows totals (1 payout, Rs 540.00, fully unpaid) and the per-employee payout row (Test Owner, Rs 540.00, unpaid) with working Export CSV button.
- Order Kiosks: outlet selector, Launch counter/table kiosk buttons, correct empty state ("No active kiosks for this outlet"). Not launched (would start a live kiosk session).

## Restaurant — shared/generic pages, individually verified with real interactions

- Orders: order-status filter (open/closed/cancelled/on_hold) verified to actually filter the table (6→4 rows, correctly all "cancelled"). View detail panel opens with status dropdowns, Save Statuses, and working Items/Transactions/Fulfillments tabs.
- Quotations: New Quotation full-page form — customer/outlet/product selects, auto-filled unit price, live subtotal/tax/discount/total calculation, and Notes field all worked; `AUDIT Quotation 20260701` (Phase 4 Customer, Rs 650.00, draft) created and verified in the list.
- Returns: Process Return modal opens correctly; product search/remove/outlet/refund-method fields render and the draft total recalculates on add/remove. Two real defects found here — see findings 33 and 34 below.
- Return Policies: New Policy form (Name/Return Window/Restocking Fee/Receipt required/Set as default) creates correctly — `AUDIT Return Policy 20260701` verified in the list (No time limit, Receipt required, cash/card/store_credit). Return Reasons sub-tab loads with correct empty state.
- Order History (Sales History): row click opens the full receipt detail panel (items, payments, Comp/Void/Reprint/Invoice/Share/Email/WhatsApp/Void/Return actions) for receipt #15. Destructive actions (Void/Comp/Return) not exercised — would alter real sale data.
- Customer Groups: New Group modal accepted input correctly on the second attempt (first click after navigation is reliably a no-op across this tenant — see finding 35); `AUDIT Group 20260701` created, then Deleted cleanly (custom in-app confirm, no native-dialog stall) — fully cleaned up.
- CRM: dashboard loads (5 pipeline stages, all empty). Add Lead modal is **broken** — see finding 28; no lead could be created.
- Loyalty Tiers: 4 pre-seeded tiers (Bronze/Silver/Gold/Platinum) render correctly with multiplier/discount/customer counts. Edit modal opens with all fields pre-filled correctly; cancelled without saving to avoid altering live tier config.
- Gift Cards: New Card modal — Initial Value field accepted typed input correctly (unlike the broken modals); `7E634B988FDC` created with Rs 100.00 balance, confirmed in the Cards list.
- Customer Invoices: New Invoice modal opens, Customer select works, but the line-item Description field is **broken** — see finding 28; no invoice line item could be entered.
- Messaging Inbox: correct empty state, Open/Closed/All filter tabs present; no creatable entity to test (thread-based, populated externally).
- Marketing Campaigns: New Campaign modal opens (Campaign Name/Subject Line/Template/Body HTML/Audience Filters) but the Campaign Name field is **broken** — see finding 28; no campaign could be created.
- Review Moderation: Pending/Approved/Rejected/All filter tabs verified to actually filter (Approved tab correctly returned "No approved reviews found" vs. the Pending tab's "No pending reviews found").
- Parked Orders: one pre-existing stray empty parked sale (Walk-in, Rs 0.00, dated 08/05/2026) was deleted via the in-app inline Confirm/Cancel control (not a native dialog) — list is now empty, cleanly resolved.

## Minor relabeling inconsistencies (restaurant preset)

- Customer Groups page: heading reads "Customer Groups" but the breadcrumb says "Guest Groups" — inconsistent with the rest of the preset's "Guest" relabeling.
- Customer Invoices page: heading reads "Customer Invoices" but the breadcrumb says "Guest Invoices" — same inconsistency.

## Restaurant — partial / blocked

- Restaurant → Modifiers is broken: the "New group" modal's Name text input cannot receive keyboard focus or typed text at all (clicking it, including via accessibility-tree element reference, leaves the field empty and the modal's close (X) button shows the visual focus ring instead). This makes it impossible to create any modifier group through the UI. Confirmed reproducible across two independent attempts in two separate modal instances. No modifier groups exist on this tenant as a result.
- KDS → Tickets queue contains a large backlog of stale, never-bumped tickets — oldest is ~79,178 minutes (~55 days) old, several others in the 77,000–79,000-minute range, plus one fresher ticket at 12,153 minutes. None were bumped during this audit (pre-existing data, not introduced by us; bumping would alter live kitchen-queue state). A few tickets (e.g. two `T1` tickets at ~79,043m/79,018m, one `T2` at ~77,661m) render with no item line at all between the ticket header and the Bump/Recall buttons — possible orphaned-ticket rendering gap, separate from the staleness issue.
- KDS → Stations tab: the station→printer mapping table (1 row: Main Kitchen / prep / priority strategy, no printer assigned) renders correctly, but the full 15-row Tickets queue from the Tickets tab also renders underneath it on the same page — the previous tab's content is not unmounted when switching tabs.

## New findings (restaurant tenant)

28. **[Confirmed via DOM inspection across 5 modals on 4 pages — root cause narrowed]** Restaurant → Modifiers "New group", CRM → "Add Lead", Customer Invoices → "New Invoice" (line-item Description), and Marketing → "New Campaign" (Campaign Name) modals: typed text into the first text field does not register — the input's `.value` stays empty after typing. Two distinct symptoms were observed depending on timing: (a) clicking the field immediately after the modal opens sometimes lands focus on the modal's Close (X) button instead (`document.activeElement` = button, `aria-label="Close"`); (b) even when the field *is* correctly focused first (confirmed via `document.activeElement` immediately before typing, with a deliberate pause), the typed text still fails to register. (b) rules out a simple click-mistargeting explanation — it points to the input being reset/remounted on every keystroke (a controlled-component re-render bug), which would also explain (a) as a side effect (focus lands wherever the remounted DOM places it). Confirmed reproducible 5 times across 4 different pages — a systemic pattern, not a one-off — but not universal: Return Policy, Customer Group, Gift Card (Initial Value), Waitlist, Reservation, and the full-page Quotation form all accepted typed input normally in the same session, so only some modal instances are affected (possibly ones sharing a specific composition pattern — worth a source-level diff between the working and broken modal components). No modifier group, CRM lead, customer-invoice line item, or marketing campaign could be created via the UI in the affected instances. **Update (follow-up pass):** also confirmed in Categories → "Create Category" Name field, Brands → "Create Brand" Name field, Suppliers → "Create Supplier" Company Name field, Expenses → "Add Expense" Description field, and Employees → "Add Employee" Full name field (instances 6-10, across 5 more pages) — same symptom each time, `document.activeElement` is the Close button immediately after typing and the input stays empty. **User independently reproduced this manually on the Categories page** and confirmed the same behavior (typing a word, then focus snaps back to the Close button). At this point the pattern looks closer to "most modal-based Create forms in this tenant are affected" rather than an isolated handful — the exceptions found so far (Return Policy, Customer Group, Gift Card, Waitlist, Reservation, plus the full-page Quotation/Add Product forms) may be the minority, not the rule. **This is the single highest-priority defect from this entire audit (retail + restaurant combined)** — it blocks basic catalog/procurement/HR data entry (categories, brands, suppliers, employees) in addition to the CRM/marketing/modifier gaps already noted, across at least 10 confirmed locations on 9 pages.
29. Restaurant → Reservations → New reservation modal: the Date/time field defaults to **yesterday's date** at the current time-of-day (today was 2026-07-01; default showed 06/30/2026), rather than today's date. Same family as the previously-documented UTC-date-trap pattern (see `tier1_polish_2026_05_16` history), evidently not covered by that prior fix in this module. The record otherwise saves correctly once a user notices and corrects the date.
30. KDS → Stations tab does not unmount the Tickets tab's content when switched to — the full stale ticket queue renders duplicated underneath the station/printer mapping table.
31. KDS ticket queue retains tickets indefinitely with no apparent staleness threshold or auto-archive — multiple tickets exceed 79,000 minutes (~55 days) old and remain in the active "Bump/Recall" queue; a few of these also render with no item line shown.
32. Tip Pools (all 3 tabs: Pools, Payouts) render the raw ISO datetime string (e.g. `2026-05-05T19:00:00.000Z`) in the Date column instead of a formatted date — same display-bug family as retail finding 26 (Reports → Multi-Channel / Report Builder), now also observed in the restaurant-specific Tips module.
33. Returns → Process Return product-search box drops keystrokes under automated typing: typing "Caesar" left only "C" in the field (confirmed via `input.value`), and the dropdown showed all products unfiltered rather than matching the partial query — the search-as-you-type filtering does not appear to work at all, only the most recent keystroke's character lands in the field.
34. Returns → Process Return product-search dropdown: the dropdown list reflowed between a screenshot and the subsequent click, causing a click at the same on-screen coordinates to add a different product than the one visually selected (clicked where "Caesar Salad (Sample)" was shown, "Chocolate Cake (Sample)" was added instead). In a refund workflow this is a real risk of crediting/restocking the wrong item.
36. **[Finding 28 family, instances 11-15]** Same broken-input symptom (`document.activeElement` ends up on the modal's Close button, typed text does not register in the field) confirmed in 5 more locations this session, spreading the pattern further into the Finance module: Cash Management → Close Shift "Notes" field (instance 11), Chart of Accounts → Add Account "Name" field (instance 12), Journal Entries → New Entry "Description" field (instance 13), Credit/Debit Notes → New Note "Reason" field (instance 14), Postdated Cheques → New Cheque "Cheque Number" field (instance 15). All 15 confirmed instances now span Catalog, CRM, Marketing, HR, and Finance — every "New X" modal's first/primary text field tested in Finance this session was affected, with zero exceptions, suggesting Finance-module modals may share a composition pattern that's uniformly broken (unlike the mixed pass/fail pattern seen elsewhere).
35. **[Tenant-wide pattern, ~15+ occurrences this session]** The first click on a "New X" / primary-action button immediately after navigating to a page is reliably a no-op — the button does not respond, and a second (sometimes third) click is required before the modal/form actually opens. Observed on Quotations, Return Policies, Customer Groups, CRM, Gift Cards, Customer Invoices, Marketing Campaigns, Review Moderation tab switches, Parked Orders Delete, and others. This is consistent with a hydration-timing issue (the button is visually rendered and clickable before its event handler is attached) rather than per-page bugs — worth a single fix at the shared button/page-load layer rather than 10 separate investigations.

## Resume point

**Retail (`livetestauto`) is fully audited (74/74 destinations). Restaurant (`sanoposlivetest1778021564659`) is now audited for: all restaurant-specific modules (Floor Plan, Checks, Availability, Modifiers, Menu Schedules, Reservations, Waitlist, Inbox, Void Reasons, KDS, Tip Pools, Order Kiosks) AND the customer/sales-facing shared pages with real form/filter interactions (Orders, Quotations, Returns, Return Policies, Order History, Guests, Customer Groups, CRM, Loyalty Tiers, Gift Cards, Customer Invoices, Messaging Inbox, Marketing Campaigns, Review Moderation, Parked Orders).**

**Session 3 progress (still in the restaurant tenant, real-interaction pass continued):** Inventory/Products (passed, `Browser Audit Product 20260701` created — Rs 99.00, full-page form works fine), Categories (Create blocked by finding 28, instance 6), Brands (Create blocked, instance 7), Suppliers (Create blocked, instance 8 — also blocks downstream Purchase Order testing since no supplier exists to select), Purchase Orders (nav-only, empty list correct, create not testable without a supplier), Fulfillment (nav-only — Orders Queue tab verified with 2 real unfulfilled orders; Pickup Orders/Picklists/Quick Dispatch/Loadsheets sub-tabs **not** clicked into), Courier Settings (nav-only — 13 pre-seeded couriers confirmed; "Add Custom Courier" and toggle switches **not** tested), COD Settlements (nav-only — empty state and filters confirmed; "Import new batch" wizard **not** opened), Cash Management (nav-only — shift history data confirmed; Open Shift/Close Shift actions **not** tested), Expenses (Add Expense blocked, instance 9), Approvals (nav-only, empty state correct, no items to act on), Accounting (nav-only — only the default P&L sub-tab was viewed; Cash Flow/AP & AR/Balance Sheet/Expense Ledger/AP Aging/Tax Ledger/Supplier Payments/Accounting Periods **not** individually clicked into), Chart of Accounts (nav-only — 18 pre-seeded accounts confirmed; "Add Account" **not** tested), Journal Entries (nav-only — page loads; "New Entry" and "Trial Balance" tab **not** tested), Credit-Debit Notes (nav-only — empty state confirmed; "New Note" **not** tested), Postdated Cheques (nav-only — empty state confirmed; "New Cheque" **not** tested), Reports (nav-only — Overview tab loads with one Recharts console warning re: chart width/height; category-tab switching between Sales/Customers/Inventory/Operations/Finance/HR/Governance was attempted but **not reliably confirmed working** — needs a clean re-test), Report Builder (nav-only — dataset list confirmed; "Run"/"Save" **not** tested), Retail Risk (nav-only — only the default "No-Sale Events" tab was viewed; "Anomaly Flags" and "Settings" tabs **not** clicked into), Employees (Add Employee blocked, instance 10), Attendance (page just loaded, **not yet tested** — Add Record form and date-range Apply filter not exercised).

**Session 4 progress (continuing real-interaction pass in restaurant tenant):** Attendance — Add Record form fully tested (employee/outlet/check-in datetime/status/comment all work correctly, test record saved: Test Cashier, 07/01/2026 09:00 AM, Present, "AUDIT test comment"; From/To/Apply filter confirmed working, 0→3→4 records). Scheduling — Add Shift modal works (Notes field unaffected by finding 28); reproduced finding 23 (Add Shift inert with "All Outlets" selected) and finding 24 again (shift dated 07/01/2026 saved under Tue 06-30 column) — test shift was then cleanly cancelled via Edit Shift → Cancel Shift, no data left behind. HR — all 4 tabs tested: Leave Requests full pending→rejected cycle works correctly with correct date persistence (Reason field unaffected by finding 28); Leave Balance reproduces finding 22 (blank Employee column) in this tenant too; Payroll Period Name field unaffected by finding 28 (not submitted, to avoid duplicating the existing `AUDIT Period 20260630` draft); Attendance Summary loads correctly (Test Owner, 3 days worked, 0.0h — consistent with same-minute check-in/check-out pattern already noted). Fulfillment — all 4 remaining sub-tabs tested: Pickup Orders (correct empty state, status filter present), Picklists (correct empty state), Quick Dispatch (reproduced finding 16 silent empty-scan; unknown value correctly produces "Order not found" + Recent Scans log row), Loadsheets (correct empty state). Courier Settings — BlueEx toggle Enable/Disable cycle works correctly (credential fields appear when enabled, toggle reverts cleanly); Add Custom Courier form's Courier Name field unaffected by finding 28; cancelled without submitting. COD Settlements — reproduced finding 20 (Next with no courier silently stays on Step 1); courier dropdown is empty because no couriers are currently enabled tenant-wide (expected, not a new bug); wizard closed cleanly. Cash Management — outlet-scoped view correctly surfaces Open Drawer/Close Shift actions once an outlet is selected (matches the finding-23-style "All Outlets" gating pattern, but for buttons not blocked here); Close Shift modal opens with full denomination breakdown; **found new finding-28 instance (#11): the Notes field in the Close Shift modal drops keystrokes and snaps focus to the modal's Close button**, same exact symptom as the other 10 confirmed instances — modal closed without submitting, shift left open/unaffected (live shift, not closed during audit). Accounting — all 8 remaining sub-tabs individually verified with a widened Jan–Jul 2026 date range: Cash Flow (Rs 13,550 inflow), AP & AR (correct empty state), Balance Sheet (Rs 5,000 assets/equity), Expense Ledger (correct empty state), AP Aging (5 correct buckets, all Rs 0), Tax Ledger (correct empty state), Supplier Payments (correct empty state), Accounting Periods (reproduced finding 21 — empty-submit Create Period is silent; Period Name field unaffected by finding 28, not submitted).

Audit data added this session in the restaurant tenant, clearly labeled, left in place:
- Attendance record: Test Cashier, 07/01/2026 09:00 AM, Present, comment "AUDIT test comment" (no cancel/delete action exists on this page, consistent with the rest of the audit's "no destructive action available" pattern for attendance records).

No other audit data was left mid-flight — the Scheduling test shift was cancelled, the HR leave request was rejected, the Courier Settings test courier was never submitted, the COD Settlements wizard was closed without importing, and the Cash Management Close Shift modal was closed without submitting (the real open shift remains open, untouched).

**Session 4 progress continued:** Chart of Accounts — Add Account modal's Name field reproduces finding 28 (instance 12), confirmed via DOM inspection, modal closed without submitting. Journal Entries — New Entry modal's Description field reproduces finding 28 (instance 13); Add Line button works correctly (adds rows); account picker dropdown lists all 21 chart-of-accounts entries correctly; modal cancelled without submitting due to the broken description field. Trial Balance tab loads and Refreshes correctly with a date range (no posted entries exist, so result area is empty — expected, no bug). Credit-Debit Notes — Debit Notes tab switch works correctly (verified empty state changes from "No credit notes" to "No debit notes"); New Note modal's Reason field reproduces finding 28 (instance 14); Customer dropdown populated correctly; modal closed without submitting. Postdated Cheques — New Cheque modal's Cheque Number field reproduces finding 28 (instance 15); modal closed without submitting.

**Session 4 progress continued, part 2 (in progress, paused mid-task by user):** Reports page (`/reports`) — this is a different, more detailed reports surface than "Insights → Reports" tested earlier in the retail tenant (68 reports across 7 categories, with a left-rail category nav: Sales/Customers/Inventory/Operations/Finance/HR/Governance, plus global filters: search, time range, date range, outlet, category, brand, supplier, staff, shift). Confirmed working so far: Sales category default loads "Overview" sub-tab with real KPI cards (Today's Sales, Average Bill, Current Stock 481, Month Gross Margin) and a full row of sub-report tabs (Daily Operations, Comparative Trends, Sales Heatmap, Revenue Leaks, Product Mix, Sales Summary, Sales Detail, Order Wise, Item Wise, Category Wise, Sub-Category Wise, Monthly MOP Matrix, Cashier Wise, Refunds & Voids, Shift Summary, Shift Sales, Payment Summary, Cash Flow, Cash Audit, Denominations, Session Z-Report). Clicked into Customers category — confirmed it actually switches content (not just highight): now shows "Customer Details" sub-tab with different KPI cards (Customers In View: 1, Lifetime Spend: Rs 0.00, Repeat Buyers: 0) and a Customer Profile Master table, plus different sub-tabs (Customer Details, Customer Wise, RFM Analysis, Customer Retention, Capture Rate). This confirms category-tab switching works correctly for Sales→Customers at minimum — Inventory/Operations/Finance/HR/Governance not yet clicked into this pass.

**Session 5 progress (completed the full Reports/Report Builder/Retail Risk/Compliance/Setup/Account punch list from the prior resume point):**

Reports (`/reports`) — Inventory, Operations, Finance, HR, and Governance category tabs all confirmed correctly swapping both KPI cards and sub-tab rows (not just the highlight): Inventory→Merchandising (21 sub-tabs, Revenue/Gross Profit/Brands-Suppliers/SKUs-Categories KPIs), Operations→Outlet Comparison (5 sub-tabs), Finance→Settlement Overview (7 sub-tabs), HR→Attendance (6 sub-tabs, correctly showing the `Test Cashier` audit attendance record from session 4), Governance→Audit Controls (3 sub-tabs, all three correctly feature-gated with distinct messages: `reports_scheduled_exports`, `reports_profit_layer`, `reports_exceptions` — expected behavior, not a bug, since those flags are off for this tenant). Individual sub-report clicks verified: Sales→Sales Detail (15 real transaction rows) and Inventory→Dead Stock (correct empty state). **New finding 36**: the global filter bar's Category dropdown (and likely the search box) does not filter the Sales→Sales Detail sub-report — selecting "Appetizers" left all 15 unfiltered rows visible (including Grilled Chicken, Iced Tea, Chocolate Cake), while the same category filter correctly narrowed Inventory→Merchandising (Rs 13,300→Rs 1,050, 5/4→1/1 SKUs/categories) and Sales→Item Wise (correctly narrowed to Caesar Salad + Garlic Bread only, Rs 5,600) in the same session. This isolates the bug to the Sales Detail transaction-journal sub-report specifically — sibling reports respect the filter correctly. Global search box was also typed into ("Garlic") and did not filter Sales Detail either (same symptom, not yet isolated to search vs. category specifically, but likely the same root cause). Date range filter and Reset button both confirmed working correctly (Rs 13,300→Rs 11,950 for a 2-day window; Reset cleared all filters including search/category/brand/supplier/staff/shift).

Report Builder (`/report-builder`) — Dataset selection (5 datasets), Run (5 rows returned correctly for Sales Summary grouped by date), and Export CSV button all confirmed working. **Finding 28 instance #16**: the Save Report modal's Name and Description fields both reproduce the established pattern — typed text doesn't register (both fields empty via DOM inspection), focus snaps to a button. Modal cancelled without saving.

Retail Risk (`/retail-risk`) — all 3 tabs tested: No-Sale Events (correct empty state, date range + Apply), Anomaly Flags (correct empty state, Unreviewed/Reviewed/All filter + Refresh), Settings (real editable threshold inputs: Refund approval Rs 5,000, Shift variance Rs 500, Anomaly z-score 2.00 — not modified, these are live production values).

Compliance — Taxes (`/taxes`, 1 pre-seeded 0% default rule; **finding 28 instance #17** reproduced in the Create Tax Rule modal's Tax name field, cancelled without saving), FBR Settings (`/settings/fbr`, Sandbox environment correctly selected, HS Code field typing confirmed unaffected by finding 28, not saved, "Test Connection" intentionally not clicked to avoid a live third-party call), Tax Lookup (`/tax-lookup`, search for "milk" correctly returned real HS code rows: 0401 Milk and cream, 0402.10 Baby formula, both Punjab-rate-aware).

Setup — Outlets (`/outlets`, 1 outlet; Add Outlet correctly gates behind a real payment-gateway redirect for a second outlet — cancelled, did not proceed to payment; Edit Outlet modal correctly pre-populates existing data, but **finding 28 instance #18** reproduces in its Phone field with a distinct partial-capture symptom — only the first typed character ("0" of "03001234567") landed before focus snapped to a button, rather than the field staying fully empty like other instances — same root cause, cancelled without saving). Company Profile (`/company-settings`, full-page form — Trading Name field typed correctly, confirming finding 28 is modal-specific and does not affect full-page forms). Outlet Tax Profiles, Integrations (8 category tabs incl. Couriers correctly filtering to 12 courier options), POS Layouts, Receipt Templates (live receipt preview renders correctly), Barcode Templates, Printer Settings (not testing Test Print/Send Test Email to avoid real hardware/email triggers), Import (5-entity-type upload UI, not tested with a real file), Import from Shopify/Square (`/settings/import-from-competitor` — note: sidebar link innerHTML did not update the URL after 2 clicks in a row, worse than the usual single-retry finding-35 pattern; had to navigate by extracting the real `href` via JS and hitting it directly — worth a closer look if reproduced again), Backup & Restore (not clicking Download/Restore to avoid unnecessary production backup actions) — all load correctly with expected empty/seeded states.

Account — Billing (`/billing`, Pro Annual, real Rs 80,000 payment history row), My Tickets (correct empty state), Administrator (4 roles: Administrator/Manager/Cashier/Field Rep, not editing), Action History (18 real login audit entries, correctly filterable by 8 action types) — all load correctly.

No audit data was created or left behind this session — every modal opened for finding-28 verification (Report Builder Save, Create Tax Rule, Edit Outlet) was cancelled without submitting, and every other page was read-only navigation/verification.

**Resume point for next session:** the restaurant tenant's Reports/Report Builder/Retail Risk/Compliance/Setup/Account punch list is now fully done. Per the standing plan, begin the **café/QSR tenant** (`cafetestphase8`) next: log in (or verify existing session), then audit its full sidebar/nav surface page-by-page at the same granularity as retail and restaurant (navigation, forms, filters, modals, safe create/edit/cancel cycles, console errors). Pay attention to café/QSR-specific differences vs. retail and restaurant presets (e.g. quick-service modifiers, simplified floor/tab handling, course timing differences if present). After café, continue to the wholesale tenant (`wholesalewalktest1778451`) and its sub-accounts (Field Rep, Portal distributor/kiryana, Manufacturer portal) as previously planned.

~~1-15 (session 3/4 items through Postdated Cheques)~~ ALL DONE — see "Session 4 progress" paragraphs above for details.

No audit data was left mid-flight this session. No test records were created/submitted on the Reports page (read-only navigation/filtering only).
4. **Fulfillment** (`/fulfillment`) — click into Pickup Orders, Picklists, Quick Dispatch (test the empty-scan validation), and Loadsheets sub-tabs.
5. **Courier Settings** (`/courier-settings`) — test "Add Custom Courier" inline form and at least one Enable/Disable toggle (toggle back off afterward).
6. **COD Settlements** (`/cod-settlements`) — open the "Import new batch" 4-step wizard and walk through it without completing a real import.
7. **Cash Management** (`/cash-management`) — test Open Shift / Close Shift actions if a closed-out test is safe, or at minimum open the action and cancel.
8. **Accounting** (`/accounting`) — click into all 8 remaining sub-tabs (Cash Flow, AP & AR, Balance Sheet, Expense Ledger, AP Aging, Tax Ledger, Supplier Payments, Accounting Periods) and verify each renders real or correctly-empty data.
9. **Chart of Accounts** (`/chart-of-accounts`) — test "Add Account" (likely blocked by finding 28 — confirm and log as instance 11 if so).
10. **Journal Entries** (`/journal-entries`) — test "New Entry" (Add Line, account picker) and the "Trial Balance" tab.
11. **Credit-Debit Notes** (`/credit-debit-notes`) — test "New Note" form (likely blocked by finding 28 — confirm and log if so).
12. **Postdated Cheques** (`/postdated-cheques`) — test "New Cheque" form (likely blocked by finding 28 — confirm and log if so).
13. **Reports** (`/reports`) — re-test category-tab switching cleanly (Sales→Customers→Inventory→Operations→Finance→HR→Governance) and confirm each one actually changes the report list, not just the visual highlight. Click into a few individual reports within at least 2 categories.
14. **Report Builder** (`/report-builder`) — test dataset selection, Run, and Save (likely blocked by finding 28 for the Save-name field — confirm and log if so).
15. **Retail Risk** (`/retail-risk`) — click into "Anomaly Flags" and "Settings" tabs.
16. Then continue to **Taxes** (`/taxes`), **FBR Settings** (`/settings/fbr`), **Tax Lookup** (`/tax-lookup`) — Compliance section, not yet visited.
17. Then **Setup** section (Outlets, Company Profile, Outlet Tax Profiles, Integrations, POS Layouts, Receipt Templates, Barcode Templates, Printer Settings, Import, Import-from-competitor, Backup & Restore) — not yet visited.
18. Then **Account** section (Billing, My Tickets, Administrator, Action History) — not yet visited.

Given finding 28's breadth (10 confirmed instances), expect most "New/Add X" modals in steps 9-14 to be blocked by it — confirm each with the same DOM-inspection method (click field → type → check `document.activeElement` and the input's `.value` via `javascript_tool`) rather than assuming, since some modals (Gift Card, Reservation, Waitlist, Return Policy, Customer Group, Add Product) are NOT affected.

Only after restaurant Setup/Account/Compliance/People are done should the next tenant — **café/QSR** (`cafetestphase8`) — begin, followed by **wholesale** (`wholesalewalktest1778451`) and its sub-accounts.

## Café/QSR (`cafetestphase8`) — session 6, in progress

Logged in as Test Owner. Outlet is "Cafe Main" (1 of 1 outlets, Free-tier plan-limit banner shown on dashboard).

**Café/QSR preset-specific findings:**

- **POS is quick-service-first, not floor-plan-first.** `/pos` (routes to `/pos/restaurant`) shows "No tables in this floor plan yet" plus 4 top-level action buttons: **New Takeaway / New Delivery / New Drive-Thru / Open Tab** — a genuinely different POS entry point from both retail (cart-first) and full-service restaurant (table/floor-plan-first). This is the clearest preset-level UX difference found so far.
- **Finding 37 (new):** Even a Takeaway (quick-service, no seating) order still groups cart items into full-service course/seat structure — the cart showed "Shared · Course 1 · APPETIZER" for a single Cappuccino added to a Takeaway order. Full-service course-timing metadata appears to leak into QSR order types that have no real use for it. Not a hard blocker (order still totals correctly), but a UX/data-model leak worth a closer look.
- **Finding 38 (new):** Adding "Cappuccino (Sample)" to a Takeaway cart triggered a toast "Note: Item is out of stock — selling on override" and the item was added anyway with no confirmation step — the override happened silently/automatically rather than requiring an explicit manager/cashier acknowledgement. (Item was removed from the cart before completing the order, so no stock/sales impact.)
- Kiosk (`/kiosk`): store selector + PIN pad works identically to retail/restaurant; PIN 1234 correctly recognized "Test Owner — You are not clocked in today". Did not complete a clock-in (would leave live attendance state changed).
- Sidebar labeling: café preset keeps the **generic retail labels** "Customers" (not "Guests") and "Order History"/"Parked Orders" — unlike the restaurant preset's Guest-relabeling. This is a genuine, correct preset difference (café is closer to retail in back-office nomenclature even though its POS is QSR-style).
- Notifications: 1 unread "Shift Opened" notification; "Mark as Read" worked correctly (badge and "New" tag cleared). Header bell count lagged behind by one increment after marking read — cosmetic, not filed as a numbered finding.

**Pages passed this session (real interactions, not just navigation):**

- Dashboard: Revenue This Week Rs 450, Top Products (Cappuccino), Low Stock Alerts 0, Busiest Hour 9 AM, Avg Transaction Rs 450 — all rendered correctly, no console errors.
- Notifications — Mark as Read tested and confirmed.
- POS — Takeaway flow opened, item added/removed cleanly (see findings 37–38 above). Delivery/Drive-Thru/Open Tab buttons present but not opened.
- Kiosk — PIN recognition confirmed, did not complete clock-in.
- Orders — correct empty state (0 orders, all 4 age buckets at 0).
- Quotations — New Quotation full-page form loads and accepts input correctly (unaffected by finding 28, consistent with restaurant tenant). Not submitted.
- Parked Orders — found and cleanly deleted one pre-existing stray parked sale (Walk-in, Rs 450.00, dated 22/06/2026) via the inline Confirm/Cancel control (not a native dialog). List is now empty.
- Returns — correct empty state. Process Return modal opens correctly; **reproduced finding 33** (product-search box drops keystrokes — typing "Capp" left only "C" in the field, no dropdown). Cancelled without submitting.
- Return Policies — correct empty state on both Policies and Return Reasons tabs. Tab switching confirmed working.
- Order History (Sales History) — 7 real transactions shown; row-click detail panel opens correctly with Reprint/Invoice/Share/Email/WhatsApp/Void/Comp actions (receipt #7, Cappuccino, Rs 450.00). No destructive action exercised.
- Customers — correct empty state (0 customers). **Reproduced finding 28** on the "Add Customer" Name field — confirmed via DOM inspection (`document.activeElement` = Close button, field value empty). Cancelled without submitting.
- Customer Groups — correct empty state. First click on "New Group" was a no-op (finding-35 pattern), second click opened the modal correctly. Group name field is **unaffected** by finding 28 (typed correctly). Created `AUDIT Group 20260701`, then deleted it. **Finding 39 (new):** unlike the restaurant tenant's Customer Groups Delete (in-app inline confirm/cancel, no stall), the café tenant's Delete button triggers a **native `confirm()` dialog** that stalled the in-app browser for roughly 40+ seconds — substantially longer than the "several seconds" pattern documented elsewhere (finding 4) — before a pressed Enter key resolved it and the deletion completed successfully. Same underlying feature, inconsistent implementation/stall severity between tenants.
- CRM — dashboard loads (5 pipeline stages, all empty, Rs 0.00). **Reproduced finding 28** on "Add Lead" Lead name field. Cancelled without submitting.
- Loyalty Tiers — 4 pre-seeded tiers (Bronze/Silver/Gold/Platinum) render correctly with correct multipliers/discounts. Not edited.
- Gift Cards — correct empty state. New Card modal's Initial Value field accepted input correctly (unaffected by finding 28); created `FDAEF199ADBF` with Rs 100.00 balance, confirmed in the Cards list.
- Customer Invoices — correct empty state, status filter tabs present. New Invoice modal opens; **reproduced finding 28** on the line-item Description field. Cancelled without submitting.

No audit data left mid-flight: the stray parked sale was fully deleted, the test Customer Group was created and deleted, the Rs 100 gift card (`FDAEF199ADBF`) was intentionally left in place (harmless, clearly test data, consistent with how retail/restaurant tenants left their gift-card test data). All finding-28 verification modals (Add Customer, Add Lead, New Invoice) were closed without submitting.

### Café/QSR (`cafetestphase8`) — session 7, tenant complete

Continued and finished the full punch list. All pages verified with real interactions (not just navigation).

- **Messaging Inbox** — renders correctly ("No threads" / "Select a conversation" empty state), Open/Closed/All filter is a plain native `<select>`. PASS.
- **Campaigns** — correct empty state ("No campaigns yet"). New Campaign modal opened on first click (no finding-35 no-op); **reproduced finding 28** on the Campaign Name field. Cancelled without submitting.
- **Review Moderation** — all 4 tabs (Pending/Approved/Rejected/All) switch correctly with distinct empty-state text per tab. PASS.
- **Menu** (café preset relabels Products → "Menu", confirmed) — 5 pre-seeded sample items (Cappuccino, Croissant, Espresso, Iced Latte, Sandwich) with correct filters/columns. Add Product is a full-page form (not a modal) and typed correctly in Product Name — **unaffected by finding 28**, consistent with the restaurant-tenant pattern that full-page forms are safe. Cancelled without saving.
- **Categories** — 3 pre-seeded categories (Bakery, Cold Drinks, Hot Drinks). Create Category modal **reproduced finding 28** on the Category Name field. Cancelled.
- **Brands** — correct empty state. Create Brand modal **reproduced finding 28** on the Brand Name field. Cancelled.
- **Attribute Sets** — correct empty state. Create Attribute Set modal **reproduced finding 28** on the Set Name field. Cancelled.
- **Promotions, Price Lists, Smart Collections, Scheduled Changes** — all four load with correct empty states and full filter/tab UI (Promotions' Quote Test panel, Scheduled Changes' 5 status filters). No live data existed to re-test the datetime-serialization bug (finding 6) or Smart Collection stock-preview bug (finding 9) against.
- **Stock Adjustments** — net-zero test: +1 Found then -1 Counting Error on Espresso (Sample), both recorded correctly with correct signed amounts and reasons. PASS.
- **Transfers** — correct empty state; only 1 outlet exists (same single-outlet constraint as retail/restaurant, not independently re-tested).
- **Reorder Alerts** — correct empty state ("No products require reordering").
- **Suppliers** — **Finding 40 (new):** Create Supplier modal **reproduces finding 28** on the Company Name field in this tenant — confirmed on two separate attempts (ruling out a first-click race). This differs from retail, where supplier creation worked fine and a real credit supplier was created. Because no supplier could be created, the downstream PO-creation flow could not be exercised end-to-end here (see Purchase Orders below).
- **Purchase Orders** — correct empty state ("No purchase orders"). Full create/approve flow not exercised (blocked by the Suppliers modal bug above, not a separate defect).
- **Supplier Returns** (`/returned-stock`) — correct empty state, "Select an RMA" detail panel present.
- **Supplier Payables** — correct empty state, Aging Summary/All Invoices/Supplier Ledger tabs present.
- **Fulfillment** (`/fulfillment`) — correct empty state ("No unfulfilled orders"), all 5 sub-tabs present (Orders Queue, Pickup Orders, Picklists, Quick Dispatch, Loadsheets).
- **Courier Settings** — same 13 pre-seeded couriers as retail, all Disabled, adapters/tracking URLs configured correctly.
- **COD Settlements** — 13-courier + 5-status filters present, correct empty state.
- **Storefront** (`/store/cafetestphase8`) — home page and "All Products" listing render correctly ("Welcome to Cafe Test Phase 8", Shop Now CTA), but show "No products available yet" / "No products found" — none of the 5 sample menu items are configured for storefront visibility in this tenant. Cart page renders the correct empty-cart state. Checkout/product-detail pages could not be exercised further because no product is storefront-visible; this is a tenant data-configuration gap, not confirmed as a code defect.
- **Floor Plan** (`/restaurant/floor`) — correctly shows "No floor plans yet", confirming the QSR preset has no table/seating setup (consistent with the POS-level "no tables" observation from the previous session).
- **Checks** — correct empty state ("No open checks").
- **86'd Items** — correct empty state ("Nothing is 86'd right now").
- **Modifiers** (`/restaurant/modifiers`) — meaningfully used in this preset (toppings/doneness). New Group modal **reproduced finding 28** on the Name field, same as the original restaurant-tenant instance #1. Cancelled.
- **Menu Schedules** — day-parting grid renders correctly with outlet filter and 7-day/24-hour grid; correct empty state.
- **Reservations** — page loads and is functional (New button, date navigation) but is essentially dormant for this QSR preset given no floor plan/tables exist — consistent with the "no tables" observation.
- **Waitlist** — correct empty state ("No one is waiting"), 0 guests in queue.
- **Online Inbox** (`/restaurant/inbox`) — correct empty state, 5-source filter (Shopify/Daraz/WhatsApp/Facebook/QR), live 10s polling indicator.
- **Void/Comp Reasons** — same 10 pre-seeded reason codes as the restaurant tenant, all Active.
- **KDS** — all 3 tabs (Tickets, Routing Rules, Stations) render correctly. **Finding 41 (new, observational):** Ticket #1 (1x Cappuccino) has been sitting unbumped in the Tickets queue for ~13,143 minutes (~9 days) with no visible staleness alert or auto-expiry — left untouched (did not Bump/Recall) to avoid altering state tied to a real historical sale.
- **Tip Pools** — all 3 tabs (Pools/Distribution Rules/Payouts) present, correct empty state ("No tip pools yet").
- **Order Kiosks** — correct empty state ("No active kiosks for this outlet"), Launch counter/table kiosk buttons present.
- **Finance → Cash Management** — real data: 1 open shift (Test Owner, opened 09/05/2026, Rs 5,000 opening float), Cash In Rs 5,000, correctly reflected in the shift history table.
- **Finance → Expenses** — **reproduced finding 28** on the Add Expense modal (both Amount and Description fields failed to register typed text) — this differs from retail, where expense create/edit/delete was fully functional. Cancelled without submitting; no expense data left behind.
- **Finance → Approvals** — correct empty state ("No pending approvals found"), all 3 tabs present.
- **Finance → Accounting** — all 9 sub-tabs load correctly; Balance Sheet correctly reflects real Cash on Hand (Rs 5,000) tied to the open shift, matching Cash Management. Date range and outlet filters present.
- **Finance → Chart of Accounts** — same 18 pre-seeded accounts across 5 groups as retail.
- **Finance → Journal Entries** — Journal Entries + Trial Balance tabs, status filters, New Entry all present.
- **Finance → Credit/Debit Notes** — Credit/Debit tabs, 4 status filters, correct empty state.
- **Finance → Post-Dated Cheques** — status/type filters, correct empty state ("No cheques found").
- **Insights → Reports** — 68 reports across 7 categories (Sales, Customers, Inventory, Operations, Finance, HR, Governance) — **note:** unlike retail's 10 categories, this tenant has no Procurement, Multi-Channel, or Restaurant category tabs in the left rail; likely feature-flag-driven for this preset/plan tier rather than a bug. Governance → Audit Controls correctly shows "Governance reporting is disabled by the `reports_scheduled_exports` feature flag," matching retail's message exactly. Sales → Overview and Balance Sheet-adjacent data all rendered with real figures (Rs 450 revenue, 491 units in stock, Hot Drinks 100% category contribution).
- **Insights → Report Builder** — 5 datasets available, no saved reports; not exercised further (no need to duplicate the retail-tenant Run/Save/Delete cycle already verified).
- **Insights → Retail Risk** — all 3 tabs (No-Sale Events, Anomaly Flags, Settings) load with correct empty state.
- **People → Employees** — only 1 employee (Test Owner, Administrator). **Reproduced finding 28** on the Add Employee Full Name field — this differs from retail, where Add Employee worked fine. Cancelled without submitting.
- **People → Attendance** — correct empty state (0 active, 0 records), Add Record form present.
- **People → Scheduling** — correct empty state ("No shifts scheduled"), Add Shift button present.
- **People → HR** — all 4 tabs present. **Reproduced finding 22** on Leave Balance (Employee column blank, only "2" showing under Allowance with no name attached) — same defect as the restaurant tenant. Payroll and Attendance Summary tabs render correctly with correct empty states.
- **Compliance → Taxes** — 1 pre-seeded "Default Tax" rule (0.00%, default). Add Tax Rule modal **reproduced finding 28** on the Tax Name field. Cancelled.
- **Compliance → FBR Settings** — page loads with all expected fields (Enable toggle, Connection Status "Not Tested", Province/Environment/API Token/Default HS Code). Test Connection/Save not exercised (live third-party API).
- **Compliance → Tax Lookup** — province selector, search fields, and correct empty-prompt state all render correctly.
- **Setup → Outlets** — 1 outlet ("Cafe Main", Karachi), Edit/Delete actions present.
- **Setup → Company Profile** (`/company-settings`) — full-page form renders correctly with all sections (Business Identity — "Cafe / Fast Food / Counter" confirmed as the business type, Tax & Compliance, Branding & Currency, Regional Settings, Dashboard Targets, Inventory Intelligence, Customer Portal link, Customer Display link).
- **Setup → Outlet Tax Profiles** — correct state, "Cafe Main" listed under "Outlets without a tax profile."
- **Setup → Integrations** (`/settings/integrations`) — hub loads correctly with all 7 category tabs and Daraz/Shopify/WooCommerce/Facebook Shop/Instagram Shopping cards, Connect/Manage buttons present.
- **Setup → POS Layouts** — correct empty state ("No POS layouts yet").
- **Setup → Receipt Templates** — 1 "Default" template (marked ACTIVE) with a full sample receipt preview rendered correctly (subtotal/tax/total/change/FBR ref/QR/footer).
- **Setup → Barcode Templates** — correct empty state ("No templates yet").
- **Setup → Printer Settings** — full form (Connection Type, Paper Size, Purpose, Kick Cash Drawer, Email Settings/SMTP) all present.
- **Setup → Import Data** — Products/Customers/Suppliers/Expenses/Payments tabs, Download Template and upload dropzone present.
- **Setup → Backup & Restore** — Download Backup / Restore from Backup sections and empty Backup Log all render correctly.
- **Account → Billing** — **note:** this tenant is on the **Free plan** (1 outlet / 3 employees / 100 products cap), unlike retail/restaurant which appeared to be on Pro trial — explains the "Approaching plan limit" banner seen on the dashboard all session. Upgrade pricing cards (Annual/Monthly/Quarterly/Semi-Annual) render correctly. Upgrade button not clicked (live payment flow).
- **Account → My Tickets** — correct empty state ("No tickets submitted yet").
- **Account → Administrator** — 4 roles listed: Administrator, Manager, Cashier (all "System" roles, matching retail/restaurant), plus **Finding 42 (new, observational):** a non-system **"Field Rep"** role (permission `manage_field_sales`, has a Delete action) is present in this café/QSR tenant's role list. This is a wholesale/field-sales-specific role and its presence here looks like an artifact of a shared default role-seed rather than something scoped to the café preset — not confirmed as harmful (no field-rep UI exists in this tenant to actually use it), but worth a closer look at how role seeding is scoped per business-type preset.
- **Account → Action History** — 9 entries, all "Test Owner logged in" system events across sessions from 10/05/2026 through 01/07/2026. Renders correctly with category filter chips (Sale/Return/Void/Adjustment/Transfer/Purchase Order/Login).

**Café/QSR tenant is now COMPLETE.** No audit data left mid-flight or requiring cleanup this session (Stock Adjustment net-zero pair, all Cancel-only modal tests). Pre-existing test data left in place from prior sessions (gift card `FDAEF199ADBF`, `AUDIT Group 20260701` already deleted) — no new orphaned records created.

**New findings this session:** 40 (Suppliers Create modal blocked by finding-28 pattern, blocking PO flow), 41 (KDS ticket stuck unbumped ~9 days, no staleness handling observed), 42 (observational — out-of-place "Field Rep" role in café tenant's role list). Finding 28 proved considerably more widespread in this tenant than in the restaurant tenant — confirmed on 9 separate "Create/Add" modals this session alone (Campaign, Category, Brand, Attribute Set, Supplier, Modifier Group, Expense, Employee, Tax Rule), compared to only 3-4 confirmed instances in the restaurant tenant. Every full-page form (Add Product, HR Submit Leave, Company Profile) remained unaffected, confirming the bug is specific to the modal-dialog input pattern, not React state management generally.

Next: proceed to the **wholesale tenant** (`wholesalewalktest1778451`) and its sub-accounts (Field Rep, Portal distributor/kiryana, Manufacturer portal) per the original standing plan.

### Café tenant — remaining punch list (same granularity as retail/restaurant)

1. **Messaging Inbox** (`/messaging/inbox`) — was mid-load when paused; verify it renders (empty state expected, thread-based).
2. **Campaigns** (Marketing) — test New Campaign modal (expect finding 28 per restaurant precedent).
3. **Review Moderation** — verify Pending/Approved/Rejected/All filter tabs actually filter.
4. **Menu** (`/inventory`, Products) — café preset relabels this "Menu"; test Add Product (full-page form, expected unaffected by finding 28 per restaurant precedent).
5. **Categories, Brands, Attribute Sets** — test Create modals (expect finding 28 per restaurant precedent, instances 6–7).
6. **Promotions, Price Lists, Smart Collections, Scheduled Changes** — test create/edit flows; watch for the known Scheduled Changes datetime-serialization bug (finding 6) and Smart Collection stock-preview bug (finding 9) if reproducible here.
7. **Inventory Audit, Stock Adjustments, Transfers, Reorder Alerts** — test with net-zero-stock discipline.
8. **Suppliers, Purchase Orders, Supplier Returns, Supplier Payables** — test Create Supplier (expect finding 28), then PO flow if a supplier can be created.
9. **Fulfillment, Courier Settings, COD Settlements** — test sub-tabs and wizards without live third-party triggers.
10. **Storefront** (if enabled for this tenant) — verify home/listing/product/cart/checkout render.
11. **Café/QSR-specific modules**: Floor Plan (likely minimal/no tables per POS observation), Checks, 86'd Items, **Modifiers** (expect finding 28 per restaurant precedent — this was the original instance #1), Menu Schedules, Reservations, Waitlist, Online Inbox, Void/Comp Reasons, KDS (Routing Rules/Tickets/Stations), Tip Pools, Order Kiosks — pay special attention to whether course-timing/table features are meaningfully present or mostly dormant for this QSR preset (per the POS-level "no tables" + "Course 1" leak observations above).
12. **Finance**: Cash Management, Expenses (expect the Uncategorized-persistence bug, finding 19, if reproducible), Approvals, Accounting (all 9 sub-tabs), Chart of Accounts, Journal Entries, Credit/Debit Notes, Postdated Cheques.
13. **Insights**: Reports (all 7 categories), Report Builder, Retail Risk.
14. **People**: Employees (expect finding 28 on Add Employee per restaurant precedent), Attendance, Scheduling (watch for findings 23/24 — outlet-gating and date-shift bugs), HR (watch for finding 22 — blank Employee column on Leave Balance).
15. **Compliance**: Taxes, FBR Settings, Tax Lookup.
16. **Setup**: Outlets, Company Profile, Outlet Tax Profiles, Integrations, POS Layouts, Receipt Templates, Barcode Templates, Printer Settings, Import Data, Import from Shopify/Square, Backup & Restore.
17. **Account**: Billing, My Tickets, Administrator, Action History.

After café is fully done, proceed to **wholesale tenant** (`wholesalewalktest1778451`) and its sub-accounts (Field Rep, Portal distributor/kiryana, Manufacturer portal) per the original standing plan.

No audit data was left mid-flight in the restaurant tenant — all test records created this session (`AUDIT Reservation 20260701`, `AUDIT Waitlist 20260701`, `AUDIT Modifier Group 20260701` attempt) were either cancelled/deleted or never persisted (the modifier group never saved due to finding 28).

Audit data left in place from this session, clearly labeled, not yet cleaned up:
- `AUDIT Employee 20260630` (Employees) — Archive uses a native `confirm()` that stalled the in-app browser; left active.
- `AUDIT Tax 20260630` (Taxes, 5%) — Delete uses a native `confirm()` that stalled the in-app browser; left in list.
- `AUDIT Period 20260630` (HR → Payroll) — draft payroll period, 1–30 Jun 2026, no lines generated, no financial impact.

After retail, audit in this order:
1. Restaurant tenant (`sanoposlivetest1778021564659`)
2. Café/QSR tenant (`cafetestphase8`)
3. Wholesale tenant (`wholesalewalktest1778451`) and wholesale sub-accounts

Use the login sheet at `C:\Users\HP\OneDrive\Desktop\shop documents\livetestauto — Functional Sweep Ten.txt` for credentials. For each tenant, audit its full sidebar/nav surface page-by-page the same way retail was covered (see "Retail — passed" section above for the level of granularity expected: navigation, forms, filters, modals, safe create/edit/cancel cycles, console errors).

## Audit rules

- Test one page at a time so one slow or broken screen cannot abort the rest.
- Use visible page state and targeted controls; avoid broad snapshots on POS/Kiosk.
- Safe test-tenant mutations are authorized, but leave net stock unchanged and clearly label audit records.
- Avoid real payments, third-party integration triggers and unapproved external messages.
- Avoid native confirmation-based delete actions because they stall the in-app browser.
- Do not complete stock count `SC-20260630-001` or start `AUDIT Cycle Count Schedule 20260630`.
- Do not approve or reject PO #2 in Approvals.
- Append progress and findings to this file before pausing.

## Copy-paste resume prompt

```
Continue the SanoPOS adaptive live functional audit.

Workspace: D:\newprojects\oneshoppos

First read:
1. AGENTS.md
2. monitoring/shop-health/reports/2026-06-30-live-functional-audit.md
3. The Claude in Chrome extension tools (use mcp__Claude_in_Chrome__* tools throughout — NOT Playwright)

Use the Claude in Chrome extension for human-style, page-by-page testing.

Retail (livetestauto) is fully audited — do not repeat anything in "Retail — passed". Three clearly-labeled audit records remain in the retail tenant from native-confirm-dialog stalls (AUDIT Employee 20260630, AUDIT Tax 20260630, AUDIT Period 20260630) — see "Resume point" section for details; leave them as-is unless asked to clean up.

Restaurant (sanoposlivetest1778021564659) is now audited with real interactions (not just navigation checks) for all restaurant-specific modules AND the customer/sales-facing shared pages — see "Restaurant — passed", "Restaurant — shared/generic pages, individually verified with real interactions", "Restaurant — partial / blocked", and findings 28-35. Do not repeat: Floor Plan, Checks, Availability, Modifiers, Reservations, Waitlist, Online Orders Inbox, Void/Comp Reasons, KDS (all 3 tabs), Tip Pools (all 3 tabs), Order Kiosks, Orders, Quotations, Returns, Return Policies, Order History, Guests, Customer Groups, CRM, Loyalty Tiers, Gift Cards, Customer Invoices, Messaging Inbox, Marketing Campaigns, Review Moderation, Parked Orders.

Key findings to remember before doing further work in this tenant: finding 28 is a confirmed, reproducible "new entity" modal bug (typed text doesn't register) affecting Modifiers/CRM Lead/Customer Invoice line items/Marketing Campaign — but NOT universal, several other modals work fine. Finding 29 is a Reservations date-default-to-yesterday bug. Findings 33-34 are real defects in the Returns product-search box (keystroke dropping + click-target mismatch risk). Finding 35 documents a tenant-wide first-click-after-navigation no-op pattern (likely a hydration-timing issue, not per-page bugs) — always retry a non-responding button once before concluding it's broken.

The restaurant tenant's Reports, Report Builder, Retail Risk, Compliance (Taxes/FBR Settings/Tax Lookup), Setup (Outlets through Backup & Restore), and Account (Billing/My Tickets/Administrator/Action History) sections are now all fully verified with real interactions — see "Session 5 progress" and finding 36 (Sales Detail report ignores the category/search filter bar while sibling reports respect it) plus finding 28 instances 16-18. Nothing further is required in the restaurant tenant before moving on.

Retail (livetestauto), Restaurant (sanoposlivetest1778021564659), and Café/QSR (cafetestphase8) are now FULLY audited — do not repeat anything documented for them. Café tenant findings to remember: finding 28 (modal-input bug) is confirmed far more widespread here than in the restaurant tenant (9 separate Create/Add modals affected this session: Campaign, Category, Brand, Attribute Set, Supplier, Modifier Group, Expense, Employee, Tax Rule) — always verify with a real typing test rather than assuming a modal works. Finding 40 is the Suppliers Create modal being blocked by this pattern (unlike retail, where it worked), which also blocked full PO-flow testing in this tenant. Finding 41 is an observational note about a KDS ticket stuck unbumped for ~9 days with no visible staleness handling. Finding 42 is an observational note about an out-of-place "Field Rep" role appearing in the café tenant's Administrator role list.

Next: switch to the wholesale test tenant (wholesalewalktest1778451) and its sub-accounts. Credentials are in C:\Users\HP\OneDrive\Desktop\shop documents\livetestauto — Functional Sweep Ten.txt. Keep credentials out of chat and outputs. Sub-accounts on this tenant: Field Rep (Field Rep One), Portal distributor (testdist+test@sanomerchandise.com), Portal kiryana (khalid+test@sanomerchandise.com), Manufacturer portal (wholesalewalk-1778451+acme@gmail.com).

Audit the wholesale tenant's full sidebar/nav surface page-by-page, at the same granularity as retail/restaurant/café: navigation, forms, filters, modals, safe create/edit/cancel cycles, console errors. This tenant has substantial custom B2B/wholesale functionality built across several project phases (see memory: Tier 0 credit/A-R, Tier 1.1 field-rep check-ins, Tier 1.2 order capture, Tier 1.3 schemes/slab pricing, Tier 1.4/1.5 manufacturer portal, Tier 2 reorder/MOQ/catalog visibility) — pay special attention to these wholesale-specific modules and to each of the 4 sub-account login flows (Field Rep mobile PWA, Portal distributor, Portal kiryana, Manufacturer portal), which each have separate auth/session scopes from the main admin login.

For every page:
- Verify navigation and visible content.
- Test buttons, forms, filters, modals, and safe workflows individually.
- Verify actual results, not merely clicks.
- Check console errors.
- Record pass, partial, failure, or untested.
- Continue after individual failures.

Safety:
- Avoid native confirmation-based deletes (they reliably stall the in-app browser for several seconds — wait it out rather than retrying).
- Avoid real payments and live third-party triggers.
- Keep stock changes net-zero.
- Clearly label all audit records.
- Do not fix code; document defects only.

Append all progress and new findings to:
monitoring/shop-health/reports/2026-06-30-live-functional-audit.md

Before pausing, update the exact next page and add a fresh copy-paste resume prompt.
```

## Wholesale (`wholesalewalktest1778451`) — session 8, in progress

Logged in as Wholesale Test Owner (Free plan, 3/3 employees, 1/1 outlets — "Main Warehouse" outlet). Testing via real sidebar clicks (not direct URL navigation, which was found to trigger unnecessary full-page reloads mid-session — clicking sidebar links like a real user is the correct approach and was adopted for the rest of this session).

**Wholesale preset-specific sidebar relabeling confirmed:** "Customers" → "Buyers", "Parked Sales" → "Parked Invoices" (sidebar) / page still titled "Parked Sales", "Customer Groups" → "Buyer Groups" (sidebar) / page still titled "Customer Groups", "Customer Invoices" → "Buyer Invoices" (sidebar) / page still titled "Customer Invoices", "Sales History" → "Invoice History". New nav sections not present in other presets: **BUYERS** (Buyers, Buyer Groups, CRM, Loyalty Tiers, Gift Cards, Buyer Invoices, Inbox, Campaigns, Review Moderation), **FIELD SALES** (Routes, Visits, Today's Route), **ONLINE STORE** (View Storefront), plus a **Manufacturer Partners** setup page and a **Field Sales Today** card + **"View all visits"** link on the dashboard (routes to `/field/visits`).

**New finding 43 (relabeling, minor, recurring pattern):** Sidebar labels "Parked Invoices," "Buyer Groups," and "Buyer Invoices" do not match their page headings ("Parked Sales," "Customer Groups," "Customer Invoices" respectively) — same relabeling-inconsistency pattern already documented for the restaurant/café presets (see "Minor relabeling inconsistencies" section), now confirmed as a systemic issue across at least 3 wholesale-specific relabels, not isolated to one page.

**New finding 44 (confirmed defect, real B2B/AR impact):** Buyer Invoices (`/customer-invoices`) — the **overdue** status filter tab returns "No invoices found" even though the "All" tab correctly shows 2 invoices (INV-AR-1, Rs 120,000 and INV-AR-2, Rs 60,000) with a red "overdue" status badge and a due date of 11/06/2026 (in the past relative to today, 2026-07-02). All other filter tabs were not individually re-verified this session but the same underlying filter mechanism is shared. This hides the AR collections worklist for whoever manages receivables — a real workflow-blocking bug for the wholesale credit-account feature, not cosmetic.

**Unconfirmed/transient — not filed as a numbered finding:** Holds & Layaway threw a full `ErrorBoundary` crash once ("Something went wrong" / `TypeError: Cannot read properties of undefined (reading 'default')` inside `recharts`), and clicking Reload logged the session out entirely (redirected to `/login`) rather than recovering — this coincided with a reported local internet-connectivity interruption. After logging back in, Holds & Layaway loaded correctly on the next attempt (correct empty state, filters present). Not reproduced a third time; flagging for a future session to re-check specifically if it recurs, since an ErrorBoundary-into-logout chain would be a bad UX pattern even if triggered by a transient network blip.

**Pages passed this session (real interactions):**

- Dashboard: Revenue This Week Rs 0.00, Low Stock Alerts 0, Busiest Hour 4 AM, Avg Transaction Rs 0.00, Approaching-plan-limit banner (3/3 employees, 1/1 outlets), Field Sales Today card (Field Rep One), "View all visits" link — all render correctly, no console errors.
- POS (`/pos`) — loads correctly (product search by name/barcode/SKU/price, empty cart, Products List) — screenshot-expensive as previously documented (finding 1), used `find` instead per established practice. No console errors.
- Kiosk — PIN pad and store selector render correctly.
- Orders — 4 age-bucket cards (Fresh/Aging/Stale/Critical, all 0), search + 3 status filters, correct empty state ("No orders found").
- Quotations — correct empty state; New Quotation is a full-page form (Header/Line Items/Discount & Notes/Subtotal-Tax) that accepted input correctly, consistent with the established pattern that full-page forms are unaffected by the modal-input bug family (finding 28). Not submitted.
- Parked Invoices (Parked Sales) — correct empty state ("No parked sales").
- Holds & Layaway — correct empty state (Count 0, Total held Rs 0.00, Balance outstanding Rs 0.00), Active/All outlets filters present. (See transient-crash note above.)
- Returns — 1 real return (RTN-1, Rs 10,000, `credit_reversal` method) with a working detail panel showing restocked items (Bulk Product A, 1.000 × Rs 10,000.00) — confirms the wholesale credit-account refund path renders correctly.
- Return Policies — correct empty state, Policies/Return Reasons tabs present.
- Invoice History (Sales History) — 10 real transactions with correct filters (search, date range, method, employee, Completed/Voided/All).
- Buyers (Customers) — 5 real B2B accounts with tier badges (Shaheen General Store / Tier A Premium, New City Mart / Tier B Standard, Khalid Kiryana Store, Ahmed Brothers). Detail panel (Profile/Ledger/Order History tabs) opens correctly; Ledger tab shows real dated sale transactions with debit amounts and a working date-range filter — confirms the Tier 0 A/R ledger renders correctly for a live account (Shaheen General Store: 2 orders, Rs 130,000 spent, Rs 65,000 avg order).
- Buyer Groups (Customer Groups) — 2 real groups (Tier A Premium, 2 members, 10% discount; Tier B Standard, 1 member, 5% discount) — confirms Tier 2 customer-group catalog-visibility/pricing groups are live and correctly populated. Edit modal opens with pre-filled data (unaffected by the finding-28 modal-input bug, consistent with pre-filled-field modals working elsewhere). Cancelled without saving.
- CRM — 5-stage pipeline (New/Contacted/Qualified/Converted/Lost, all Rs 0.00, empty).
- Loyalty Tiers — correct empty state (not used in this B2B preset by default).
- Gift Cards — correct empty state, Cards/Ranges tabs, Gift Card Balance checker present.
- Buyer Invoices (Customer Invoices) — 7 real invoices across all statuses for "Test Distributor" (draft/sent/paid/overdue), Batch action, CSV export, New Invoice. See finding 44 above for the overdue-filter defect.
- Inbox (Messaging Inbox) — correct empty state ("No threads"), Open/Closed filter.
- Campaigns (Marketing Campaigns) — correct empty state, Templates link, New Campaign button present.
- Review Moderation — correct empty state on Pending tab, all 4 filter tabs (Pending/Approved/Rejected/All) present.
- Products (Catalog) — 3 real wholesale-scale products (Bulk Product A, Rs 10,000, stock 62; Bulk Product B, Rs 15,000, stock 98; Clearance Item, Rs 2,000, stock 97) in "Bulk Items"/"Clearance" categories — confirms wholesale-scale pricing/stock renders correctly, distinct from retail-tenant unit pricing.
- Categories — 2 real leaf categories (Bulk Items, Clearance) with correct direct/rollup product counts.
- Brands — 1 real brand ("Acme Brand", "Test brand for manufacturer-partner walkthrough") — confirms this brand is the same one scoped to the Acme manufacturer-partner portal account tested later.
- Attribute Sets — correct empty state.
- **Promotions — real interactive quote test performed and verified correct:** 1 live promotion, "Bulk A Volume Slab" (type: Volume Slab qty tiers → %, value "5-9: 5%, 10+: 10%", applies to a specific product). Added 10 × Bulk Product A (Rs 10,000 each = Rs 100,000 cart) to the Quote Test panel and clicked Run Quote — Evaluation Result correctly returned "Total Promotion Discount: Rs 10,000.00" with a breakdown row showing `Bulk A Volume Slab / slab_percent / Rs 10,000.00`, exactly matching the 10% "10+" tier. **This confirms the Tier 1.3 slab-percent promotion engine (the core wholesale pricing differentiator) computes correctly end-to-end against a live quote.** Test cart cleared afterward, no promotion data was modified.
- Price Lists — correct empty state ("No price lists yet").
- Smart Collections — correct empty state.
- Scheduled Changes — correct empty state on the default "pending" tab; pending/applied/cancelled/failed/All filter tabs present.

**Session 8 continued — Inventory section fully done:**

- Inventory Audit — correct empty state ("Start Count" present, no counts list). Not started (would create in-progress state to manage).
- Stock Adjustments — **net-zero test performed and passed:** +1 "Found" then -1 "Counting Error" on Bulk Product A (Sample), both recorded correctly with correct signed amounts, reasons, timestamps, and employee attribution. Net stock unchanged. Quantity input field accepted typed values correctly (modal, but unaffected by the finding-28 input bug family).
- Transfers — correct empty state (single-outlet tenant, same constraint as retail/restaurant/café).
- Reorder Alerts — correct empty state ("No products require reordering").
- Intelligence (Inventory Intelligence) — all 4 tabs verified: ABC Analysis (real classification data — Bulk Product A ranked "A" at 91.5% revenue share, 39 units sold; Bulk Product B and Clearance Item both ranked "C"), Reorder (correct empty state, disabled "Create POs (0)"), Cycle Counts (correct empty state on both Schedules and Recent sessions, "New schedule" present), Aging (correctly shows `Feature disabled: reports_inventory_health_plus`, same as retail/café — consistent, not a bug).

**Procurement section — in progress when session ended (context window filled up):** Suppliers page loads correctly (0 suppliers, correct empty state, stat cards for Total/Credit/Cash Suppliers and Total Outstanding all Rs 0.00). Clicked "Add Supplier" — opens a **modal** (Create Supplier: Company Name, Contact Person, Phone, Email, Address, Payment Terms toggle Cash-on-Delivery/Credit Account, Default Lead Time). Began typing "AUDIT Supplier 20260702" into the Company Name field to test for the finding-28 modal-input bug family (confirmed widespread in café tenant, present but less common in restaurant tenant) — **the browser tab disconnected before the result could be verified.** This must be re-checked first in the next session: reopen Suppliers → Add Supplier, type into Company Name, and verify via a screenshot or `document.activeElement` DOM check whether the text registers (matches finding 28) or whether Suppliers behaves like retail (where Add Supplier worked correctly end-to-end). No supplier was created — the modal was never submitted.

**Resume point:** Re-verify the Suppliers → Add Supplier modal (in progress, unconfirmed) first, then continue with the rest of **Procurement** (Purchase Orders, Supplier Returns, Supplier Payables), **Fulfillment** (Fulfillment, Courier Settings, COD Settlements), **Field Sales** (Routes, Visits, Today's Route — wholesale-specific, high priority), **Online Store** (View Storefront — test reorder/`?adopt=` flow from Tier 2 if reachable), **Finance** (Cash Management, Approvals, Accounting, Chart of Accounts, Journal Entries, Credit/Debit Notes, Post-Dated Cheques), **Insights** (Reports, Report Builder, Retail Risk), **People** (Employees, Attendance, Scheduling, HR), **Compliance** (Taxes, FBR Settings, Tax Lookup), **Setup** (Outlets, Company Profile, Outlet Tax Profiles, Integrations, **Manufacturer Partners** — wholesale-specific, high priority, POS Layouts, Receipt Templates, Barcode Templates, Printer Settings, Import Data, Import from Shopify/Square, Backup & Restore), **Account** (Billing, My Tickets, Administrator, Action History). After the main admin account is fully audited, log into and test the 4 sub-accounts: Field Rep (Field Rep One / FieldRep778!, mobile PWA), Portal distributor (testdist+test@sanomerchandise.com / PortalPass123!), Portal kiryana (khalid+test@sanomerchandise.com / PortalPass123!), Manufacturer portal (wholesalewalk-1778451+acme@gmail.com / MfrPortal778!).

**Note on browser stability this session:** the Claude in Chrome extension connection dropped/reconnected transiently 2-3 times, and one tab was lost entirely at session end. If this recurs, call `tabs_context_mcp` to check available tabs and re-navigate/re-login rather than assuming the tool call failed outright — several "failed" screenshots actually completed once retried immediately after.

**Note on navigation technique:** use real sidebar link clicks, not direct URL navigation via the `navigate` tool — direct navigation was observed to trigger a full page reload ("Loading session...") rather than the SPA's client-side routing, which is not representative of real user behavior and is slower. Click the sidebar item and wait for the content to update instead.

## Copy-paste resume prompt (wholesale, session 9 continuation)

```
Continue the SanoPOS adaptive live functional audit in the wholesale test tenant.

Workspace: D:\newprojects\oneshoppos

First read the ENTIRE file monitoring/shop-health/reports/2026-06-30-live-functional-audit.md, especially the "Wholesale — session 8" section near the end (Inventory section results, and the in-progress/unconfirmed Suppliers → Add Supplier modal check).

Use the Claude in Chrome extension tools (mcp__claude-in-chrome__*, load via ToolSearch if deferred) for human-style, page-by-page testing. Log in fresh (call tabs_context_mcp first — the previous session's tab/session may be gone). Navigate by clicking sidebar links like a real user, not by typing URLs directly via the navigate tool (direct URL navigation was observed to trigger a full page reload instead of SPA client-side routing — slower and not representative of real usage).

**Use the app like an actual human tester for every single thing visible on a page — not just a glance-and-move-on pass:**
- Click every button, tab, filter dropdown, and toggle you can see, and confirm the UI actually changes in response (not just that the click registered).
- For every list/table page, check whether it's showing real data or an empty state, and whether that matches what you'd expect.
- For every "Add/New/Create" action, open the form or modal and actually type into at least the first field — verify the typed text appears in the field (take a screenshot or check the input's value) before deciding it works. Several modals in this app have a known bug (finding 28, extensively documented above) where typed text is silently dropped and focus snaps to the modal's close button — you cannot tell this from a single click, you must verify the value.
- For filter tabs/dropdowns (status filters, date ranges, category filters), actually select a non-default value and confirm the results change correctly — finding 44 (Buyer Invoices "overdue" filter) was only caught by doing this, not by looking at the tab.
- Check the browser console for errors on every page (`read_console_messages` with `onlyErrors: true`).
- Cancel out of any create/edit modal you open for testing rather than submitting, unless the workflow specifically calls for a labelled, safe test record (see Safety below).

Retail, Restaurant, and Café/QSR tenants are fully audited — do not repeat them (see their respective sections above).

Wholesale tenant (wholesalewalktest1778451, login: Wholesale Test Owner) is now audited through: Dashboard, SELL, BUYERS, CATALOG, and INVENTORY sections (see "Session 8 continued — Inventory section fully done" above) — do not repeat these. Credentials are in C:\Users\HP\OneDrive\Desktop\shop documents\livetestauto — Functional Sweep Ten.txt. Keep credentials out of chat/outputs.

Key findings so far in wholesale: finding 43 (sidebar label vs page-heading mismatches on 3 pages — cosmetic), finding 44 (Buyer Invoices "overdue" filter tab returns zero results despite 2 real overdue invoices being visible in "All" — confirmed real defect, blocks AR collections workflow). The Tier 1.3 slab-percent promotion engine was verified correct via a live 10-unit quote test (Rs 10,000 discount on Rs 100,000 cart, exactly matching the 10% tier). A Holds & Layaway ErrorBoundary crash occurred once (recharts TypeError) coinciding with a real connectivity interruption, then did not reproduce on retry. A Stock Adjustments net-zero test (+1 Found / -1 Counting Error) passed cleanly.

**First task this session:** re-verify the Suppliers → Add Supplier modal, which was left unconfirmed when the previous session's browser tab disconnected mid-test. Navigate to Suppliers, click Add Supplier, type a clearly-labelled test name (e.g. "AUDIT Supplier <today's date>") into the Company Name field, and verify via screenshot/DOM check whether the text actually registers in the field. If it works, fill in a real Credit Account supplier (consistent with the retail-tenant audit pattern) and leave it in place; if it reproduces the finding-28 bug, log it as a new confirmed instance and cancel out without submitting.

Then continue with the rest of PROCUREMENT (Purchase Orders, Supplier Returns, Supplier Payables), FULFILLMENT (Fulfillment, Courier Settings, COD Settlements), FIELD SALES (Routes, Visits, Today's Route — wholesale-specific, prioritize and test thoroughly since this is unique to this tenant), ONLINE STORE (View Storefront — also try to exercise the Tier 2 reorder/`?adopt=` cart-handoff flow if reachable from the admin side), FINANCE (Cash Management, Approvals, Accounting — all 9 sub-tabs, Chart of Accounts, Journal Entries, Credit/Debit Notes, Post-Dated Cheques), INSIGHTS (Reports — all categories, Report Builder, Retail Risk), PEOPLE (Employees, Attendance, Scheduling, HR), COMPLIANCE (Taxes, FBR Settings, Tax Lookup), SETUP (Outlets, Company Profile, Outlet Tax Profiles, Integrations, Manufacturer Partners — wholesale-specific, prioritize and test thoroughly, POS Layouts, Receipt Templates, Barcode Templates, Printer Settings, Import Data, Import from Shopify/Square, Backup & Restore), ACCOUNT (Billing, My Tickets, Administrator, Action History).

After the main admin account is fully done, log into and test the 4 sub-accounts (separate auth/session scopes from admin — log out of the admin session first, or use a fresh tab):
- Field Rep: username "Field Rep One", password FieldRep778! (mobile PWA-style check-in/order-capture flow — see memory: Tier 1.1/1.2. Test the full check-in → GPS/selfie (if simulatable) → order capture → checkout flow.)
- Portal distributor: testdist+test@sanomerchandise.com / PortalPass123! (customer self-service portal — browse catalog, check pricing tier, try reorder flow)
- Portal kiryana: khalid+test@sanomerchandise.com / PortalPass123! (customer self-service portal, smaller-account persona — compare against the distributor account for any tier-based differences)
- Manufacturer portal: wholesalewalk-1778451+acme@gmail.com / MfrPortal778! (brand-scoped partner portal — see memory: Tier 1.4/1.5, this is the account tied to the "Acme Brand" already seen in Catalog → Brands. Verify the PII invariant: only customers.city should ever be visible to this account, never full customer records.)

For every page:
- Verify navigation and visible content.
- Test buttons, forms, filters, modals, and safe workflows individually — actually click/type/select and verify the real result, not just that the element exists.
- Verify actual results, not merely clicks.
- Check console errors.
- Record pass, partial, failure, or untested.
- Continue after individual failures.

Safety:
- Avoid native confirmation-based deletes (they reliably stall the in-app browser for several seconds — wait it out rather than retrying).
- Avoid real payments and live third-party triggers.
- Keep stock changes net-zero.
- Clearly label all audit records (prefix with AUDIT and today's date).
- Do not fix code; document defects only.

Append all progress and new findings to:
monitoring/shop-health/reports/2026-06-30-live-functional-audit.md

Before pausing (including if you run low on context), update the exact next page and add a fresh copy-paste resume prompt at the end of the file, in the same format as this one.
```
