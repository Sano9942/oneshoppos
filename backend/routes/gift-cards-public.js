/**
 * Phase 2-G Wave 2 — 2-G.2 public gift-card balance check.
 *
 * Separate module so it can mount BEFORE loadTenantAndPerms (same
 * pattern as routes/receipts.js — no auth, manual tenant resolution
 * via `?tenant=<slug>` in MT mode).
 *
 * Intentionally minimal:
 *   GET /api/gift-cards/public/:code?tenant=<slug>
 *
 * Exposes only what a customer holding a card needs to see:
 * remaining value, initial value, activation_status. Never leaks
 * customer/sale linkage.
 */
module.exports = function mountGiftCardPublicRoutes(app, deps) {
  const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";

  app.get("/api/gift-cards/public/:code", async (req, res) => {
    try {
      let db;
      if (IS_MULTI_TENANT) {
        const tenantSlug = req.query.tenant;
        if (!tenantSlug) {
          return res.status(400).json({ error: "tenant query param is required" });
        }
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = deps.tenantDbManager || require("../tenant-db-manager-pg");
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id, slug, status FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(tenantSlug).trim()],
        );
        if (!tenant) return res.status(404).json({ error: "Store not found" });
        db = await tenantDbMgr.getDb(tenant.id);
      } else {
        db = deps.db;
      }

      const code = String(req.params.code || "").trim();
      if (!code) return res.status(404).json({ error: "Gift card not found" });

      const { rows: [card] } = await db.query(
        `SELECT code,
                initial_value::numeric AS initial_value,
                remaining_value::numeric AS remaining_value,
                activation_status,
                card_type,
                created_at
           FROM gift_cards
          WHERE code = $1`,
        [code],
      );
      if (!card) return res.status(404).json({ error: "Gift card not found" });

      res.json({
        code: card.code,
        initial_value: Number(card.initial_value),
        remaining_value: Number(card.remaining_value),
        activation_status: card.activation_status,
        card_type: card.card_type,
        created_at: card.created_at,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
