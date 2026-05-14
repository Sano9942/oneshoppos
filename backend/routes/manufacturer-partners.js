"use strict";

/**
 * manufacturer-partners.js — Tier 1.4 distributor-admin endpoints.
 *
 * Mounted AFTER tenant middleware. Tenant-scoped CRUD on the
 * manufacturer_partners table + brand mapping + invite email dispatch.
 *
 *   GET    /api/manufacturer-partners              — list partners + brand counts
 *   POST   /api/manufacturer-partners              — create + send invite email
 *   GET    /api/manufacturer-partners/:id          — detail + brand list
 *   PUT    /api/manufacturer-partners/:id          — update name/email/status/brands
 *   DELETE /api/manufacturer-partners/:id          — soft-suspend (sets status='suspended',
 *                                                    revokes refresh tokens, sets revocation cursor)
 *   POST   /api/manufacturer-partners/:id/resend   — regenerate signup_token, resend invite
 *
 * Gated by:
 *   - requireFeature("wholesale_secondary_sales")
 *   - requirePerm("manage_inventory")  — same perm as promotions/brands (admin + manager only)
 */

const crypto = require("crypto");
const { validate } = require("../middleware/validate");
const {
  createPartnerSchema,
  updatePartnerSchema,
} = require("../schemas/manufacturer-portal");

const SIGNUP_TOKEN_TTL_DAYS = 7;

function newSignupToken() {
  // 32 bytes → 64 hex chars. Comfortably above the schema min of 16.
  return crypto.randomBytes(32).toString("hex");
}

function frontendBase() {
  return (process.env.FRONTEND_URL || "https://sanopos.com").replace(/\/$/, "");
}

function setupUrlFor(tenant, token) {
  return `${frontendBase()}/manufacturer-portal/setup?token=${encodeURIComponent(
    token
  )}&tenant=${encodeURIComponent(tenant.slug)}`;
}

