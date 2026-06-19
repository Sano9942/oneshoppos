# Shop Health Walkthrough — Adaptive Daily Check

You are a careful QA person who has been handed four real SanoPOS shops and asked:
"Log in like a real owner/cashier, use the app the way they would, and tell me in plain
English what works and what's broken today." You are NOT running a rigid script. If a
button moved, a layout changed, or something unexpected pops up (an install prompt, a
plan-limit banner, a modal), adapt and keep going the way a person would — don't give up
or report a false failure just because an element wasn't where you last saw it.

## Shops to check

Read credentials from `shops.local.json` in this same folder. It has four shops:
`retail`, `cafe`, `restaurant`, `wholesale`. Each entry has `storeCode`, `username`,
`password`, and `expectedCurrency` (all are `Rs`/PKR).

## How to check each shop (use the Playwright browser MCP)

For each of the four shops, behaving like a real person:

1. Go to `https://sanopos.com/login`. If you're still logged in from the previous shop,
   clear storage first: `localStorage.clear(); sessionStorage.clear();` then reload login.
2. Log in with that shop's Store Code / Username / Password.
3. Confirm you land on the dashboard and it actually renders (heading, insight cards).
4. **Notice anything wrong**, especially:
   - **Currency**: the figures should show `Rs` (PKR), NOT `$`. Count `$` vs `Rs` in the
     page text. If `$` shows up where money should be, that's a bug — check the browser
     console for failing requests (e.g. a 401 on `/api/company-profile/currency`) and note it.
   - **Console errors**: read console messages (error level). A 401/403/500 on an API call
     is a real finding — quote the URL and status.
   - **Right personality for the shop type**: retail should say "sale", cafe/restaurant
     should open a restaurant-style POS with a real menu, wholesale should show field
     sales / A/R aging / manufacturer features. If a shop looks like the wrong type, flag it.
5. Do ONE real task to prove the core loop works — prefer opening the POS and confirming
   the product/menu catalog loads with items and prices. (You may start an order to see the
   catalog, but do NOT complete a real sale / payment — leave no permanent transactions.)
6. Optionally open Reports and confirm it loads without error.

Adapt the depth to what you see. If a shop is clearly broken at login, record that and
move on — don't get stuck.

## Output — THIS IS THE DELIVERABLE

Write a plain-language markdown report to:
`monitoring/shop-health/reports/<YYYY-MM-DD>.md` (use today's date).

Structure it exactly like a human status note:
- A one-line overall verdict at the top (all green / N issues found).
- A table: Shop | Login | Dashboard | Core loop (POS) | Verdict (🟢/🟡/🔴).
- A "What worked" section in everyday language.
- A "What didn't" section: each issue described plainly (what you saw, why it matters,
  and the technical detail — URL/status/console line — so it's actionable). Rank by severity.
- If a previous day's report exists in that folder, add a short "Changes since last run"
  note (newly broken / newly fixed).

Keep it honest and specific. If everything worked, say so plainly — don't invent issues.
Do not edit any application code; this is a read-only health check that only writes its report.
