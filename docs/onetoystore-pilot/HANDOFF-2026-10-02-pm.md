We are continuing the One Toy Store go-live on PRODUCTION (sanopos.com, shop slug `onetoystore`, tenant id 134, schema `tenant_onetoystore`, Supabase project tpjewvfoqtskscmwjtjj). Branch `onetoystore-golive` (local). **origin/main = a8222767** (prod on migration **v152**). Local branch also holds the clock-in photo work (`f3761bfb`, migration **v153**, NOT live). Do not push unless I ask.

**Deploy method (unchanged, read `HANDOFF-2026-10-02-am.md` top paragraph):** temporary worktree on `origin/main`, cherry-pick ONLY the new commits (never the photo commit / v153 block), junction node_modules, copy `backend/.env` + `.env.test`, run tests there, push `<sha>:main` with my OK. Cleanup: `cmd /c rmdir` the junctions FIRST, then `git worktree remove`. D60–D62 need **no migration**.

FIRST: confirm the Playwright MCP tools are connected (ToolSearch "playwright"; search again if slow; if missing, reconnect `plugin:playwright:playwright` with the ccd_connectors reconnect tool and end your turn). If "Browser is already in use", tell me. Saved prod login = admin `hassan` (tab 0 sanopos.com). If it lands on Sign in, ask me. Never type my credentials. Claude may not create accounts or enter PINs on prod.

Then read:
- `docs/onetoystore-pilot/HANDOFF-2026-10-01-night.md` (method, test/run notes, deploy steps, rules).
- `docs/onetoystore-pilot/HANDOFF-2026-10-02-am.md` (deploy-by-cherry-pick, salary plan with every amount).
- `docs/onetoystore-pilot/PROGRESS.md` → the three "▶ DAY 4" paragraphs at the top, and the defect list rows **D59, D60, D61, D62** + the "Product pictures on the till" idea.
- `docs/onetoystore-pilot/PHASE-F-PLAN.md` → R1–R9 (**R1 is now 30 days**), fix order, F5, F9.

## Done in the 2026-10-02 daytime session

1. Shift 4 opened 13:25, float 53,730 (= last night's count). Bills INV-00104…00108 (Cash 2,390 / Card 13,240). Counter did Ctrl+Shift+R only after I said so; PC clock ~3½ min fast.
2. **First real Day report** (check copy, ~13:55) = SQL exactly: should be in till 56,120.
3. Owner asks recorded: **D60** search order (exact SKU/barcode/PLU first, then starts-with, then name, then rest; same in the offline search `utils/offlineCatalogue.js`) **+ hide the Barcode / SKU / Price boxes** (`pages/redesign/pos/POSSearchArea.jsx:62-80`); **D61** top bar on the till wraps every button name onto two lines → one tidy row; **D62** top scan box: add instantly from the till's catalogue copy, server lookup in the background (out-of-stock note when it answers; correct the line price if the server's differs, because the server refuses a bill priced below current = `routes/sales.js` PRICE_MISMATCH). Code not in the copy → wait for the server as today. Pictures on the till: later, not now.
4. Facts found: server search = `routes/products.js:339-381` (`ORDER BY p.name LIMIT 50`, matches name/barcode/sku/price/description). Top box = `POSOmniInput.jsx` + `omniInputRouter.js` (all-digit codes of 4–5, 8, 12–14 digits go to `/api/products/scan/:code` exact lookup via `offlineLookup.js:scanProduct`; others become text search). Prod: 10,044 products, all have SKU, 0 have barcode or image. Scan round trip ~0.5 s, health alone ~0.4 s (network). `useCart.js:233-272` only *notes* out of stock (sells on override). Catalogue copy refreshes every 10 min (`useOfflineCatalogue.js`).
5. **R1 changed 7 → 30 days** (owner: no supplier entries yet, more edge cases needed). backup_log: 3 of 3 nights.

## NOW (one question at a time, my OK before every prod write)

1. **Build D60 → D61 → D62 locally**, each: grep → failing test → build → related tests → local Playwright demo (backend-5004 / frontend-5177, local shop `otsacc_mujsufsd`) → separate local commits. Show me all three ~18:00.
2. **Salaries ~20:00, before Close Shift (shift 4)**, on the live Salaries page, month **September 2026**, one person at a time with my OK; recheck balances just before each. First **Paid in → From bank** (drawer ≈ 53,730 + today's cash sales; salaries need **299,290**). Cut / cash: Ishtiaq 0 / 36,500 · Mubashir 0 / 43,800 · Naeem 7,800 / 42,600 (15,000 loan carries) · Basharat 5,000 / 40,270 · Tahir 15,440 / 20,140 · Atiq 15,000 / 24,080 · Kelash 0 / 40,800 · Fahad 0 / 23,770 · Ramzan 22,750 / 9,330 · Usman 5,000 / 6,000 · **Aslam 30,000 / 12,000 (Owner / home)**. After: every account 0 except Naeem 15,000.
3. **Close:** Day report → count → Close Shift → Print day report → backup download → day-4 compare with iPOS (slip photo, Alfalah settlement, online transfers) → record in PROGRESS (R1: 4 of 30).
4. **After Close Shift, with my OK:** deploy D60 + D61 + D62 (no migration; cherry-pick method). If late, deploy tomorrow before opening. Counter Ctrl+Shift+R next morning.
5. **3 Oct:** F9 (supplier bill without PO) first, then D59, F5, G1–G5, F6–F8. Photo at clock-in waits for a camera + the kiosk-device decision. Not asked yet: owner/home labels + monthly "taken for home" total.

Still open, not fixed: D59; Sales History payment filter / Cash Audit only see the header method; Paid out / Paid in have no offline queue; a void doesn't take back loyalty points; "Last Receipt" doesn't show an exchange slip; resumed cart drops the staff choice; exchange on a staff bill not special-cased; lint baseline POSReturnExchangeModal 27 vs 25; known old failing tests as listed in the night hand-off.

Rules: plain English for me, one question at a time, my OK before any prod write or push, record in PROGRESS.md and commit locally as we go.
