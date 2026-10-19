# Deploy plan: F5 + D65 + F9 (a–f) to the live shop

Written 2026-10-19. **✅ DEPLOYED 14:26 PKT the same day (`f6a290d6`, prod v156); see PROGRESS top.** **Decided (owner): photo reading OFF at deploy.** Done: step 1 (`91c7f3f3` renumber, photo switch commit after it).

## What is live vs. what goes

Live (origin/main `54d43a45`, prod migration **v152**): everything up to D60–D63.

Goes in this deploy (from branch `onetoystore-golive`):

| Item | Commits | Migration |
|---|---|---|
| F9 (a) supplier bill data | `f39fe69b` | v154 |
| F9 (b) PDF bill reader | `79a4bc36` (adds backend package `pdfjs-dist`) | — |
| F9 (c) check screen + save | `23194985`, `d002b7fb` | — |
| F9 (d) new toys + ride-ons | `866bffa2`, `af88892c` | — |
| F9 (e) photo/scan reader | `0d2b6c03` | — |
| F9 (f) 1–6 | `fd2481a4`, `ec0d8055`, `6be92306`, `67d5dccf`, `292ee045`, `74696240` | v155, v156 |
| D65 dashboard money paid | `bbce0e8a` | — |
| F5 find toy by code | `2884cba0` | — |
| iPOS catch-up tool (tools/ only) | `1b1666d8` | — |
| docs | the `docs(...)` commits | — |

**Stays behind on purpose:** clock-in photo (`f3761bfb` + `ccb76127`, migration v153). Camera/kiosk device not chosen, no staff PINs.

Already on main under other hashes, so skipped: `e793034c`, `bd739b17`, `d0a95ccf`, `84e1804c`, `98550d8b`, `7f8ae8e0`, `84c08c29`.

All three migrations are additive: new tables, plus `goods_received_notes.supplier_id` / `supplier_bill_id` and `supplier_bills.draft_state`. Nothing is dropped or rewritten, so the old code still runs on the new schema.

## Migration-number trap

The runner applies only versions **above** the current one (`migrate-pg.js` `m.version > currentVersion`). If prod goes v152 → v156 and skips v153, the clock-in photo's v153 would **never run** when it deploys later. Fix on the branch first: renumber the clock-in photo migration **v153 → v157** (in both `migrate-pg.js` and the comment in `schema-pg.sql`). The F9 numbers (v154–v156) stay as they are. Check that the photo DDL is `IF NOT EXISTS` so local DBs, which already ran it as v153, can safely run it again as v157.

## Decision needed before deploy

**Photo reading (F9 e) would switch on in the live shop by itself.** Railway already has `ANTHROPIC_API_KEY`, and the route turns the AI reader on whenever that key exists. It has only run against fakes, never a real photo, and each read costs real money. Options:
- (a) ✅ **Chosen.** Off by default: photo reading runs only with `SUPPLIER_BILL_PHOTO_READER=1` **and** an AI key (`photoReaderOn` in `services/bill-readers/photo-reader.js`). No Railway change needed to keep it off. For the local trial put both in `backend/.env`; after the trial, set `SUPPLIER_BILL_PHOTO_READER=1` on Railway.
- (b) Deploy with it on, and make the first real photo trial in the live shop.

PDF bills (Hafiz Nawaz, Baby Land, Toys and Toys) don't use the AI either way.

## Steps

1. **On the branch:** renumber clock-in photo v153 → v157 and commit. If (a) is chosen, add the photo-reader switch with a test that fails first.
2. **Deploy tree:** `git worktree` from `origin/main`. Cherry-pick the "goes" commits in order and skip the photo commits. Expect conflicts in `migrate-pg.js` / `schema-pg.sql` next to the v153 block; keep F9 and drop the photo parts. Then check that `git diff <deploy-tree> onetoystore-golive` shows only clock-in photo files and the v157 block.
3. **Tests in the deploy tree** (node_modules junctions; remove them with `rmdir` before `git worktree remove`):
   - backend: all `ots-supplier-bills-*`, `supplier-bill-reader`, `f5-find-toy-by-code`, `ots-product-history`, `ots-offline-catalogue`, D65 dashboard tests, `ots-supplier-account` (it fails between 00:00 and 05:00 PKT, a known issue);
   - frontend unit (all) + lint ratchet (only the known POSReturnExchangeModal) + `vite build`;
   - migrate a scratch local DB at v152 (made from origin/main) up to v156 and check that every tenant reaches v156.
4. **Timing:** after the shop closes (Railway is slow for about 5 minutes after a deploy, see D53). Read-only SQL first: 0 open shifts, last bill time, DB size (was 275 / 500 MB).
5. **Backup first** (Free plan, no Supabase backups): owner does Download Backup, and Claude runs `pg_dump -Fc` of `public` + `tenant_onetoystore` over the pooler **session port 5432**.
6. **Push:** fast-forward `main` to the deploy-tree commit. Push **only with the owner's OK**. Then watch Railway until SUCCESS, check that `start.sh` migrations took every tenant to **v156** (do not pipe the output through `Select-Object`), run 10 fast health checks, and confirm Vercel READY for the sha.
7. **Live checks:** read-only, plus the owner's logged-in tab, saving nothing:
   - Procurement → Receive supplier bill opens; read one real PDF and confirm line count and total equal the paper, then leave without saving;
   - dashboard Revenue Today = SQL of money paid today;
   - Stock Adjustments: find a toy by code and see In stock (don't save);
   - Supplier bills list opens and is empty.
8. **Next morning at the counter:** Ctrl+Shift+R once before the first sale.

## Rollback

Redeploy the previous Railway deployment and roll Vercel back to the previous production deployment. The new tables and columns can stay, because the old code ignores them.

## Status 2026-10-19 afternoon (steps 1–3 done; nothing pushed)

- Branch: `91c7f3f3` clock-in photo → v157; `35abc921` + `5add30a9` photo reading off unless `SUPPLIER_BILL_PHOTO_READER=1` (5 tests failed first).
- Deploy tree `D:\newprojects\oneshoppos-deploy`, branch **`deploy-2026-10-19`** = origin/main `54d43a45` + F5, D65, F9 (a–f), catch-up tool, docs and the switch. One expected conflict in migrate-pg / schema-pg, resolved by dropping the photo parts. `git diff deploy-2026-10-19 onetoystore-golive` = exactly the 13 clock-in photo files.
- Upgrade check: a throwaway schema built from origin/main schema-pg.sql at v152 → migrate → **154, 155, 156**, all 9 F9 tables plus the 2 GRN columns, no `attendance_presses`; a second run is a no-op.
- Backend 21 files, **333/333** (the one first failure was my wording change, fixed in `5add30a9`). Frontend unit **544/544** (`f5-find-toy-by-code` timed out once at 5.25 s while everything else ran, then 7/7 alone; the 55 "failed" files are Playwright/smoke specs Vitest can't load). Lint ratchet: only the known POSReturnExchangeModal. `vite build` OK.
- **Left:** steps 4–8 tonight after closing, with the owner's OK to push (fast-forward main to `deploy-2026-10-19`). Remove the deploy tree afterwards (`rmdir` the 3 node_modules junctions first).
