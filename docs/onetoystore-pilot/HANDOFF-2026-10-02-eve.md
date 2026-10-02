We are continuing the One Toy Store go-live on PRODUCTION (sanopos.com, shop slug `onetoystore`, tenant id 134, schema `tenant_onetoystore`, Supabase project tpjewvfoqtskscmwjtjj). Branch `onetoystore-golive` (local). **origin/main = a8222767** (prod on migration **v152**). Local branch also holds the clock-in photo work (`f3761bfb`, migration **v153**, NOT live). Do not push unless I ask. `onetoystore` is the **only live shop** on prod (the 6 test shops are status deleted, schemas gone; checked 2026-10-02).

FIRST: confirm the Playwright MCP tools are connected (ToolSearch "playwright"; search again if slow; if missing, reconnect `plugin:playwright:playwright` with the ccd_connectors reconnect tool and end your turn). If "Browser is already in use", tell me (another tab holds it; I close it). Saved prod login = admin `hassan` (tab 0 sanopos.com). If it lands on Sign in, ask me. Never type my credentials. Claude may not create accounts or enter PINs on prod.

Then read:
- `docs/onetoystore-pilot/HANDOFF-2026-10-01-night.md` (method, test/run notes, deploy steps, rules).
- `docs/onetoystore-pilot/HANDOFF-2026-10-02-am.md` (deploy-by-cherry-pick, salary plan with every amount).
- `docs/onetoystore-pilot/PROGRESS.md` → the "▶ DAY 4" paragraphs at the top, and defect rows **D59–D63**.
- `docs/onetoystore-pilot/PHASE-F-PLAN.md` → R1–R9 (**R1 = 30 days**), fix order, **F5 and F9 in full**.

## Done in the 2026-10-02 afternoon tab (~14:30–16:45), all LOCAL, nothing pushed

| Fix | Local commit | Deploy-tree commit | What |
|---|---|---|---|
| D60 | `84e1804c` | `db7183ea` | Till search (server `routes/products.js` /search + offline `utils/offlineCatalogue.js` searchIndex): exact SKU/barcode/PLU → code starts-with → name → rest, A–Z inside, PLU now searched. Barcode/SKU/Price boxes hidden **while the top scan bar (phase2g_omni_input, "POS Power Features") is on** (owner chose this; no preset/Business Modules change) |
| D61 | `98550d8b` | `719cc938` | `POSHeader.jsx` one row, `whitespace-nowrap shrink-0`; Dashboard / Customer Display / Help / Lock / Logout / cashier name icon-only below 1536 px (`2xl:`), tooltip; money buttons always named |
| D63 (new, owner) | `7f8ae8e0` | `34b6f0a1` | Cursor always in the top scan bar: `useCart` addToCart/addDecodedLine focused the F2 box after every add → now `[data-pos-omni-input]` first; click on a non-typing spot / first key typed → back to the bar; 1 s backup; never steals from another input or while an overlay (`.fixed.inset-0`, role=dialog) is open. Name + Enter in the bar now runs the real search (`handleSearchChange`) |
| D62 | `84c08c29` | `54d43a45` | Instant add of a plain item found in the till's catalogue copy, server confirms in background (`confirmCopyLine` price/stock/notes, `undoCopyLine`); **plus** the restaurant add-ons check `GET /api/products/:id/modifier-tree` (refused at OTS on every add, phase4_restaurant off) now skipped unless phase4_restaurant (`pos/modifierLookup.js`) |

Docs commits: `b07cc6b8`, `4ec74d44`, + this hand-off. Tests: frontend unit 402/402 local; new tests `ots-search-order` (backend 5/5), `offline-catalogue`, `pos-search-variants`, `pos-header-one-row`, `pos-scan-focus`, `pos-instant-scan` — each failed first. Playwright local proof incl. a local sale of a corrected line (INV-2026-00029, 1,900, local shop `otsacc_mujsufsd` only). Screens `.playwright-mcp/d60-*.png d61-*.png d62-*.png d63-*.png`.

