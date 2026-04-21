/**
 * Phase 2-G Wave 2 — 2-G.2 gift cards as first-class tender.
 *
 * Admin + POS endpoints (public balance check lives in
 * routes/gift-cards-public.js so it can mount before tenant
 * middleware).
 *
 *   GET  /api/gift-cards                      — admin list + filters
 *   POST /api/gift-cards                      — create digital (auto-generates code)
 *                                                or register physical card by range
 *   POST /api/gift-cards/ranges               — register a pre-printed range
 *   GET  /api/gift-cards/ranges               — list ranges
 *   POST /api/gift-cards/:code/activate       — flip pre_printed → active
 *   GET  /api/gift-cards/:code/balance        — authenticated balance lookup
 *                                                (the public-no-auth counterpart
 *                                                lives in gift-cards-public.js)
 *   POST /api/gift-cards/:code/redeem         — POS tender; transactional,
 *                                                writes ledger debit, flips to
 *                                                depleted when remaining hits 0.
 *
 * All routes gated by requireFeature("phase2g_gift_cards") +
 * requireAnyPerm(["manage_gift_cards", "all_access"]).
 *
 * The permission `manage_gift_cards` is new in Wave 2 — Admin +
 * Manager get it by default via middleware/permissions.js.
 */
const crypto = require("crypto");

