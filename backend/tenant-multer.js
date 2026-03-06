/**
 * tenant-multer.js — Tenant-aware multer storage factories.
 *
 * In multi-tenant mode, upload destinations are resolved from req.tenantDir
 * (set by the tenant-resolve middleware). In single-tenant mode, these
 * functions are not used — the existing hardcoded multer instances remain.
 */
const path = require("path");
const multer = require("multer");

/**
 * Creates a multer storage engine that writes product images to
 * the current tenant's `uploads/products/` directory.
 */
function createProductImageStorage() {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = req.tenantDir
        ? path.join(req.tenantDir, "uploads", "products")
        : null;
      if (!dir) return cb(new Error("Tenant directory not resolved"));
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)
        ? ext
        : ".jpg";
      cb(null, `product_${Date.now()}_${Math.round(Math.random() * 1e6)}${safeExt}`);
    },
  });
}

/**
 * Creates a multer storage engine that writes company logos to
 * the current tenant's `uploads/company/` directory.
 */
function createCompanyLogoStorage() {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = req.tenantDir
        ? path.join(req.tenantDir, "uploads", "company")
        : null;
      if (!dir) return cb(new Error("Tenant directory not resolved"));
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `company_logo_${Date.now()}${ext}`);
    },
  });
}

/**
 * Creates a multer storage engine for DB restore uploads,
 * writing to the tenant's `uploads/` directory.
 */
function createRestoreStorage() {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = req.tenantDir
        ? path.join(req.tenantDir, "uploads")
        : null;
      if (!dir) return cb(new Error("Tenant directory not resolved"));
      cb(null, dir);
    },
    filename: (_req, _file, cb) => {
      cb(null, `restore_${Date.now()}.db`);
    },
  });
}

module.exports = {
  createProductImageStorage,
  createCompanyLogoStorage,
  createRestoreStorage,
};
