# Shop Health Walkthrough — Adaptive Daily Check (full end-to-end journeys)

You are a careful person who has been handed four real SanoPOS shops and asked:
"Log in like a real owner/cashier, actually USE the app the way they would — ring up
real sales start to finish — and tell me in plain English what works and what's broken."

You are NOT running a rigid script. Buttons move, layouts change, popups appear (install
prompts, plan-limit banners, "open a shift" / "clock in" flows). Adapt the way a real
person would: read the screen, figure out the next step, and keep going. Don't report a
false failure just because something wasn't where you last saw it — only report a failure
when a real user genuinely couldn't get the job done.

These are throwaway test shops. **Completing real transactions is expected and fine —
leave the test data in place.** Do NOT try to delete or void what you create.

## Shops

Read credentials from `shops.local.json` in this folder: `retail`, `cafe`, `restaurant`,
`wholesale`. Each has `storeCode`, `username`, `password`, `pin`, `expectedCurrency` (`Rs`),
and `type`.

## For each shop — drive the real journey with the Playwright browser MCP

Between shops, clear the session first: `localStorage.clear(); sessionStorage.clear();`
then reload `https://sanopos.com/login`. Log in with Store Code / Username / Password.

Throughout, **notice anything wrong** and record it:
- **Currency**: figures must show `Rs` (PKR), not `$`. (This was a bug that was fixed
  2026-06-19 — confirm it's still correct.)
- **Console errors**: read error-level console messages; a 401/403/500 on any API call is
  a real finding — quote the URL + status.
- **Wrong behavior**: numbers that don't add up, a sale that doesn't appear in reports, a
  step that silently does nothing.

### Retail (general_retail) — ring up a complete cash sale
1. From the dashboard, open the POS. If it asks you to open a shift and/or clock in, do it
   (use the `pin` to clock in / re-auth as a real cashier would).
2. Add a product to the cart (search or tap a product tile). Note its price.
3. Apply a discount if the option is readily available (optional — skip if it needs perms).
4. Check out and take a **cash** payment. Confirm the receipt / success screen appears.
5. Go to Order History / Sales report and confirm the sale you just made shows up with the
   right amount. **This propagation check is the most important part — it proves the whole
   loop, not just the POS screen.**

### Cafe & Restaurant (restaurant mode) — complete a dine-in or takeaway order
1. Open the POS. Handle the opening flow (branch select, open shift, clock in with `pin`).
2. Start an order — pick a table if a floor plan exists, otherwise "New Takeaway".
3. Add 1–2 menu items (note prices). Send to Kitchen if that step exists.
4. Pay (cash). Confirm the order closes / receipt shows.
5. Confirm it appears in Order History or the restaurant checks/closed-orders list.

### Wholesale (b2b_distribution) — exercise the B2B flow
1. Open the POS and ring up a sale to a customer. If a credit/account payment option exists,
   prefer a **credit** sale to a distributor customer; otherwise cash is fine.
2. Confirm the sale completes.
3. Open A/R aging (or the receivables/dashboard card) and confirm the credit sale is
   reflected. If you used cash, just confirm the sale shows in Order History.

If a shop is clearly broken at login or the POS won't open, record that plainly and move on
— don't get stuck retrying.

## Output — THIS IS THE DELIVERABLE

Write a plain-language markdown report to
`monitoring/shop-health/reports/<YYYY-MM-DD>.md` (today's date). Write it like a human note:

- One-line overall verdict at the top (all green / N issues found).
- A table: Shop | Login | POS opens | **Completed a real sale** | Showed in reports | Verdict (🟢/🟡/🔴).
- **What worked** — in everyday language, naming the actual journey you completed
  ("rang up a Cappuccino for Rs 450, paid cash, it appeared in order history").
- **What didn't** — each issue plainly: what you saw, why it matters, and the technical
  detail (URL/status/console line) so it's actionable. Rank by severity.
- **Changes since last run** — if a previous day's report exists in that folder, note what's
  newly broken or newly fixed.

Be honest and specific. If a journey completed cleanly, say so. If you had to stop partway,
say exactly where and why. Don't invent issues; don't paper over real ones.
Do not edit any application code — this is a health check that only writes its report.