**Deploy tree READY:** worktree `D:\newprojects\ots-deploy-d60` = origin/main + the 4 fixes = **`54d43a45`**, junctions + `.env`/`.env.test` in place; on that tree frontend 393/393, related backend 59/59. No migration. Deploy = `git -C D:\newprojects\ots-deploy-d60 push origin 54d43a45:main` **with my OK, after Close Shift**, then Railway/Vercel/12 health checks/live screen; then cleanup: `cmd /c rmdir` the two node_modules junctions FIRST, then `git worktree remove ..\ots-deploy-d60`. If anything new gets committed to the golive branch for this deploy, cherry-pick it there and re-run tests.

Local state: backend-5004 / frontend-5177 running (preview_start names `backend-5004`, `frontend-5177`); local Owner clocked in today (local test PIN, local only); Playwright tab 1 = localhost:5177/pos. Lint ratchet still only the old POSReturnExchangeModal 27 vs 25.

Not asked yet / possible follow-up: while the receipt window is open after a sale, the cursor stays off the scan bar until the cashier closes it (pop-up guard) — ask the owner if a scan should close the receipt and start the next bill.

## NOW (one question at a time, my OK before every prod write)

1. **F9 — receive a supplier bill without a PO** (PHASE-F-PLAN F9; owner wants to start now, ~16:45). Method: grep every place first and tell me (purchase-orders receive → GRN → `supplier_invoices`, `OVER_RECEIPT`, supplier returns, supplier balance / `routes/grn.js`, supplier account work from `ots-supplier-account`, invoice-photo `/api/ai/invoice-extract`, R2 upload helpers) → propose the shape and ask me the open questions ONE at a time → failing test → build → related tests → local Playwright demo → local commits. Item picking should use the same search box as the till (D60 order) — F5 needs the same box, so build it reusable. Not deployed tonight.
2. **Salaries ~20:00, before Close Shift (shift 4)**, live Salaries page, month **September 2026**, one person at a time with my OK; recheck balances just before each. First **Paid in → From bank** (drawer ≈ 53,730 + today's cash sales; salaries need **299,290**). Cut / cash: Ishtiaq 0 / 36,500 · Mubashir 0 / 43,800 · Naeem 7,800 / 42,600 (15,000 loan carries) · Basharat 5,000 / 40,270 · Tahir 15,440 / 20,140 · Atiq 15,000 / 24,080 · Kelash 0 / 40,800 · Fahad 0 / 23,770 · Ramzan 22,750 / 9,330 · Usman 5,000 / 6,000 · **Aslam 30,000 / 12,000 (Owner / home)**. After: every account 0 except Naeem 15,000.
3. **Close:** Day report → count → Close Shift → Print day report → backup download → day-4 compare with iPOS (slip photo, Alfalah settlement, online transfers) → record in PROGRESS (R1: 4 of 30).
4. **After Close Shift, with my OK:** deploy D60–D63 from the ready tree (above). If late, tomorrow before opening. Counter Ctrl+Shift+R next morning; first scans then: watch for the price-correction note and that the cursor stays in the bar.
5. **3 Oct:** continue F9, then D59, F5, G1–G5, F6–F8. Photo at clock-in waits for a camera + kiosk-device decision. Not asked yet: owner/home labels + monthly "taken for home" total.

Still open, not fixed: D59; Sales History payment filter / Cash Audit only see the header method; Paid out / Paid in have no offline queue; a void doesn't take back loyalty points; "Last Receipt" doesn't show an exchange slip; resumed cart drops the staff choice; exchange on a staff bill not special-cased; lint baseline POSReturnExchangeModal 27 vs 25; batch3's 10 old sales/gift-card failures; known old failing tests as listed in the night hand-off.

Rules: plain English for me, one question at a time, my OK before any prod write or push, record in PROGRESS.md and commit locally as we go.
