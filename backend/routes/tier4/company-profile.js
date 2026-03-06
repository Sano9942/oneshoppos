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
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Company profile updated" });
        },
      );
    },
  );

  const companyLogoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      // In multi-tenant mode, write to the tenant's uploads directory
      const dir = req.tenantDir
        ? path.join(req.tenantDir, "uploads", "company")
        : COMPANY_UPLOADS_DIR;
      const fs = require("fs");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `company_logo_${Date.now()}${ext}`);
    },
  });
  const companyLogoUpload = multer({
    storage: companyLogoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  router.post(
    "/api/company-profile/logo",
    requirePerm("all_access"),
    requireFeature("multi_company"),
    companyLogoUpload.single("logo"),
    (req, res) => {
      if (!req.file)
        return res.status(400).json({ error: "Logo file is required" });
      const logoUrl = `/uploads/company/${req.file.filename}`;
      db.run(
        "UPDATE company_profile SET logo_url = ?, updated_at = datetime('now','localtime') WHERE id = 1",
        [logoUrl],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Company logo updated", logo_url: logoUrl });
        },
      );
    },
  );

  return router;
};
