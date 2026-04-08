# Email Receipts — Design Document

**Date:** 2026-03-06
**Status:** Approved
**Trigger:** On-demand from POS Recent Sales panel or Receipt Modal

---

## Summary

Send HTML email receipts to customers via SMTP (nodemailer). The shop owner configures SMTP credentials once in Settings. Cashiers trigger sends on-demand from existing POS UI surfaces, with the customer email pre-filled and editable.

---

## Architecture

Follows the same pattern as the ESC/POS printer feature:

- `backend/migrate65.js` — adds `email_config` table (single-row, same pattern as `printer_config`)
- `backend/routes/email.js` — owns `/api/email/send-receipt` and `/api/email/config` CRUD
- `frontend/src/utils/receipt.js` — gets `buildReceiptEmailHtml(slip, template)` export (email-safe HTML, inline styles, no scripts)
- Registered in `backend/routes/registerAllRoutes.js`

---

## Database — `email_config`

Single row (id=1), seeded by migration:

| Column        | Type    | Default          | Notes                        |
|---------------|---------|------------------|------------------------------|
| `id`          | INTEGER | 1                | Primary key                  |
| `smtp_host`   | TEXT    | `smtp.gmail.com` |                              |
| `smtp_port`   | INTEGER | 587              | 587 = STARTTLS, 465 = SSL    |
| `smtp_user`   | TEXT    | null             | Gmail address / SMTP user    |
| `smtp_pass`   | TEXT    | null             | App password (not login pwd) |
| `from_name`   | TEXT    | `OneShopPOS`     | Display name in From field   |
| `enabled`     | INTEGER | 0                | 0 = disabled, 1 = enabled    |

---

## Backend Routes — `backend/routes/email.js`

### `GET /api/email/config`
Returns current email_config row. `smtp_pass` returned as `"*****"` if set (never expose).

### `PUT /api/email/config`
Updates email_config. Accepts: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `from_name`, `enabled`.

### `POST /api/email/test`
Sends a test email to `smtp_user` to verify the config works.

### `POST /api/email/send-receipt`
Body: `{ saleId, toEmail }`

1. Validate `toEmail` format
2. Check `email_config.enabled` — return 503 if not configured
3. Fetch sale record + items + payments from DB (same join as sales history)
4. Fetch active receipt template from `receipt_templates`
5. Build slip object, call `buildReceiptEmailHtml(slip, template)`
6. Send via nodemailer using stored SMTP config
7. Return 200 on success, error message on failure

**Auth:** Requires valid session (same as all other routes).

---

## Receipt HTML for Email

New export in `frontend/src/utils/receipt.js`:

```js
export function buildReceiptEmailHtml(slip, template) { ... }
```

- Calls `buildReceiptSections(slip, template)` for data
- Produces self-contained HTML string: inline CSS, table-based layout (email-client safe)
- No `<script>`, no `window.print()`, no external assets
- Matches receipt template: `storeName`, `footerText`, `showBarcode` (barcode rendered as text, not image)

**Note:** The backend also needs this function. Options:
- Duplicate a server-side version in `backend/utils/receiptEmail.js` (simple, no frontend/backend coupling)
- This is the chosen approach — keep backend self-contained

---

## Data Flow

```
POSRecentSalesPanel / POSReceiptModal
  → "Email Receipt" button
  → EmailReceiptModal opens
      - toEmail: pre-filled from sale.customer.email (editable)
      - Send button
  → POST /api/email/send-receipt { saleId, toEmail }
  → backend: fetch sale → build HTML → nodemailer.sendMail()
  → 200 → "Email sent!" toast
  → 4xx/5xx → error message in modal
```

---

## Frontend Changes

### New component: `POSEmailReceiptModal.jsx`
Located in `frontend/src/pages/redesign/pos/`

- Small modal: email input (pre-filled, editable), Send button, loading/error state
- Props: `saleId`, `customerEmail`, `onClose`

### `POSRecentSalesPanel.jsx`
- Add "Email" icon button per sale row (alongside existing Reprint button)
- Opens `POSEmailReceiptModal` with that sale's id and customer email

### `POSReceiptModal.jsx`
- Add "Email Receipt" secondary button
- Opens `POSEmailReceiptModal`

### Settings — Email tab
New tab in Printer Settings page (or standalone Email Settings page):
- SMTP host, port, user, password (masked), from name, enabled toggle
- "Send Test Email" button → `POST /api/email/test`

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Email not configured / disabled | 503 — "Email not configured. Go to Settings → Email." |
| Invalid email format | 400 — frontend validation before POST |
| SMTP authentication failure | 500 — "SMTP authentication failed. Check your credentials." |
| Sale not found | 404 |
| Missing `toEmail` | 400 |

---

## Dependencies

- **nodemailer** — install in `backend/`: `npm install nodemailer`
- No frontend dependencies needed

---

## Out of Scope

- Automatic send at checkout (on-demand only)
- Email queue / retry on failure
- Email log / audit trail
- PDF attachments
- Multiple SMTP profiles
