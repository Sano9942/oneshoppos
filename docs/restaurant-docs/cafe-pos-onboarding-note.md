# Cafe / Quick-Service POS — Operator Note (Launch v1)

> Source: W42 finding in `findings-WIP.md`. Filed during Phase 8.12c cafe-ops sweep on 2026-05-08. The cafe POS today is the same surface as restaurant POS — same Seat picker, same Course buttons (C1 Appetizer → C5 Drinks). For counter-service ops, that UI is shaped wrong but the workflow still rings sales correctly.

## What you'll see

When you log in as a cafe / quick-service merchant and open `/pos`, the page redirects to `/pos/restaurant`. You'll see:

- Top bar with three buttons: **New Takeaway**, **New Delivery**, **New Drive-Thru**, plus **Open Tab** (W18, post-2026-05-10).
- Below: any tables you've added (cafes typically don't add tables — leave that section empty).

Tapping **New Takeaway** opens a check view that has:

- A **Seat picker** (defaults to Seat 1).
- A row of **Course buttons** (C1 Appetizer / C2 Salad / C3 Entrée / C4 Dessert / C5 Drinks).
- A **search bar** above a (currently empty) tile grid.

## How to ring a sale

The Seat picker and Course buttons don't apply to counter-service. Ignore them — the defaults work fine. The supported flow is:

1. Tap **New Takeaway**.
2. **Type the product name into the search bar** (e.g. "espresso", "cappuccino"). Items appear in a dropdown — tap to add to the cart.
3. Repeat for each item. Cart on the right shows running total.
4. Tap **Pay** → choose payment method → complete sale. Receipt prints/emails as configured.

That's it. Don't touch the Seat or Course buttons. They don't break anything; they just don't do anything useful for counter service.

## What's still being built

Two known UX rough edges, tracked as `W42` and `W43` in `findings-WIP.md`:

- **W42** — the restaurant-shaped UI on the cafe POS landing. Post-launch we'll ship a `pos_layout_mode='counter'` preset that hides the Seat picker + Course buttons entirely.
- **W43** — the "Loading menu" tile-grid skeleton that briefly shows on first render. Already fixed (commit `064aa25` — 2026-05-10), shouldn't appear for tenants signed up after that date.

If the search bar workflow above isn't enough — e.g. you want named bar tabs ("John W. has 4 drinks pending") — use the **Open Tab** button next to Takeaway/Delivery/Drive-Thru. That's W18 (shipped 2026-05-10).

## Receipts + reports

Cafe sales land in the same `sales` table as restaurant sales. They show up correctly in:

- Z-Report
- Item-Wise Sales report
- Sales History
- FBR exports (when applicable)

The `industry_type='cafe'` field on your tenant is used to drive the dashboard widgets, sidebar labels (says "Customers" not "Guests"), and onboarding step list. It does NOT affect how sales are reported — they're regular sales.

## Known limitations until W42's full fix ships

1. The "Add tables in Settings → Restaurant Floor" empty-state message on the POS will be visible. Ignore it; counter-service doesn't need tables.
2. The Course buttons can't be hidden via UI flag yet. They're cosmetic noise.
3. Drive-Thru is shown as an entry point. It's harmless (just a tag on the sale's `order_context`), but most cafes won't have a drive-thru lane.

If a merchant complains about UX confusion, the answer is "use the search bar; ignore the rest". We've validated end-to-end that this rings sales correctly across all reports.