function generateCode() {
  // 12-char uppercase alphanumeric. 2^60 entropy — plenty for a
  // per-tenant scoped uniqueness check. Collision retry handled in
  // the caller (tiny chance, extremely tiny in practice).
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

module.exports = function registerGiftCardRoutes(app, deps) {
  const { db, requireAnyPerm, requireFeature } = deps;
  const guard = [
    requireFeature("phase2g_gift_cards"),
    requireAnyPerm(["manage_gift_cards", "all_access"]),
  ];

  // GET /api/gift-cards — admin list, filterable by card_type + activation_status.
  app.get("/api/gift-cards", ...guard, async (req, res) => {
    try {
      const { card_type, activation_status } = req.query;
      const where = [];
      const params = [];
      if (card_type) {
        params.push(String(card_type));
        where.push(`card_type = $${params.length}`);
      }
      if (activation_status) {
        params.push(String(activation_status));
        where.push(`activation_status = $${params.length}`);
      }
      const { rows } = await db.query(
        `SELECT id, code, card_type, activation_status,
                initial_value::numeric AS initial_value,
                remaining_value::numeric AS remaining_value,
                issued_to_customer_id, issued_to_email, issued_from_sale_id,
                created_at
           FROM gift_cards
           ${where.length ? "WHERE " + where.join(" AND ") : ""}
           ORDER BY created_at DESC
           LIMIT 500`,
        params,
      );
      res.json({
        gift_cards: rows.map((r) => ({
          ...r,
          initial_value: Number(r.initial_value),
          remaining_value: Number(r.remaining_value),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/gift-cards — create a new gift card.
  // Body: { card_type: 'digital'|'physical', initial_value, issued_to_email?, issued_to_customer_id? }
  // Physical cards are typically created via range-activation instead,
  // but this endpoint accepts a direct physical create for admin
  // correction flows (a single pre-numbered card).
  app.post("/api/gift-cards", ...guard, async (req, res) => {
    try {
      const cardType = String(req.body?.card_type || "digital");
      const initialValue = Number(req.body?.initial_value);
      const issuedToEmail = req.body?.issued_to_email
        ? String(req.body.issued_to_email).trim()
        : null;
      const issuedToCustomerId = req.body?.issued_to_customer_id
        ? Number(req.body.issued_to_customer_id)
        : null;
      if (!["digital", "physical"].includes(cardType)) {
        return res.status(400).json({ error: "card_type must be 'digital' or 'physical'" });
      }
      if (!Number.isFinite(initialValue) || initialValue <= 0) {
        return res.status(400).json({ error: "initial_value must be > 0" });
      }

      // Up to 3 collision retries (practically zero).
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = generateCode();
        try {
          const { rows: [row] } = await db.query(
            `INSERT INTO gift_cards
               (code, initial_value, remaining_value, card_type,
                activation_status, issued_to_email, issued_to_customer_id)
             VALUES ($1, $2, $2, $3, 'active', $4, $5)
             RETURNING id, code, card_type, activation_status,
                       initial_value::numeric AS initial_value,
                       remaining_value::numeric AS remaining_value`,
            [code, initialValue, cardType, issuedToEmail, issuedToCustomerId],
          );

          // Credit ledger row so the audit trail starts with the issue.
          await db.query(
            `INSERT INTO gift_card_transactions
               (gift_card_id, type, amount, reference_type, reference_id, note)
             VALUES ($1, 'credit', $2, 'issue', NULL, 'Initial issue')`,
            [row.id, initialValue],
          );

          return res.json({
            ...row,
            initial_value: Number(row.initial_value),
            remaining_value: Number(row.remaining_value),
          });
        } catch (err) {
          // Code collision on the unique index — retry with a fresh code.
          if (String(err.message || "").includes("duplicate key") && attempt < 2) continue;
          throw err;
        }
      }
      // We should never hit this with 3 retries at 2^60 entropy.
      res.status(500).json({ error: "Could not generate unique gift card code" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/gift-cards/ranges — register a pre-printed card range.
  // Body: { prefix, range_start, range_end, face_value, notes? }
  app.post("/api/gift-cards/ranges", ...guard, async (req, res) => {
    try {
      const prefix = String(req.body?.prefix || "").trim();
      const rangeStart = Number(req.body?.range_start);
      const rangeEnd = Number(req.body?.range_end);
      const faceValue = Number(req.body?.face_value);
      const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;
      if (!prefix) return res.status(400).json({ error: "prefix is required" });
      if (
        !Number.isInteger(rangeStart) ||
        !Number.isInteger(rangeEnd) ||
        rangeEnd < rangeStart
      ) {
        return res
          .status(400)
          .json({ error: "range_start/range_end must be integers with end >= start" });
      }
      if (!Number.isFinite(faceValue) || faceValue <= 0) {
        return res.status(400).json({ error: "face_value must be > 0" });
      }

      const employeeId = Number(req.employee?.id) || null;
      const { rows: [row] } = await db.query(
        `INSERT INTO gift_card_ranges
           (prefix, range_start, range_end, face_value, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [prefix, rangeStart, rangeEnd, faceValue, notes, employeeId],
      );
      res.json({ id: row.id, count: rangeEnd - rangeStart + 1 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/gift-cards/ranges — list ranges.
  app.get("/api/gift-cards/ranges", ...guard, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, prefix, range_start, range_end,
                face_value::numeric AS face_value,
                notes, created_by, created_at
           FROM gift_card_ranges
          ORDER BY created_at DESC`,
      );
      res.json({
        ranges: rows.map((r) => ({ ...r, face_value: Number(r.face_value) })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/gift-cards/:code/activate — flip a pre-printed physical
  // card to active. If no row exists yet for the code (the common case
  // for a range-registered batch), this creates one from the matching
  // range. Idempotent on already-active cards.
  app.post("/api/gift-cards/:code/activate", ...guard, async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      if (!code) return res.status(400).json({ error: "code is required" });

      const result = await db.transaction(async (client) => {
        // Is the card already in the table?
        const { rows: [existing] } = await client.query(
          `SELECT id, activation_status, remaining_value::numeric AS remaining_value
             FROM gift_cards WHERE code = $1 FOR UPDATE`,
          [code],
        );
        if (existing) {
          if (existing.activation_status === "active") {
            return { code, activation_status: "active", already: true };
          }
          if (existing.activation_status === "depleted") {
            throw Object.assign(new Error("Gift card is depleted"), {
              statusCode: 400,
            });
          }
          await client.query(
            `UPDATE gift_cards SET activation_status = 'active' WHERE id = $1`,
            [existing.id],
          );
          return { code, activation_status: "active" };
        }

        // Not seeded yet. Match against any registered range whose
        // prefix+number window fits this code.
        const match = code.match(/^([A-Za-z]+)(\d+)$/);
        if (!match) {
          throw Object.assign(new Error("Gift card not found"), {
            statusCode: 404,
          });
        }
        const [, prefix, numStr] = match;
        const num = Number(numStr);
        const { rows: [range] } = await client.query(
          `SELECT id, face_value::numeric AS face_value
             FROM gift_card_ranges
            WHERE prefix = $1 AND range_start <= $2 AND range_end >= $2
            LIMIT 1`,
          [prefix, num],
        );
        if (!range) {
          throw Object.assign(new Error("Gift card not found"), {
            statusCode: 404,
          });
        }
        const faceValue = Number(range.face_value);
        const { rows: [newRow] } = await client.query(
          `INSERT INTO gift_cards
             (code, initial_value, remaining_value, card_type, activation_status)
           VALUES ($1, $2, $2, 'physical', 'active') RETURNING id`,
          [code, faceValue],
        );
        await client.query(
          `INSERT INTO gift_card_transactions
             (gift_card_id, type, amount, reference_type, reference_id, note)
           VALUES ($1, 'credit', $2, 'activate', $3, 'Range activation')`,
          [newRow.id, faceValue, range.id],
        );
        return { code, activation_status: "active", initial_value: faceValue };
      });

      res.json(result);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/gift-cards/:code/balance — authenticated lookup for POS.
  app.get("/api/gift-cards/:code/balance", ...guard, async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      const { rows: [card] } = await db.query(
        `SELECT code, card_type, activation_status,
                initial_value::numeric AS initial_value,
                remaining_value::numeric AS remaining_value
           FROM gift_cards WHERE code = $1`,
        [code],
      );
      if (!card) return res.status(404).json({ error: "Gift card not found" });
      res.json({
        ...card,
        initial_value: Number(card.initial_value),
        remaining_value: Number(card.remaining_value),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/gift-cards/:code/redeem — debit the card.
  // Body: { amount, reference_type?, reference_id? }
  // Transactional: SELECT FOR UPDATE, validate, debit, write ledger,
  // flip to 'depleted' if remaining hits 0. `amount` may be any
  // positive number up to remaining — POS passes a partial amount
  // for split-tender, full amount to zero the card.
  app.post("/api/gift-cards/:code/redeem", ...guard, async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      const amount = Number(req.body?.amount);
      const refType = req.body?.reference_type
        ? String(req.body.reference_type).slice(0, 50)
        : null;
      const refId = req.body?.reference_id != null
        ? Number(req.body.reference_id)
        : null;
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "amount must be > 0" });
      }

      const result = await db.transaction(async (client) => {
        const { rows: [card] } = await client.query(
          `SELECT id, activation_status,
                  remaining_value::numeric AS remaining_value
             FROM gift_cards WHERE code = $1 FOR UPDATE`,
          [code],
        );
        if (!card) {
          throw Object.assign(new Error("Gift card not found"), {
            statusCode: 404,
          });
        }
        if (card.activation_status !== "active") {
          throw Object.assign(
            new Error(`Gift card is ${card.activation_status}`),
            { statusCode: 400 },
          );
        }
        const remaining = Number(card.remaining_value);
        if (amount > remaining) {
          throw Object.assign(
            new Error(`Insufficient balance (remaining ${remaining})`),
            { statusCode: 400 },
          );
        }
        const newRemaining = remaining - amount;
        const newStatus = newRemaining <= 0 ? "depleted" : "active";
        await client.query(
          `UPDATE gift_cards
              SET remaining_value = $1,
                  activation_status = $2,
                  redeemed_at = COALESCE(redeemed_at, CASE WHEN $2 = 'depleted' THEN NOW() END)
            WHERE id = $3`,
          [newRemaining, newStatus, card.id],
        );
        await client.query(
          `INSERT INTO gift_card_transactions
             (gift_card_id, type, amount, reference_type, reference_id, note)
           VALUES ($1, 'debit', $2, $3, $4, $5)`,
          [card.id, amount, refType, refId, refType ? `Redeemed for ${refType}#${refId}` : "Manual redeem"],
        );
        return { deducted: amount, remaining_value: newRemaining, activation_status: newStatus };
      });

      res.json(result);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });
};
