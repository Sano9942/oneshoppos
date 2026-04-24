const express = require("express");
const multer = require("multer");
const { getPreset, VALID_INDUSTRY_TYPES } = require("../../config/industry-config");
const { getFeatureFlagsForModes, VALID_MODES } = require("../../config/mode-registry");
const { invalidateModeCache, invalidateFeatureFlagCache } = require("../../middleware/feature-flags");

module.exports = function createCompanyProfileRouter({
  db,
  requireFeature,
  requirePerm,
  COMPANY_UPLOADS_DIR,
}) {
  const router = express.Router();

  router.get(
    "/api/company-profile",
    requireFeature("multi_company"),
    async (req, res) => {
      try {
        const { rows } = await db.query("SELECT * FROM company_profile WHERE id = 1");
        res.json({ profile: rows[0] || null });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET /api/company-profile/currency — public (no auth)
  // Used by CurrencyProvider on frontend mount
  // In MT mode, requires ?tenant=<slug> to resolve correct schema
  router.get("/api/company-profile/currency", async (req, res) => {
    try {
      let queryDb = db;
      if (process.env.MULTI_TENANT === "1" && req.query.tenant) {
        const masterDb = require("../../master-db-pg");
        const tenantDbMgr = require("../../tenant-db-manager-pg");
        const tenant = await masterDb.getTenantBySlug(req.query.tenant);
        if (!tenant) return res.status(404).json({ error: "Tenant not found" });
        queryDb = await tenantDbMgr.getDb(tenant.id);
      }
      const { rows: [row] } = await queryDb.query(
        "SELECT currency_symbol, currency_code, cash_denominations FROM company_profile WHERE id = 1"
      );
      if (!row) return res.json({ symbol: "$", code: "USD", denominations: [100, 50, 20, 10, 5, 1] });
      let denominations;
      try { denominations = JSON.parse(row.cash_denominations || "[]"); } catch { denominations = [100, 50, 20, 10, 5, 1]; }
      res.json({
        symbol: row.currency_symbol || "$",
        code: row.currency_code || "USD",
        denominations,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load currency" });
    }
  });

  router.put(
    "/api/company-profile",
    requirePerm("all_access"),
    requireFeature("multi_company"),
    async (req, res) => {
      try {
        const {
          company_name,
          trading_name,
          ntn,
          strn,
          address,
          city,
          country,
          phone,
          email,
          website,
          currency_symbol,
          currency_code,
          fiscal_year_start,
          timezone,
          monthly_sales_target,
          margin_threshold_pct,
          refund_threshold_pct,
          void_threshold_pct,
          cash_denominations,
          industry_type,
          abc_window_days,
          tenant_default_lead_time_days,
          tenant_default_safety_stock_days,
        } = req.body || {};

        await db.query(
          `UPDATE company_profile
         SET company_name = COALESCE($1, company_name),
             trading_name = $2,
             ntn = $3,
             strn = $4,
             address = $5,
             city = $6,
             country = COALESCE($7, country),
             phone = $8,
             email = $9,
             website = $10,
             currency_symbol = COALESCE($11, currency_symbol),
             currency_code = COALESCE($12, currency_code),
             fiscal_year_start = COALESCE($13, fiscal_year_start),
             timezone = COALESCE($14, timezone),
             monthly_sales_target = COALESCE($15, monthly_sales_target),
             margin_threshold_pct = COALESCE($16, margin_threshold_pct),
             refund_threshold_pct = COALESCE($17, refund_threshold_pct),
             void_threshold_pct = COALESCE($18, void_threshold_pct),
             cash_denominations = COALESCE($19, cash_denominations),
             abc_window_days = COALESCE($20, abc_window_days),
             tenant_default_lead_time_days = COALESCE($21, tenant_default_lead_time_days),
             tenant_default_safety_stock_days = COALESCE($22, tenant_default_safety_stock_days),
             updated_at = NOW()
         WHERE id = 1`,
          [
            company_name || null,
            trading_name || null,
            ntn || null,
            strn || null,
            address || null,
            city || null,
            country || null,
            phone || null,
            email || null,
            website || null,
            currency_symbol || null,
            currency_code || null,
            fiscal_year_start || null,
            timezone || null,
            monthly_sales_target != null ? Number(monthly_sales_target) : null,
            margin_threshold_pct != null ? Number(margin_threshold_pct) : null,
            refund_threshold_pct != null ? Number(refund_threshold_pct) : null,
            void_threshold_pct != null ? Number(void_threshold_pct) : null,
            cash_denominations || null,
            abc_window_days != null ? Number(abc_window_days) : null,
            tenant_default_lead_time_days != null ? Number(tenant_default_lead_time_days) : null,
            tenant_default_safety_stock_days != null ? Number(tenant_default_safety_stock_days) : null,
          ]
        );
        // If industry_type changed, re-derive modes and flags
        if (industry_type && VALID_INDUSTRY_TYPES.includes(industry_type)) {
          const preset = getPreset(industry_type);

          await db.query(
            `UPDATE company_profile SET
               industry_type = $1,
               business_model = $2,
               industry_preset_version = 1
             WHERE id = 1`,
            [preset.industry_type, preset.business_model]
          );

          // Clear old modes and seed new ones
          await db.query("DELETE FROM tenant_modes");
          for (const mode of preset.modes) {
            await db.query(
              `INSERT INTO tenant_modes (mode, enabled, enabled_at) VALUES ($1, true, NOW()) ON CONFLICT (mode) DO NOTHING`,
              [mode]
            );
          }

          // Disable all mode-related flags first, then enable the new preset's.
          // Derived from MODE_REGISTRY so adding a new mode auto-extends the
          // reset list — no more missed-a-flag bugs when a new mode ships
          // (see M7 post-mortem: phase4_rentals was missed from the old
          // hardcoded array, leaving stale flags on production tenants).
          const ALL_MODE_FLAGS = getFeatureFlagsForModes(VALID_MODES);
          for (const flagKey of ALL_MODE_FLAGS) {
            await db.query(
              `INSERT INTO feature_flags (key, enabled) VALUES ($1, false) ON CONFLICT (key) DO UPDATE SET enabled = false`,
              [flagKey]
            );
          }
          const flagsToEnable = getFeatureFlagsForModes(preset.modes);
          for (const flagKey of flagsToEnable) {
            await db.query(
              `UPDATE feature_flags SET enabled = true WHERE key = $1`,
              [flagKey]
            );
          }

          // Bust caches so next request picks up changes
          invalidateModeCache();
          invalidateFeatureFlagCache();
        }

        res.json({ message: "Company profile updated" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Dismiss onboarding checklist
  router.put("/api/company-profile/onboarding-dismiss", requirePerm("all_access"), async (req, res) => {
    try {
      await db.query("UPDATE company_profile SET onboarding_dismissed = true WHERE id = 1");
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dismiss FBR setup banner (PR 7) — mirror of onboarding-dismiss for the
  // PK-only "Set up FBR / Not required for my business" prompt on the
  // dashboard. Once dismissed, never shows again for this tenant.
  router.put("/api/company-profile/fbr-banner-dismiss", requirePerm("all_access"), async (req, res) => {
    try {
      await db.query("UPDATE company_profile SET fbr_banner_dismissed = true WHERE id = 1");
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const { uploadToR2 } = require("../../utils/r2");
  const { imageFileFilter, safeExtension } = require("../../middleware/upload-validation");

  const companyLogoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  });

  router.post(
    "/api/company-profile/logo",
    requirePerm("all_access"),
    requireFeature("multi_company"),
    companyLogoUpload.single("logo"),
    async (req, res) => {
      if (!req.file)
        return res.status(400).json({ error: "Logo file is required" });
      try {
        const ext = safeExtension(req.file.originalname, req.file.mimetype);
        const filename = `company_logo_${Date.now()}${ext}`;
        const key = `company/${filename}`;
        const logoUrl = await uploadToR2(req.file.buffer, key, req.file.mimetype);
        await db.query(
          "UPDATE company_profile SET logo_url = $1, updated_at = NOW() WHERE id = 1",
          [logoUrl]
        );
        res.json({ message: "Company logo updated", logo_url: logoUrl });
      } catch (err) {
        res.status(500).json({ error: "Upload failed: " + err.message });
      }
    },
  );

  return router;
};
