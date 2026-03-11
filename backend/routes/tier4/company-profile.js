const express = require("express");
const multer = require("multer");
const path = require("path");

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
  router.get("/api/company-profile/currency", async (req, res) => {
    try {
      const { rows: [row] } = await db.query(
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
          ]
        );
        res.json({ message: "Company profile updated" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  const { uploadToR2 } = require("../../utils/r2");

  const companyLogoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
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
        const ext = path.extname(req.file.originalname || "").toLowerCase() || ".png";
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
