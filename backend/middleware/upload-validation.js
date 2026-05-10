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

// ── Clinical document allowlist (M72) ────────────────────────────────
// Treatment-plans uploads accept lab reports, referrals, imaging etc.
// — not strictly images. Allow raster images + PDF + plain text;
// reject SVG (same-origin XSS), HTML, scripts, executables.
const ALLOWED_CLINICAL_DOC_MIMES = new Set([
  ...ALLOWED_RASTER_IMAGE_MIMES,
  "application/pdf",
  "text/plain",
]);
const ALLOWED_CLINICAL_DOC_EXTS = new Set([
  ...ALLOWED_RASTER_IMAGE_EXTS,
  ".pdf",
  ".txt",
]);

/**
 * Multer fileFilter for clinical documents. Mirrors imageFileFilter but
 * with a different allowlist. Rejects SVG, HTML, JS, EXE — anything that
 * could execute when fetched from a same-origin URL (P31) or hide as a
 * faked image (P32).
 */
const clinicalDocFileFilter = makeImageFileFilter(
  ALLOWED_CLINICAL_DOC_MIMES,
  ALLOWED_CLINICAL_DOC_EXTS
);

/**
 * Sniff the first bytes of a buffer and return a canonical MIME (for
 * images + PDFs), or null if the magic bytes don't match any known
 * format.
 *
 * P32 — multer's `file.mimetype` comes from the client multipart envelope
 * and can be lied about. detectImageType reads the actual bytes so a
 * payload.exe renamed payload.jpg with Content-Type: image/jpeg can be
 * caught before it lands on R2.
 */
function detectImageType(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  const b = buffer;

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: "GIF87a" or "GIF89a"
  if (b.length >= 6 && b.slice(0, 3).toString() === "GIF") {
    const ver = b.slice(3, 6).toString();
    if (ver === "87a" || ver === "89a") return "image/gif";
  }

  // WEBP: "RIFF....WEBP"
  if (
    b.length >= 12 &&
    b.slice(0, 4).toString() === "RIFF" &&
    b.slice(8, 12).toString() === "WEBP"
  ) {
    return "image/webp";
  }

  // BMP: "BM"
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";

  // TIFF little-endian: 49 49 2A 00
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) {
    return "image/tiff";
  }
  // TIFF big-endian: 4D 4D 00 2A
  if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) {
    return "image/tiff";
  }

  // PDF: "%PDF-"
  if (
    b.length >= 5 &&
    b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d
  ) {
    return "application/pdf";
  }

  return null;
}

/**
 * True if the buffer's magic bytes match the claimed MIME type.
 * False on mismatch or unknown bytes. Note: SVG and text/plain are
 * text-based and have no magic bytes; SVG should be excluded at the
 * fileFilter layer (rasterImageFileFilter / clinicalDocFileFilter) and
 * text/plain skips this check (returns true).
 */
function verifyImageMagicBytes(buffer, claimedMime) {
  const claim = String(claimedMime || "").toLowerCase();
  // text/plain has no magic bytes — rely on filter allowlist + extension check
  if (claim === "text/plain") return true;
  const sniffed = detectImageType(buffer);
  if (!sniffed) return false;
  return sniffed === claim;
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

module.exports = {
  imageFileFilter,
  rasterImageFileFilter,
  clinicalDocFileFilter,
  safeExtension,
  detectImageType,
  verifyImageMagicBytes,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_IMAGE_EXTS,
  ALLOWED_RASTER_IMAGE_MIMES,
  ALLOWED_RASTER_IMAGE_EXTS,
  ALLOWED_CLINICAL_DOC_MIMES,
  ALLOWED_CLINICAL_DOC_EXTS,
};