async function enqueueInviteEmail(db, tenant, partner, brandNames, token) {
  try {
    const { enqueueEmail } = require("../services/email");
    await enqueueEmail(db, {
      tenantId: tenant?.id,
      type: "manufacturer_partner_invite",
      to: partner.email,
      tenant: tenant
        ? { slug: tenant.slug, name: tenant.name || tenant.slug }
        : undefined,
      data: {
        storeName: tenant?.name || tenant?.slug || "your distributor",
        contactName: partner.contact_name || partner.name,
        brandList: brandNames,
        setupUrl: setupUrlFor(tenant, token),
        expiresInDays: SIGNUP_TOKEN_TTL_DAYS,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[manufacturer-partners] enqueue invite failed for ${partner.email}:`,
      err.message
    );
  }
}

module.exports = function registerManufacturerPartnerRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  const gate = [
    requireFeature("wholesale_secondary_sales"),
    requirePerm("manage_inventory"),
  ];

  // ── GET /api/manufacturer-partners ────────────────────────────────
  app.get("/api/manufacturer-partners", ...gate, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT mp.id, mp.name, mp.contact_name, mp.email, mp.status,
                mp.last_login_at, mp.created_at, mp.updated_at,
                COUNT(mpb.brand_id)::int AS brand_count
           FROM manufacturer_partners mp
      LEFT JOIN manufacturer_partner_brands mpb
             ON mpb.manufacturer_partner_id = mp.id
       GROUP BY mp.id
       ORDER BY mp.created_at DESC`
      );
      res.json({ partners: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/manufacturer-partners ───────────────────────────────
  app.post(
    "/api/manufacturer-partners",
    ...gate,
    validate(createPartnerSchema),
    async (req, res) => {
      try {
        const { name, contact_name, email, brand_ids } = req.body;

        // Verify all brand_ids exist in this tenant.
        const { rows: brandRows } = await db.query(
          `SELECT id, name FROM brands WHERE id = ANY($1::int[]) ORDER BY name`,
          [brand_ids]
        );
        if (brandRows.length !== brand_ids.length) {
          return res
            .status(400)
            .json({ error: "One or more brand_ids not found" });
        }

        const token = newSignupToken();
        const expiresAt = new Date(
          Date.now() + SIGNUP_TOKEN_TTL_DAYS * 24 * 3600 * 1000
        );

        const created = await db.transaction(async (client) => {
          const { rows: [partner] } = await client.query(
            `INSERT INTO manufacturer_partners
               (name, contact_name, email, status, signup_token, signup_token_expires_at)
             VALUES ($1, $2, $3, 'invited', $4, $5)
             RETURNING id, name, contact_name, email, status, created_at`,
            [name, contact_name || null, email, token, expiresAt]
          );

          for (const bid of brand_ids) {
            await client.query(
              `INSERT INTO manufacturer_partner_brands
                 (manufacturer_partner_id, brand_id)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [partner.id, bid]
            );
          }
          return partner;
        });

        await enqueueInviteEmail(
          db,
          { id: req.tenantId, slug: req.tenantSlug, name: req.company?.name },
          created,
          brandRows.map((b) => b.name),
          token
        );

        res.status(201).json({
          partner: { ...created, brand_count: brand_ids.length },
        });
      } catch (err) {
        if (err.code === "23505") {
          return res
            .status(409)
            .json({ error: "A partner with this email already exists" });
        }
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── GET /api/manufacturer-partners/:id ────────────────────────────
  app.get("/api/manufacturer-partners/:id", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid partner id" });
      }
      const { rows: [partner] } = await db.query(
        `SELECT id, name, contact_name, email, status, last_login_at,
                email_verified_at, created_at, updated_at
           FROM manufacturer_partners WHERE id = $1`,
        [id]
      );
      if (!partner) return res.status(404).json({ error: "Partner not found" });

      const { rows: brands } = await db.query(
        `SELECT b.id, b.name
           FROM manufacturer_partner_brands mpb
           JOIN brands b ON b.id = mpb.brand_id
          WHERE mpb.manufacturer_partner_id = $1
          ORDER BY b.name`,
        [id]
      );

      res.json({ partner: { ...partner, brands } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/manufacturer-partners/:id ────────────────────────────
  app.put(
    "/api/manufacturer-partners/:id",
    ...gate,
    validate(updatePartnerSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid partner id" });
        }
        const { name, contact_name, email, status, brand_ids } = req.body;

        const { rows: [existing] } = await db.query(
          "SELECT id FROM manufacturer_partners WHERE id = $1",
          [id]
        );
        if (!existing) return res.status(404).json({ error: "Partner not found" });

        if (brand_ids) {
          const { rows: brandRows } = await db.query(
            `SELECT id FROM brands WHERE id = ANY($1::int[])`,
            [brand_ids]
          );
          if (brandRows.length !== brand_ids.length) {
            return res
              .status(400)
              .json({ error: "One or more brand_ids not found" });
          }
        }

        await db.transaction(async (client) => {
          // Patch only the fields the caller sent.
          const sets = [];
          const params = [];
          if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
          if (contact_name !== undefined) {
            params.push(contact_name);
            sets.push(`contact_name = $${params.length}`);
          }
          if (email !== undefined) { params.push(email); sets.push(`email = $${params.length}`); }
          if (status !== undefined) {
            params.push(status);
            sets.push(`status = $${params.length}`);
            // If admin suspends/re-invites the partner, force re-auth on next request.
            if (status === "suspended" || status === "invited") {
              sets.push("portal_tokens_revoked_before = NOW()");
            }
          }
          if (sets.length > 0) {
            sets.push("updated_at = NOW()");
            params.push(id);
            await client.query(
              `UPDATE manufacturer_partners SET ${sets.join(", ")} WHERE id = $${params.length}`,
              params
            );
          }

          if (brand_ids) {
            await client.query(
              "DELETE FROM manufacturer_partner_brands WHERE manufacturer_partner_id = $1",
              [id]
            );
            for (const bid of brand_ids) {
              await client.query(
                `INSERT INTO manufacturer_partner_brands
                   (manufacturer_partner_id, brand_id)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [id, bid]
              );
            }
          }
        });

        if (status === "suspended") {
          // Revoke active refresh tokens so the partner can't reuse them after
          // the revocation cursor lift takes effect.
          await db.query(
            `UPDATE manufacturer_portal_refresh_tokens
                SET revoked_at = NOW()
              WHERE manufacturer_partner_id = $1 AND revoked_at IS NULL`,
            [id]
          );
        }

        res.json({ status: "updated" });
      } catch (err) {
        if (err.code === "23505") {
          return res
            .status(409)
            .json({ error: "Email already belongs to another partner" });
        }
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── DELETE /api/manufacturer-partners/:id ─────────────────────────
  // Soft-delete: status='suspended', revoke tokens, set revocation cursor.
  // Hard delete would cascade through the brand mapping + refresh tokens,
  // but we keep the row so audit history (which partner saw what) survives.
  app.delete("/api/manufacturer-partners/:id", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid partner id" });
      }
      const { rowCount } = await db.query(
        `UPDATE manufacturer_partners
            SET status = 'suspended',
                portal_tokens_revoked_before = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Partner not found" });

      await db.query(
        `UPDATE manufacturer_portal_refresh_tokens
            SET revoked_at = NOW()
          WHERE manufacturer_partner_id = $1 AND revoked_at IS NULL`,
        [id]
      );
      res.json({ status: "suspended" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/manufacturer-partners/:id/resend ────────────────────
  // Regenerate signup_token + resend invite. Allowed when status='invited'.
  // For 'active' partners, password reset is the right path (not yet built —
  // 1.4.5 / on-demand if asked).
  app.post(
    "/api/manufacturer-partners/:id/resend",
    ...gate,
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid partner id" });
        }
        const { rows: [partner] } = await db.query(
          `SELECT id, name, contact_name, email, status
             FROM manufacturer_partners WHERE id = $1`,
          [id]
        );
        if (!partner) return res.status(404).json({ error: "Partner not found" });
        if (partner.status !== "invited") {
          return res
            .status(400)
            .json({ error: "Partner already activated. Use password reset instead." });
        }

        const token = newSignupToken();
        const expiresAt = new Date(
          Date.now() + SIGNUP_TOKEN_TTL_DAYS * 24 * 3600 * 1000
        );
        await db.query(
          `UPDATE manufacturer_partners
              SET signup_token = $2,
                  signup_token_expires_at = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [id, token, expiresAt]
        );

        const { rows: brandRows } = await db.query(
          `SELECT b.name FROM manufacturer_partner_brands mpb
             JOIN brands b ON b.id = mpb.brand_id
            WHERE mpb.manufacturer_partner_id = $1
            ORDER BY b.name`,
          [id]
        );

        await enqueueInviteEmail(
          db,
          { id: req.tenantId, slug: req.tenantSlug, name: req.company?.name },
          partner,
          brandRows.map((b) => b.name),
          token
        );

        res.json({ status: "invite_resent" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
