/**
 * Shared upload validation — MIME type + file extension whitelist.
 *
 * Usage (as multer fileFilter):
 *   const multer = require("multer");
 *   const { imageFileFilter } = require("../middleware/upload-validation");
 *   const upload = multer({ storage: multer.memoryStorage(), fileFilter: imageFileFilter });
 */
const path = require("path");

const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
]);

const ALLOWED_IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tiff", ".tif",
]);

/**
 * Multer fileFilter that checks both MIME type and file extension.
 * Rejects files that don't match the image allowlist.
 */
function imageFileFilter(req, file, cb) {
  if (!file || !file.mimetype) {
    return cb(new Error("Invalid file"));
  }

  const mime = file.mimetype.toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();

  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return cb(new Error("Only image uploads are allowed"));
  }
  if (ext && !ALLOWED_IMAGE_EXTS.has(ext)) {
    return cb(new Error(`File extension "${ext}" is not allowed`));
  }

  cb(null, true);
}

/**
 * Returns a safe extension from the original filename,
 * falling back to a default derived from the MIME type.
 */
function safeExtension(originalname, mimetype) {
  const ext = path.extname(originalname || "").toLowerCase();
  if (ext && ALLOWED_IMAGE_EXTS.has(ext)) return ext;

  // Derive from MIME type as fallback
  const mimeToExt = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
  };
  return mimeToExt[mimetype] || ".png";
}

module.exports = { imageFileFilter, safeExtension, ALLOWED_IMAGE_MIMES, ALLOWED_IMAGE_EXTS };
