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

// Subset for routes that store the file as-is (no rasterisation). SVG is
// excluded because it can carry <script>/onload payloads and would execute
// when fetched as a top-level document from the same origin as the API's
// auth cookies — see P31 (support-upload XSS → session takeover via
// /api/auth/refresh). Routes that rasterise (sharp/webp) can keep SVG via
// imageFileFilter.
const ALLOWED_RASTER_IMAGE_MIMES = new Set(
  [...ALLOWED_IMAGE_MIMES].filter((m) => m !== "image/svg+xml")
);
const ALLOWED_RASTER_IMAGE_EXTS = new Set(
  [...ALLOWED_IMAGE_EXTS].filter((e) => e !== ".svg")
);

function makeImageFileFilter(allowedMimes, allowedExts) {
  return function imageFileFilterImpl(req, file, cb) {
    if (!file || !file.mimetype) {
      return cb(new Error("Invalid file"));
    }

    const mime = file.mimetype.toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();

    if (!allowedMimes.has(mime)) {
      return cb(new Error("Only image uploads are allowed"));
    }
    if (ext && !allowedExts.has(ext)) {
      return cb(new Error(`File extension "${ext}" is not allowed`));
    }

    cb(null, true);
  };
}

/**
 * Multer fileFilter that checks both MIME type and file extension.
 * Rejects files that don't match the image allowlist (incl. SVG).
 */
const imageFileFilter = makeImageFileFilter(ALLOWED_IMAGE_MIMES, ALLOWED_IMAGE_EXTS);

/**
 * Stricter variant that excludes SVG. Use on routes that store the upload
 * as-is and serve it back from a same-origin URL (P31).
 */
const rasterImageFileFilter = makeImageFileFilter(
  ALLOWED_RASTER_IMAGE_MIMES,
  ALLOWED_RASTER_IMAGE_EXTS
);

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

module.exports = {
  imageFileFilter,
  rasterImageFileFilter,
  safeExtension,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_IMAGE_EXTS,
  ALLOWED_RASTER_IMAGE_MIMES,
  ALLOWED_RASTER_IMAGE_EXTS,
};
