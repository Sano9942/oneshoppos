/**
 * ai.js — catalog AI endpoints (Phase 2 fast-entry).
 *
 *   POST /api/ai/product-content  — { name, category?, brand?, unit? }
 *                                   -> { description, tags[] }
 *   POST /api/ai/invoice-extract  — multipart image ("file")
 *                                   -> { rows[], image_url }  (rows shaped to the
 *                                      import pipeline's canonical product fields)
 *
 * Both require ANTHROPIC_API_KEY (soft-checked -> 400 when absent). No per-tenant
 * feature flag or plan gate by product decision — the features are on for every
 * tenant once the key is set. A generous per-tenant/day *cost* safety cap is the
 * only limiter (circuit-breaker, not an access gate).
 */
const aiService = require("../services/ai");
const { uploadToR2 } = require("../utils/r2");
const { rasterImageFileFilter, verifyImageMagicBytes } = require("../middleware/upload-validation");

// Generous per-tenant daily caps — a cost circuit-breaker only.
const DAILY_CAP = { content: 300, invoice: 150 };
const usage = new Map(); // `${tenantId}:${kind}:${YYYY-MM-DD}` -> count

function withinDailyCap(tenantId, kind) {
  // Deliberately the UTC day: this is a platform cost-cap bucket, not a
  // tenant-facing business day — any consistent 24h bucketing works.
  const day = new Date().toISOString().slice(0, 10);
  const key = `${tenantId || "default"}:${kind}:${day}`;
  const n = usage.get(key) || 0;
  if (n >= DAILY_CAP[kind]) return false;
  usage.set(key, n + 1);
  return true;
}

module.exports = function mountAiRoutes(app, deps) {
  const { multer, requirePerm, requireAnyPerm } = deps;

  const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — photos can be large
    fileFilter: rasterImageFileFilter, // no SVG; images only
  });

  // -------------------------------------------------------------------------
  // POST /api/ai/product-content — generate a description + tags for a product
  // -------------------------------------------------------------------------
  app.post(
    "/api/ai/product-content",
    requireAnyPerm(["manage_inventory", "all_access"]),
    async (req, res) => {
      try {
        if (!aiService.isConfigured()) {
          return res.status(400).json({ error: "AI not configured (missing API key)" });
        }
        const { name, category, brand, unit } = req.body || {};
        if (!name || !String(name).trim()) {
          return res.status(400).json({ error: "name is required" });
        }
        if (!withinDailyCap(req.tenantId, "content")) {
          return res.status(429).json({ error: "Daily AI limit reached. Try again tomorrow." });
        }
        const out = await aiService.generateProductContent({ name, category, brand, unit });
        return res.json(out);
      } catch (err) {
        console.error("AI product-content error:", err.message);
        return res.status(500).json({ error: "Failed to generate product content" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/ai/invoice-extract — read a supplier invoice image into rows
  // -------------------------------------------------------------------------
  app.post(
    "/api/ai/invoice-extract",
    requirePerm("all_access"), // matches the import endpoint's gating
    uploadImage.single("file"),
    async (req, res) => {
      try {
        if (!aiService.isConfigured()) {
          return res.status(400).json({ error: "AI not configured (missing API key)" });
        }
        if (!req.file) return res.status(400).json({ error: "No image uploaded" });

        const claimedMime = (req.file.mimetype || "").toLowerCase();
        // Defense-in-depth: catch a faked Content-Type (P32) before we send the
        // bytes to the model or store them.
        if (!verifyImageMagicBytes(req.file.buffer, claimedMime)) {
          return res.status(400).json({ error: "Uploaded file is not a valid image" });
        }

        if (!withinDailyCap(req.tenantId, "invoice")) {
          return res.status(429).json({ error: "Daily AI limit reached. Try again tomorrow." });
        }

        const imageBase64 = req.file.buffer.toString("base64");
        const { rows } = await aiService.extractInvoiceLineItems({
          imageBase64,
          mediaType: claimedMime || "image/jpeg",
        });

        // Store the original invoice image in R2 for audit. Best-effort — a
        // storage failure must not discard the already-extracted rows.
        let image_url = null;
        try {
          const ext = (claimedMime.split("/")[1] || "jpg").replace("jpeg", "jpg");
          const rand = Math.random().toString(36).slice(2, 8);
          const key = `invoices/${req.tenantSlug || "tenant"}/${Date.now()}_${rand}.${ext}`;
          image_url = await uploadToR2(req.file.buffer, key, claimedMime || "image/jpeg");
        } catch (e) {
          console.warn("Invoice image R2 upload failed (continuing):", e.message);
        }

        return res.json({ rows, image_url });
      } catch (err) {
        console.error("AI invoice-extract error:", err.message);
        return res.status(500).json({ error: "Failed to read invoice" });
      }
    },
  );
};
