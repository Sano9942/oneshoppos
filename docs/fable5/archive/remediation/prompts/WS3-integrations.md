# WS3 — Integrations connectivity `P2`

**Model:** Sonnet. **Branch:** `fix/ws3-integrations` off `main`.

## Context
From `docs/fable5/archive/core-research/02-INTEGRATIONS.md`. Payment/FBR/email/SMS/aggregators are solid; the
marketplace + courier layers hide connectivity rot — no-op webhooks, silent failures, plaintext creds.

## Verify first
Confirm each anchor on `main @ v126`. For credential encryption, read `services/crypto.js` (AES-256-GCM,
`enc:v1:{iv}:{tag}:{ciphertext}`) — Shopify/marketplace already use it; courier + WooCommerce don't.

## Task
- **Security (C2):**
  - Encrypt courier creds — `couriers.js:106-115` store with `encryptSecret`, `getAdapter` (`:159-163`)
    decrypt before passing to adapters. Same for WooCommerce (`woocommerce.js:74-79`). Migrate existing
    plaintext rows (encrypt-on-read-then-write or a one-time migration).
  - Parse courier `config_json` — `couriers.js:162,293,414,467` pass raw TEXT; adapters read
    `this.config.config_json?.field` → `undefined` (TCS `cost_center`, PostEx codes, DHL/FedEx
    `account_number`). Parse the jsonb on read.
- **Real inbound (B4):**
  - Daraz webhook `webhooks.js:567-579` + Meta webhook `:502-511` — resolve tenant, write `web_orders`,
    (Daraz) call through. Mirror the xPay webhook's tenant-resolution pattern (`:221`).
  - WhatsApp inbox `:527-556` — uses `require("../db-pg")` (public pool, no search_path) → every insert
    into tenant `messaging_threads`/`messages` fails and is swallowed (`:553`). Resolve tenant + use the
    tenant-scoped db.
- **FBR alerting (C5):** `fbr-worker-boss.js:109-134` — on invalid-token `failed`, add
  `alerting.recordError` + dead-letter/notification instead of silent return. Compounds the (now-fixed
  by WS2d) hidden dashboard.
- **Doc drift:** update `workers/CLAUDE.md` + `services/marketplace/CLAUDE.md` (worker schedules no
  crons now) and `services/CLAUDE.md` (courier "pre-decrypted in route layer" claim — make it true).

## Verify the fix
- Integration tests from `backend/` cwd; diff vs baseline.
- Round-trip a courier credential (encrypt → store → decrypt → adapter sees plaintext).
- Post a fake Daraz/Meta/WhatsApp webhook payload → row lands in the correct tenant schema.

## Commit & push (REQUIRED)
Commit per area, push `fix/ws3-integrations`. No PR. Co-Authored-By trailer.
