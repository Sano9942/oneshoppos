# ESC/POS Thermal Printer Integration — Design Doc

**Date:** 2026-03-06
**Status:** Approved

---

## Context

OneShopPOS currently prints receipts via `buildReceiptHtml()` in `frontend/src/utils/receipt.js`, which opens a browser popup and calls `window.print()`. This triggers a browser print dialog on every sale — the cashier must click OK each time. There is no cash drawer integration, no true ESC/POS formatting, and no hardware printer support.

This design adds a backend print API (`POST /api/print/receipt`) that silently sends ESC/POS commands directly to a thermal printer (USB or TCP/WiFi). The browser popup is retained as a fallback when the printer is offline or not configured.

A barcode scanner input is also added to POS — pure frontend, no backend changes needed.

---

## Architecture

```
Frontend (React)              Backend (Node.js)            Printer
─────────────────             ─────────────────            ───────
printSlip(slip)
  │
  ├─► printToHardware()  ──►  POST /api/print/receipt
  │     (new, receipt.js)       { slip, template }
  │                                    │
  │                             PrinterService
  │                               ├─ load printer_config from DB
  │                               ├─ format ESC/POS (paper_width aware)
  │                               ├─ send to USB or TCP
  │                               └─ kick cash drawer (if enabled)
  │                                    │
  │                             200 OK  or  { error, fallback: true }
  │                                    │
  └─► buildReceiptHtml()  ◄───── fallback: true
        (existing, kept)
```

**Key principle:** If the printer is offline, not configured, or errors — the system silently falls back to the browser popup. The cashier never gets a hard failure.

---

## New Files

### `backend/services/printer.js`
PrinterService class:
- Loads `printer_config` from DB on each print (picks up config changes without restart)
- Supports `connection_type: 'usb'` and `connection_type: 'network'` (TCP)
- Formats receipt using ESC/POS commands, all line widths derived from `paper_width`
- Kicks cash drawer via ESC/POS pulse command (if `cash_drawer = 1`)
- Exports `printReceipt(slip, template)` and `printerStatus()`

### `backend/routes/printer.js`
- `POST /api/print/receipt` — receives `{ slip, template }`, calls PrinterService, returns `200` or `{ error, fallback: true }`
- `GET /api/print/status` — returns printer reachability (used by Test Print button in settings)

### `backend/migrate64.js`
New migration — creates `printer_config` table.

---

## Modified Files

| File | Change |
|---|---|
| `backend/routes/registerAllRoutes.js` | Register `/api/print` route |
| `frontend/src/utils/receipt.js` | Add `printToHardware(slip, template)` — calls `/api/print/receipt`, returns `{ fallback }` |
| `frontend/src/pages/redesign/pos/POSContext.jsx` | `printSlip` calls `printToHardware` first; only fires `buildReceiptHtml` if `fallback: true` or hardware disabled |

---

## Database Schema

```sql
-- migrate64.js
CREATE TABLE IF NOT EXISTS printer_config (
  id                INTEGER PRIMARY KEY,
  connection_type   TEXT    DEFAULT 'network',      -- 'usb' | 'network'
  host              TEXT    DEFAULT '192.168.1.100', -- TCP/WiFi IP address
  port              INTEGER DEFAULT 9100,            -- Standard ESC/POS TCP port
  usb_vendor_id     TEXT,                            -- e.g. '0x04b8' (Epson)
  usb_product_id    TEXT,                            -- e.g. '0x0202'
  paper_width       INTEGER DEFAULT 48,              -- chars per line
  cash_drawer       INTEGER DEFAULT 1,               -- 1 = kick drawer on sale
  is_active         INTEGER DEFAULT 1
);
-- Seed one default row so settings page always has something to show
INSERT OR IGNORE INTO printer_config (id) VALUES (1);
```

---

## Paper Width Options

| Label | chars/line | Physical Size |
|---|---|---|
| 80mm (standard) | 48 | Epson TM-T82, TVS RP45, most common |
| 76mm | 42 | Older dot-matrix hybrids |
| 58mm (mini) | 32 | Portable/pocket printers |
| 57mm (narrow) | 30 | Tiny mobile printers |
| Custom | any | Admin enters exact char count |

All receipt lines, dividers, centering, and item truncation auto-scale to `paper_width`. Admin sets this once in Printer Settings — cashier never touches it.

---

## Receipt Format (80mm / 48 chars example)

```
================================================
           STORE NAME HERE
================================================
Date: 06/03/2026        Time: 14:32
Invoice: INV-2026-00042
Cashier: Ahmed
Customer: Ali Hassan
------------------------------------------------
2x  Product Name A               $20.00
1x  Product Name B               $15.00
------------------------------------------------
Subtotal:                        $35.00
Tax (GST):                        $3.50
Discount:                        -$2.00
================================================
TOTAL:                           $36.50
================================================
Cash:                            $40.00
Change:                           $3.50
------------------------------------------------
        [BARCODE: INV-2026-00042]
        (if show_barcode = 1)
------------------------------------------------
        Thank you for shopping!
================================================
```

Same receipt at 58mm (32 chars) auto-compresses all columns proportionally.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `printer_config.is_active = 0` | Skip hardware print, browser popup fires |
| Printer offline / TCP timeout | Backend returns `{ error, fallback: true }`, browser popup fires |
| USB device not found | Same fallback |
| Print succeeds | `{ ok: true }` — browser popup suppressed |
| `GET /api/print/status` | Returns `{ reachable: true/false, error? }` for Test Print button |

---

## Printer Settings UI

New **"Printer"** tab added to Settings (existing settings page or standalone):

- **Connection Type** — Radio: Network (TCP) / USB
- **IP Address** — text input (shown when Network selected)
- **Port** — number input, default 9100
- **USB Vendor ID** — text input (shown when USB selected)
- **USB Product ID** — text input
- **Paper Size** — dropdown: 80mm / 76mm / 58mm / 57mm / Custom
- **Custom Width** — number input (shown when Custom selected)
- **Kick Cash Drawer on Sale** — toggle
- **Test Print** button — calls `GET /api/print/status` then `POST /api/print/receipt` with dummy slip; shows "Printer OK ✓" or exact error

---

## Barcode Scanner Input (POS)

Pure frontend addition — no backend changes needed. The products API already supports `GET /api/products?barcode=xxx`.

- Dedicated hidden input in POS that captures focus when no modal is open
- Detects rapid keystrokes (scanner types ~50ms between chars) vs normal keyboard
- On Enter: calls `GET /api/products?barcode={value}`, adds matching product to cart
- If no match: shows inline toast "Barcode not found"
- Works alongside manual product search — both active at same time

---

## npm Package

```
backend: npm install node-thermal-printer
```

No frontend packages needed.

---

## Verification Plan

1. **Unit test** `PrinterService` with a mock TCP socket — verify ESC/POS bytes sent for a known slip
2. **Integration test** `POST /api/print/receipt` returns `{ fallback: true }` when no printer configured
3. **Manual test** (when hardware available): USB print, TCP print, cash drawer kick, 80mm vs 58mm paper
4. **Fallback test**: disable printer config → confirm browser popup fires normally
5. **Barcode scanner test**: simulate rapid input → confirm product added to cart
