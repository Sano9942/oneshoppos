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
    (req, res) => {
      db.get("SELECT * FROM company_profile WHERE id = 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ profile: row || null });
      });
    },
  );

  router.put(
    "/api/company-profile",
    requirePerm("all_access"),
    requireFeature("multi_company"),
    (req, res) => {
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
      } = req.body || {};

      db.run(
        `UPDATE company_profile
       SET company_name = COALESCE(?, company_name),
           trading_name = ?,
           ntn = ?,
           strn = ?,
           address = ?,
           city = ?,
           country = COALESCE(?, country),
           phone = ?,
           email = ?,
           website = ?,
           currency_symbol = COALESCE(?, currency_symbol),
           currency_code = COALESCE(?, currency_code),
           fiscal_year_start = COALESCE(?, fiscal_year_start),
           timezone = COALESCE(?, timezone),
           monthly_sales_target = COALESCE(?, monthly_sales_target),
           margin_threshold_pct = COALESCE(?, margin_threshold_pct),
           refund_threshold_pct = COALESCE(?, refund_threshold_pct),
           void_threshold_pct = COALESCE(?, void_threshold_pct),
           updated_at = datetime('now','localtime')
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
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Company profile updated" });
        },
      );
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
        db.run(
          "UPDATE company_profile SET logo_url = ?, updated_at = datetime('now','localtime') WHERE id = 1",
          [logoUrl],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Company logo updated", logo_url: logoUrl });
          },
        );
      } catch (err) {
        res.status(500).json({ error: "Upload failed: " + err.message });
      }
    },
  );

  return router;
};
