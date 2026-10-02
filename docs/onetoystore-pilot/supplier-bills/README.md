# Supplier bills (F9 samples)

The owner drops real supplier bills here (PDF, phone photo, scan, Excel, anything) so F9
"upload a bill and everything is handled" is built against real bills, not guesses.

- One file per bill. Name it `<supplier>_<bill-no-or-date>.<ext>` if you can (e.g. `mattel_2026-10-01.pdf`); any name is fine.
- A bill with several pages/photos: put them in a sub-folder named after the bill.
- The files are git-ignored (`.gitignore` here): they stay on this PC and are never pushed.

## Which supplier each sample is from (owner, 2026-10-02)

- `BABY LAND …`, `BILL#4749x …`, `BILL#62695 …` = BABY LAND LAHORE ("Sales Estimate")
- `HASSAAN SB ONE SHOP INV-226xx` = TOYS AND TOYS LAHORE (no supplier name in the text; logo picture only)
- `01-ONE SHOP PACKAGES …`, `ONE SHOP PKG MALL M100 BILL` = HAFIZ NAWAZ (no supplier name printed)
- `whatsapp-2026-10-02/` 4.00.51 + 4.01.07 = A TO Z CONSUMERS (printed, 2 pages); 4.01.22, 4.01.28, 4.01.35 = handwritten cash memos
