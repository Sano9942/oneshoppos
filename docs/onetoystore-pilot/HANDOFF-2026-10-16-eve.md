We are continuing the One Toy Store go-live in D:\newprojects\oneshoppos (branch `onetoystore-golive`, LOCAL only). Production: sanopos.com, shop slug `onetoystore`, tenant id 134, schema `tenant_onetoystore`, Supabase project tpjewvfoqtskscmwjtjj. **origin/main = 54d43a45, prod on migration v152, nothing deployed since 2 Oct.** Do not push, deploy or write to production without my OK.

FIRST: confirm the Playwright MCP tools are connected (ToolSearch "playwright"; if missing, reconnect `plugin:playwright:playwright` with the ccd_connectors reconnect tool and end your turn). Never type my production credentials or PINs; Claude may not create accounts on prod.

Then read, in this order:
- `docs/onetoystore-pilot/HANDOFF-2026-10-16.md` (the morning hand-off: shop situation, stock catch-up tool, F5 + D65, F9 (e), the work order and my rules). Its item 1 (day report slip) did NOT happen: I have not printed the slip yet. F4 (day slip) is already live; I will print it at my next close.
- `docs/onetoystore-pilot/HANDOFF-2026-10-01-night.md` → "Test and run notes", "Method for every fix", "Deploying".
- `docs/onetoystore-pilot/PROGRESS.md` → top paragraph "▶ F9 step (f) …" (everything done this evening).
- `docs/onetoystore-pilot/PHASE-F-PLAN.md` → F9 section, the four "Step (f) n/6" bullets at its end (every ✅ line there is my decision).

## What we did on 16 Oct evening (previous tab): F9 step (f), all LOCAL, committed, not deployed

1. `fd2481a4` **Same bill number twice**: same supplier + same bill number → warning on the check screen showing the earlier bill(s); Save asks "It's a different bill, save it" / "Don't save"; server 409 `SAME_BILL_NUMBER` without `same_number_ok`. The very same FILE stays refused (built earlier).
2. `ec0d8055` **Drafts** (migration **v155** `supplier_bills.draft_state`, local DB migrated): "Save as draft" keeps the check screen + files, changes nothing; Drafts list (who started it) with Open / Throw away; Save bill finishes the same bill.
3. `6be92306` **Undo the whole bill** the same shop day, only while none of its toys has gone out since: "Bills saved today" list on Receive supplier bill with Undo + "Why?". Puts back stock, cost, price, supplier account, delivery note, waiting extras, codes learned, new toys (removed, code + barcode freed); files can be uploaded again. ✅ My decision: money paid on the spot stays on the supplier's account as a payment on account.
4. `67d5dccf` **Supplier bills list**: new page Procurement → Supplier bills (`/supplier-bills`) + "Bills" button on each Suppliers row; filters; Open shows files (links work locally), lines with our toys, account entries.

Tests at the end: supplier-bill backend 199/199 (with readers, pg-master-db, product history, permissions catalog); frontend 503/505 in the full parallel run (`exchange-discount` and `f5-find-toy-by-code` time out only when the PC is busy, pass alone); lint only the known POSReturnExchangeModal 27 vs 25. Local servers used: backend-5002 + frontend-5175 (.claude/launch.json), local shop `otsacc_mujsufsd` (sign-in: PROGRESS "DAY 3", local only). Local backend takes about a minute to start. Local trial bill "UNDO-TRIAL" (Hafiz Nawaz) is undone on purpose.

## NOW, in this order

1. **Corrections after saving** (F9 (f) 5/6). The last open question for me was: Claude suggests four kinds of correction on a saved bill, each with a note: (a) pieces received changed (stock ±, Not received money ±, extra pieces list ±), (b) wrong toy (pieces moved from one toy to another, cost follows), (c) wrong rate (cost per piece + supplier account ±), (d) money only (± on the supplier's account). Every change goes in as a correction line (History shows the mistake and the fix; supplier account entry kind "correction"); probably a new table for the bill's corrections (migration v156). Opened from Supplier bills → Open. **Ask me this question first (one question, with your suggestion), then build.**
2. F9 (f) 6/6: "waiting for supplier's bill" matching (extra pieces kept, matched when the supplier's next bill comes; stock not added twice).
3. When I've added `ANTHROPIC_API_KEY` to `backend/.env`: real-photo trial of F9 (e) with the 5 photos in `docs/onetoystore-pilot/supplier-bills/whatsapp-2026-10-02/` (I OK'd ~Rs 55–100).
4. Then D64 (bill numbers by date), D59, G1–G5, F6–F8, Shopify step 1.
5. Shop side, whenever I bring it up: the iPOS "Present Stock Position by Supplier" export → stock catch-up (morning hand-off), closing shift 5 and opening a new shift, nightly compare + Download Backup, F5 + D65 deploy plan (after closing, cherry-pick, show me the plan first). F9 is deployed later, all at once, with migrations v153–v155.

Rules: plain English for me, one question at a time with your suggestion, my OK before any prod write, deploy or push, deploy only before opening / after close, record in PROGRESS.md / PHASE-F-PLAN.md and commit locally as we go.
